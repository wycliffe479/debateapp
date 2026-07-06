import React, { useState, useEffect, useRef } from 'react';
import { Flag, Swords, TreePine, X } from 'lucide-react';

/**
 * NodeContextMenu — appears when a user clicks a node on either graph.
 * Shows different options depending on node ownership and graph type.
 */
export default function NodeContextMenu({
  node,
  currentUser,
  graphType,   // 'battle' | 'knowledge'
  position,    // { x, y } in screen pixels
  onConcede,
  onAttack,
  onSubtree,
  onClose,
}) {
  const [confirmConcede, setConfirmConcede] = useState(false);
  const menuRef = useRef(null);

  const isOwn = node?.author === currentUser;
  const isBattle = graphType === 'battle';

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!node) return null;

  const shortText = node.text?.length > 60
    ? node.text.substring(0, 57) + '…'
    : node.text;

  // Clamp to viewport
  const style = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 230),
    top: Math.min(position.y, window.innerHeight - 200),
    zIndex: 9999,
    width: '220px',
    background: 'rgba(10, 16, 30, 0.96)',
    border: '1px solid rgba(99,102,241,0.35)',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
    backdropFilter: 'blur(16px)',
    overflow: 'hidden',
    animation: 'fadeInScale 0.12s ease-out',
  };

  const btnStyle = (color) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    background: 'transparent',
    border: 'none',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    color,
    fontSize: '0.82rem',
    fontWeight: '600',
    padding: '10px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.15s',
    fontFamily: 'inherit',
  });

  return (
    <div ref={menuRef} style={style}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '8px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: '700',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>
            {isOwn ? '📌 Your argument' : `⚡ ${node.author}'s argument`}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#CBD5E1', lineHeight: '1.4',
            wordBreak: 'break-word' }}>
            {shortText}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#475569',
          cursor: 'pointer', padding: '2px', flexShrink: 0,
        }}>
          <X size={13} />
        </button>
      </div>

      {/* Concede — own nodes only, with confirmation */}
      {isOwn && !confirmConcede && (
        <button
          style={btnStyle('#FCD34D')}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(245,158,11,0.12)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => setConfirmConcede(true)}
        >
          <Flag size={14} style={{ color: '#F59E0B', flexShrink: 0 }} />
          🏳 Concede this claim
        </button>
      )}

      {/* Concede confirmation */}
      {isOwn && confirmConcede && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p style={{ fontSize: '0.75rem', color: '#F87171', margin: '0 0 8px',
            lineHeight: '1.45' }}>
            Remove this node and all its child arguments from the graph?
          </p>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => { onConcede(node.id); onClose(); }}
              style={{
                flex: 1, padding: '6px 0', background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.35)', borderRadius: '7px',
                color: '#F87171', fontSize: '0.75rem', fontWeight: '700',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Yes, remove
            </button>
            <button
              onClick={() => setConfirmConcede(false)}
              style={{
                flex: 1, padding: '6px 0', background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px',
                color: '#94A3B8', fontSize: '0.75rem', fontWeight: '700',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Attack — opponent nodes on Battle Graph only */}
      {!isOwn && isBattle && (
        <button
          style={btnStyle('#F87171')}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => { onAttack({ nodeId: node.id, text: node.text }); onClose(); }}
        >
          <Swords size={14} style={{ color: '#EF4444', flexShrink: 0 }} />
          ⚔️ Attack this argument
        </button>
      )}

      {/* Explore Subtree — all nodes */}
      <button
        style={btnStyle('#34D399')}
        onMouseOver={e => e.currentTarget.style.background = 'rgba(16,185,129,0.1)'}
        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
        onClick={() => {
          const label = node.text?.substring(0, 40) || 'Subtopic';
          onSubtree(node.id, label);
          onClose();
        }}
      >
        <TreePine size={14} style={{ color: '#10B981', flexShrink: 0 }} />
        🌿 Explore subtree
      </button>
    </div>
  );
}
