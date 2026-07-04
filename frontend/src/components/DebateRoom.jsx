import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Shield, Sparkles, MessageSquare, ArrowLeft, Loader, ExternalLink, X, BookOpen, WifiOff, Wifi } from 'lucide-react';
import GraphContainer from './GraphContainer';
import ChatPanel from './ChatPanel';
import SubtreePanel from './SubtreePanel';
import FactCheckTicker from './FactCheckTicker';
import Dashboard from './Dashboard';
import NudgeModal from './NudgeModal';

export default function DebateRoom({ roomId, username, onLeave }) {
  const [room, setRoom] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [activeSubtree, setActiveSubtree] = useState(null); // subtreeId | null

  // Rephrase Nudge Modal
  const [nudgeData, setNudgeData] = useState(null);
  const [isNudgeOpen, setIsNudgeOpen] = useState(false);

  // AI Summary Modal
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  // Resizable split (graph vs right panel)
  const [splitPct, setSplitPct] = useState(62); // percentage for graph side
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  const wsRef = useRef(null);
  const intentionalLeave = useRef(false);   // true when user clicks Exit
  const reconnectTimer = useRef(null);
  const reconnectAttempt = useRef(0);
  const [connState, setConnState] = useState('connecting'); // 'connecting' | 'open' | 'reconnecting'

  // ── Drag-to-resize handlers ──────────────────────────────────────────────
  const onDragStart = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onDragMove = useCallback((e) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.min(Math.max(pct, 30), 75)); // clamp 30%-75%
  }, []);

  const onDragEnd = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);
    return () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      window.removeEventListener('touchmove', onDragMove);
      window.removeEventListener('touchend', onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  // ── WebSocket with auto-reconnect ──────────────────────────────────────
  useEffect(() => {
    const wsUrl = import.meta.env.VITE_BACKEND_WS_URL ||
      `ws://${window.location.hostname}:5000`;

    function connect() {
      if (intentionalLeave.current) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setConnState(reconnectAttempt.current === 0 ? 'connecting' : 'reconnecting');

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setConnState('open');
        // (Re-)join room — server will send back full room state from DB
        ws.send(JSON.stringify({ event: 'join_room', data: { roomId, username } }));
      };

      ws.onmessage = (event) => {
        const { event: evType, data } = JSON.parse(event.data);
        switch(evType){
          case 'room_joined':
            setRoom(data);
            // Ensure subtrees map exists
            if (!data.subtrees) setRoom(r => r ? { ...r, subtrees: {} } : null);
            break;

          case 'user_joined':
            setRoom(prev => prev ? { ...prev, participants: data.participants } : null);
            break;

          case 'new_node':
            setRoom(prev => {
              if (!prev || prev.nodes.some(n => n.id === data.id)) return prev;
              return { ...prev, nodes: [...prev.nodes, data] };
            });
            break;

          case 'new_edge':
            setRoom(prev => {
              if (!prev || prev.edges.some(e => e.id === data.id)) return prev;
              return { ...prev, edges: [...prev.edges, data] };
            });
            break;

          case 'node_updated':
            setRoom(prev => {
              if (!prev) return null;
              return { ...prev, nodes: prev.nodes.map(n => n.id === data.id ? { ...n, ...data } : n) };
            });
            setSelectedNode(prev => prev?.id === data.id ? { ...prev, ...data } : prev);
            break;

          case 'edges_updated':
            setRoom(prev => prev ? { ...prev, edges: data } : null);
            break;

          // AI moderator messages (fact check verdict, concession acknowledgement)
          case 'new_ai_message':
            setRoom(prev => {
              if (!prev) return null;
              if (prev.messages.some(m => m.id === data.id)) return prev;
              return { ...prev, messages: [...prev.messages, data] };
            });
            break;

          // Subtree created — broadcast to all clients in room
          case 'subtree_created':
            setRoom(prev => {
              if (!prev) return null;
              return {
                ...prev,
                subtrees: { ...(prev.subtrees || {}), [data.id]: data }
              };
            });
            break;

          // Message posted inside a subtree
          case 'subtree_message_received':
            setRoom(prev => {
              if (!prev) return null;
              const subtrees = { ...(prev.subtrees || {}) };
              if (subtrees[data.subtreeId]) {
                subtrees[data.subtreeId] = {
                  ...subtrees[data.subtreeId],
                  messages: [...subtrees[data.subtreeId].messages, data.message]
                };
              }
              return { ...prev, subtrees };
            });
            break;

          case 'fallacy_nudge':
            setNudgeData(data);
            setIsNudgeOpen(true);
            break;

          case 'summary_loading':
            setSummaryLoading(true);
            setIsSummaryOpen(true);
            break;

          case 'debate_summary':
            setSummaryLoading(false);
            setSummary(data.summary);
            break;

          case 'error':
            alert(`Error: ${data.message}`);
            setSummaryLoading(false);
            break;

          default: break;
        }
      };

      ws.onclose = (e) => {
        if (intentionalLeave.current) return; // user clicked Exit — don't reconnect

        setConnState('reconnecting');
        reconnectAttempt.current += 1;

        // Exponential backoff: 2s, 4s, 8s, 15s max
        const delay = Math.min(2000 * Math.pow(2, reconnectAttempt.current - 1), 15000);
        console.log(`[WS] Disconnected. Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt.current})...`);
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close(); // triggers onclose → reconnect
      };
    }

    connect();

    return () => {
      intentionalLeave.current = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [roomId, username]);


  // ── Callbacks ────────────────────────────────────────────────────────────
  const send = (event, data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
    }
  };

  const handleSendMessage = (text) =>
    send('chat_message', { roomId, username, text });

  const handleConcedeNode = (nodeId) =>
    send('concede_claim', { roomId, nodeId });

  const handleFactCheck = (nodeId, claim) =>
    send('fact_check_request', { roomId, nodeId, claim });

  const handleOpenSubtree = (parentNodeId, label) => {
    send('open_subtree', { roomId, parentNodeId, label });
  };

  // Auto-navigate into a subtree when the current user creates one
  const prevSubtreesRef = useRef({});
  useEffect(() => {
    if (!room?.subtrees) return;
    const prev = prevSubtreesRef.current;
    const newIds = Object.keys(room.subtrees).filter(id => !prev[id]);
    for (const id of newIds) {
      if (room.subtrees[id].createdBy === username) {
        setActiveSubtree(id); // creator jumps in automatically
        break;
      }
    }
    prevSubtreesRef.current = room.subtrees;
  }, [room?.subtrees, username]);

  const handleSubtreeMessage = (subtreeId, text) =>
    send('subtree_message', { roomId, subtreeId, username, text });

  const handleRephraseMessage = (nodeId, newText) => {
    send('rephrase_message', { roomId, nodeId, newText });
    setIsNudgeOpen(false);
    setNudgeData(null);
  };

  const handleRequestSummary = () =>
    send('request_summary', { roomId });

  if (!room && connState === 'connecting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <Loader size={40} className="spin-slow" style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: '0.9rem', color: '#94A3B8' }}>Entering debate room...</span>
      </div>
    );
  }

  if (!room && connState === 'reconnecting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <WifiOff size={40} style={{ color: '#F59E0B' }} />
        <span style={{ fontSize: '1rem', color: '#F59E0B', fontWeight: '600' }}>Connection lost</span>
        <span style={{ fontSize: '0.85rem', color: '#94A3B8' }}>Reconnecting automatically... (attempt {reconnectAttempt.current})</span>
      </div>
    );
  }

  if (!room) return null;

  return (
    <div className="app-container" style={{ position: 'relative' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => { intentionalLeave.current = true; clearTimeout(reconnectTimer.current); wsRef.current?.close(); onLeave(); }}
            className="btn-secondary"
            style={{ padding: '5px 12px' }}
          >
            <ArrowLeft size={15} />
            <span>Exit</span>
          </button>
          <div>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Agora Room</h1>
            <span style={{ fontSize: '0.78rem', color: 'var(--accent-primary)' }}>{room.topic}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Connection status pill */}
          {connState === 'reconnecting' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '6px', padding: '3px 10px', fontSize: '0.75rem', color: '#F59E0B'
            }}>
              <WifiOff size={12} />
              <span>Reconnecting...</span>
            </div>
          )}
          {connState === 'open' && reconnectAttempt.current > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '6px', padding: '3px 10px', fontSize: '0.75rem', color: '#34D399'
            }}>
              <Wifi size={12} />
              <span>Reconnected ✓</span>
            </div>
          )}
          <div style={{
            background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: '6px', padding: '4px 10px', fontSize: '0.78rem', color: '#60A5FA'
          }}>
            Debater: <strong style={{ color: 'white' }}>{username}</strong>
          </div>
        </div>
      </div>

      {/* ── Mid-debate reconnecting overlay ─────────────────────── */}
      {connState === 'reconnecting' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(5,8,18,0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px'
        }}>
          <WifiOff size={48} style={{ color: '#F59E0B' }} />
          <span style={{ fontSize: '1.15rem', fontWeight: '700', color: '#F59E0B' }}>Connection lost</span>
          <span style={{ fontSize: '0.88rem', color: '#94A3B8' }}>
            Reconnecting automatically — attempt {reconnectAttempt.current}
          </span>
          <span style={{ fontSize: '0.78rem', color: '#64748B', maxWidth: '320px', textAlign: 'center', lineHeight: '1.5' }}>
            Your debate is safely saved. Everything will reload the moment the connection is restored.
          </span>
        </div>
      )}

      {/* ── Main resizable area ──────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ display: 'flex', flex: 1, gap: 0, minHeight: 0, overflow: 'hidden' }}
      >
        {/* Left: Graph */}
        <div style={{ width: `${splitPct}%`, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 0 0 0' }}>
          <GraphContainer
            room={room}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
          />
        </div>

        {/* ── Drag handle ──────────────────────────────────────────────── */}
        <div
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
          style={{
            width: '6px',
            cursor: 'col-resize',
            background: 'transparent',
            flexShrink: 0,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20
          }}
        >
          <div style={{
            width: '3px',
            height: '60px',
            borderRadius: '2px',
            background: 'rgba(255,255,255,0.12)',
            transition: 'background 0.2s'
          }} />
        </div>

        {/* Right: Chat or Subtree Panel + Ticker */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, minWidth: 0, padding: '0 0 0 8px' }}>
          {activeSubtree && room?.subtrees?.[activeSubtree] ? (
            <SubtreePanel
              subtree={room.subtrees[activeSubtree]}
              currentUser={username}
              onSendMessage={handleSubtreeMessage}
              onClose={() => setActiveSubtree(null)}
            />
          ) : (
            <ChatPanel
              room={room}
              currentUser={username}
              onSendMessage={handleSendMessage}
              onConcedeNode={handleConcedeNode}
              onFactCheck={handleFactCheck}
              onOpenSubtree={(parentNodeId, label) => {
                handleOpenSubtree(parentNodeId, label);
                // Switch to subtree view once subtree_created arrives
                // We watch for it via the room.subtrees state update below
              }}
              onViewSubtree={(subtreeId) => setActiveSubtree(subtreeId)}
            />
          )}
          <FactCheckTicker room={room} />
        </div>
      </div>

      {/* ── Dashboard ───────────────────────────────────────────────────── */}
      <Dashboard
        room={room}
        onReqSummary={handleRequestSummary}
        summary={summary}
        summaryLoading={summaryLoading}
      />

      {/* ── Node detail drawer (on graph click) ─────────────────────────── */}
      {selectedNode && (
        <div className="glass-panel" style={{
          position: 'absolute', top: '70px', left: '16px', width: '300px',
          background: 'rgba(10,15,28,0.96)', padding: '14px', zIndex: 50,
          display: 'flex', flexDirection: 'column', gap: '10px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#94A3B8' }}>Argument Info</h4>
            <button onClick={() => setSelectedNode(null)} style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748B', marginBottom: '4px' }}>
              <span>Author: <strong style={{ color: 'var(--accent-primary)' }}>{selectedNode.author}</strong></span>
              <span style={{ textTransform: 'uppercase', fontWeight: '700' }}>{selectedNode.type}</span>
            </div>
            <p style={{ background: 'rgba(0,0,0,0.15)', padding: '8px 10px', borderRadius: '8px', fontSize: '0.83rem', color: '#F1F5F9', lineHeight: '1.4' }}>
              "{selectedNode.text}"
            </p>
          </div>

          {selectedNode.fact_status && selectedNode.fact_status !== 'unverified' && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748B', display: 'block', marginBottom: '4px' }}>Fact Check:</span>
              <span style={{
                fontWeight: '700', fontSize: '0.78rem', textTransform: 'uppercase',
                color: selectedNode.fact_status === 'true' ? 'var(--accent-success)' :
                       selectedNode.fact_status === 'false' ? 'var(--accent-danger)' :
                       selectedNode.fact_status === 'checking' ? 'var(--accent-warning)' : '#CBD5E1'
              }}>
                {selectedNode.fact_status === 'failed' ? 'UNABLE TO VERIFY' : selectedNode.fact_status}
              </span>
              {selectedNode.fact_explanation && (
                <p style={{ fontSize: '0.73rem', color: '#94A3B8', lineHeight: '1.3', marginTop: '4px' }}>{selectedNode.fact_explanation}</p>
              )}
              {selectedNode.sources?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px' }}>
                  {selectedNode.sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{
                      fontSize: '0.7rem', color: '#60A5FA', textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center', gap: '3px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      <ExternalLink size={9} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || s.url}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedNode.fallacy_flags?.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--accent-danger)', fontWeight: '700', display: 'block', marginBottom: '4px' }}>
                LOGICAL FALLACIES DETECTED:
              </span>
              {selectedNode.fallacy_flags.map((fal, i) => (
                <div key={i} style={{ background: 'rgba(239,68,68,0.05)', padding: '5px 8px', borderRadius: '6px', fontSize: '0.73rem', marginBottom: '4px' }}>
                  <strong style={{ color: 'var(--accent-danger)' }}>{fal.type}: </strong>
                  <span style={{ color: '#CBD5E1' }}>{fal.explanation}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Fallacy nudge modal ──────────────────────────────────────────── */}
      <NudgeModal
        isOpen={isNudgeOpen}
        data={nudgeData}
        onRephrase={handleRephraseMessage}
        onPostAnyway={() => { setIsNudgeOpen(false); setNudgeData(null); }}
      />

      {/* ── AI Summary modal ─────────────────────────────────────────────── */}
      {isSummaryOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, backdropFilter: 'blur(10px)', padding: '24px'
        }}>
          <div className="glass-panel" style={{
            width: '100%', maxWidth: '700px', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', padding: '24px', gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                <BookOpen size={18} style={{ color: 'var(--accent-primary)' }} />
                AI Debate Analysis & Summary
              </h3>
              <button onClick={() => { setIsSummaryOpen(false); setSummary(''); }} style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.88rem', color: '#E2E8F0', lineHeight: '1.6' }}>
              {summaryLoading
                ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: '12px' }}>
                    <Loader size={28} className="spin-slow" style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ color: '#94A3B8' }}>Synthesizing debate graphs and fact-checks...</span>
                  </div>
                : <div style={{ whiteSpace: 'pre-wrap' }}>{summary}</div>
              }
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
              <button onClick={() => { setIsSummaryOpen(false); setSummary(''); }} className="btn-primary" style={{ padding: '6px 16px' }}>
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
