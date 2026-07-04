import React, { useState, useEffect, useRef } from 'react';
import { Send, Search, Flag, ShieldAlert, Bot, TreePine, ChevronRight } from 'lucide-react';

// ── Fact status badge config ─────────────────────────────────────────────────
const FACT_COLORS = {
  true:          { bg: 'rgba(16,185,129,0.15)',  border: '#10B981', text: '#34D399', label: '✅ TRUE' },
  false:         { bg: 'rgba(239,68,68,0.15)',   border: '#EF4444', text: '#F87171', label: '❌ FALSE' },
  partially_true:{ bg: 'rgba(245,158,11,0.15)',  border: '#F59E0B', text: '#FCD34D', label: '⚠️ PARTIAL' },
  checking:      { bg: 'rgba(99,102,241,0.15)',  border: '#6366F1', text: '#A5B4FC', label: '⟳ CHECKING' },
  failed:        { bg: 'rgba(100,116,139,0.12)', border: '#475569', text: '#94A3B8', label: 'UNVERIFIABLE' },
  unverified:    null
};

const TYPE_COLORS = {
  claim:      '#3B82F6',
  rebuttal:   '#8B5CF6',
  evidence:   '#10B981',
  question:   '#64748B',
  concession: '#F59E0B',
};

// ── AI Moderator Message ─────────────────────────────────────────────────────
function AiMessage({ msg }) {
  const isFactCheck  = msg.aiType === 'fact_check';
  const isConcession = msg.aiType === 'concession';

  const borderColor = isFactCheck
    ? (FACT_COLORS[msg.verdict]?.border || '#6366F1')
    : '#F59E0B';

  // Render simple markdown-ish bold + italic
  const renderText = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={j}>{part.slice(1, -1)}</em>;
        return part;
      });
      return <span key={i}>{parts}{i < text.split('\n').length - 1 && <br />}</span>;
    });
  };

  return (
    <div style={{
      marginBottom: '10px',
      padding: '12px 16px',
      borderRadius: '12px',
      background: 'rgba(15, 23, 42, 0.6)',
      border: `1px solid ${borderColor}44`,
      borderLeft: `3px solid ${borderColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '7px' }}>
        <Bot size={14} style={{ color: borderColor }} />
        <span style={{ fontWeight: '700', fontSize: '0.78rem', color: borderColor, letterSpacing: '0.04em' }}>
          AGORA AI {isFactCheck ? '· FACT CHECK' : isConcession ? '· CONCESSION' : ''}
        </span>
      </div>
      <p style={{ fontSize: '0.84rem', color: '#CBD5E1', lineHeight: '1.55', margin: 0, wordBreak: 'break-word' }}>
        {renderText(msg.text)}
      </p>
      {msg.sources?.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {msg.sources.slice(0, 3).map((s, i) => s.url && (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{
              fontSize: '0.68rem', color: '#60A5FA', background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px',
              padding: '1px 7px', textDecoration: 'none', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', display: 'inline-block'
            }}>
              🔗 {s.title || s.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Individual Message Bubble ─────────────────────────────────────────────────
function MessageBubble({ msg, node, isSelf, onConcede, onFactCheck, onOpenSubtree, room }) {
  const [hovered, setHovered] = useState(false);

  const factConf   = FACT_COLORS[node?.fact_status] || null;
  const typeColor  = TYPE_COLORS[node?.type] || '#3B82F6';
  const isConceded = node?.conceded || false;
  const hasSubtopic = node?.detected_subtopic && node?.subtopic_label;
  const hasFactClaim = node?.contains_factual_claim && node?.extracted_claim;

  // Find if a subtree was already opened from this node
  const existingSubtree = room?.subtrees
    ? Object.values(room.subtrees).find(st => st.parentNodeId === msg.id)
    : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        marginBottom: '10px',
        padding: '10px 14px',
        borderRadius: '12px',
        background: isConceded ? 'rgba(30,41,59,0.2)' : 'rgba(30, 41, 59, 0.45)',
        borderLeft: `3px solid ${isConceded ? '#475569' : typeColor}`,
        opacity: isConceded ? 0.55 : 1,
        transition: 'all 0.2s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5px', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: '700', fontSize: '0.82rem', color: isSelf ? '#60A5FA' : '#F472B6' }}>
          {msg.author}{isSelf && ' (You)'}
        </span>

        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Type badge */}
          {node?.type && (
            <span style={{
              fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
              background: `${typeColor}20`, border: `1px solid ${typeColor}55`,
              color: typeColor, textTransform: 'uppercase', letterSpacing: '0.05em'
            }}>
              {node.type}
            </span>
          )}

          {/* Fact status badge */}
          {factConf && (
            <span style={{
              fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
              background: factConf.bg, border: `1px solid ${factConf.border}`,
              color: factConf.text, textTransform: 'uppercase'
            }}>
              {factConf.label}
            </span>
          )}

          {/* Conceded badge */}
          {isConceded && (
            <span style={{
              fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
              background: 'rgba(100,116,139,0.2)', border: '1px solid #475569',
              color: '#94A3B8', textTransform: 'uppercase'
            }}>
              🏳 CONCEDED
            </span>
          )}

          {/* Fallacy badge */}
          {node?.fallacy_flags?.length > 0 && (
            <span style={{
              fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
              background: 'rgba(239,68,68,0.2)', border: '1px solid #EF4444',
              color: '#F87171', display: 'inline-flex', alignItems: 'center', gap: '2px'
            }}>
              <ShieldAlert size={8} /> FALLACY
            </span>
          )}
        </div>
      </div>

      {/* Message text */}
      <p style={{
        fontSize: '0.88rem', color: isConceded ? '#64748B' : '#F1F5F9',
        wordBreak: 'break-word', lineHeight: '1.5', margin: 0,
        textDecoration: isConceded ? 'line-through' : 'none'
      }}>
        {msg.text}
      </p>

      {/* Action chips — visible on hover or always on mobile */}
      {!isConceded && (hovered || hasSubtopic || hasFactClaim) && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>

          {/* 🔍 Check Fact — shows when AI detected a factual claim */}
          {hasFactClaim && node.fact_status === 'unverified' && (
            <button
              onClick={() => onFactCheck(msg.id, node.extracted_claim)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: '6px', color: '#A5B4FC', fontSize: '0.7rem',
                fontWeight: '600', padding: '3px 9px', cursor: 'pointer', transition: 'all 0.15s'
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.2)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
            >
              <Search size={10} /> Check Fact
            </button>
          )}

          {/* 🌿 Explore Subtree — shows when AI detected a subtopic */}
          {hasSubtopic && !existingSubtree && (
            <button
              onClick={() => onOpenSubtree(msg.id, node.subtopic_label)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: '6px', color: '#34D399', fontSize: '0.7rem',
                fontWeight: '600', padding: '3px 9px', cursor: 'pointer', transition: 'all 0.15s'
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.2)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.1)'; }}
            >
              <TreePine size={10} /> Explore: <em style={{ marginLeft: '2px', fontStyle: 'normal' }}>{node.subtopic_label}</em>
              <ChevronRight size={9} />
            </button>
          )}

          {/* Show existing subtree link */}
          {existingSubtree && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: '6px', color: '#6EE7B7', fontSize: '0.7rem',
              fontWeight: '600', padding: '3px 9px',
            }}>
              <TreePine size={9} /> Subtree: {existingSubtree.label}
            </span>
          )}

          {/* 🏳 Concede — only on own messages */}
          {isSelf && hovered && (
            <button
              onClick={onConcede}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                borderRadius: '6px', color: '#FCD34D', fontSize: '0.7rem',
                fontWeight: '600', padding: '3px 9px', cursor: 'pointer', transition: 'all 0.15s'
              }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.18)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.08)'; }}
            >
              <Flag size={10} /> Concede
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ChatPanel ────────────────────────────────────────────────────────────
export default function ChatPanel({ room, currentUser, onSendMessage, onConcedeNode, onFactCheck, onOpenSubtree }) {
  const [text, setText] = useState('');
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  const { messages = [], nodes = [] } = room || {};

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getNode = (msgId) => nodes.find(n => n.id === msgId);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  return (
    <div className="glass-panel" style={{
      display: 'flex', flexDirection: 'column',
      padding: '16px', flex: 1, minHeight: 0, overflow: 'hidden'
    }}>
      {/* Header */}
      <h3 style={{
        fontSize: '0.95rem', borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px', marginBottom: '12px',
        color: '#F8FAFC', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '8px'
      }}>
        Live Debate
        <span style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: '400', marginLeft: 'auto' }}>
          AI moderates automatically
        </span>
      </h3>

      {/* Messages list */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '10px' }}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            alignItems: 'center', height: '100%', color: '#475569',
            fontSize: '0.85rem', textAlign: 'center', gap: '8px'
          }}>
            <span style={{ fontSize: '1.5rem' }}>💬</span>
            <span>Start debating — just type freely.</span>
            <span style={{ fontSize: '0.75rem', color: '#334155' }}>
              The AI will classify your arguments, detect claims, and build the graph automatically.
            </span>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.isAI) return <AiMessage key={msg.id} msg={msg} />;
            const node = getNode(msg.id);
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                node={node}
                isSelf={msg.author === currentUser}
                onConcede={() => onConcedeNode(msg.id)}
                onFactCheck={onFactCheck}
                onOpenSubtree={onOpenSubtree}
                room={room}
              />
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Say anything… AI analyzes your argument in real time. (Enter to send, Shift+Enter for newline)"
          rows={2}
          style={{
            flex: 1,
            background: 'rgba(15,23,42,0.5)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            color: '#F8FAFC',
            padding: '10px 14px',
            fontSize: '0.875rem',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: '1.45',
            transition: 'border-color 0.2s'
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent-primary)'}
          onBlur={e  => e.target.style.borderColor = 'var(--border-color)'}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="btn-primary"
          style={{
            padding: '10px 16px',
            opacity: text.trim() ? 1 : 0.4,
            pointerEvents: text.trim() ? 'auto' : 'none',
            flexShrink: 0,
            alignSelf: 'flex-end'
          }}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
