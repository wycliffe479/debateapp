import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, TreePine, Users } from 'lucide-react';

export default function SubtreePanel({ subtree, currentUser, onSendMessage, onClose }) {
  const [text, setText] = useState('');
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  const messages = subtree?.messages || [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMessage(subtree.id, trimmed);
    setText('');
    inputRef.current?.focus();
  };

  if (!subtree) return null;

  return (
    <div className="glass-panel" style={{
      display: 'flex', flexDirection: 'column',
      padding: '16px', flex: 1, minHeight: 0, overflow: 'hidden',
      borderLeft: '2px solid rgba(16,185,129,0.3)',
      background: 'rgba(5, 18, 12, 0.55)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        borderBottom: '1px solid rgba(16,185,129,0.15)',
        paddingBottom: '10px', marginBottom: '12px', flexShrink: 0
      }}>
        <button
          onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '7px', color: '#94A3B8', fontSize: '0.76rem',
            fontWeight: '600', padding: '4px 10px', cursor: 'pointer',
            transition: 'all 0.15s', flexShrink: 0
          }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseOut={e  => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
        >
          <ArrowLeft size={12} /> Main debate
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 }}>
          <TreePine size={14} style={{ color: '#34D399', flexShrink: 0 }} />
          <span style={{
            fontWeight: '700', fontSize: '0.88rem', color: '#6EE7B7',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {subtree.label}
          </span>
        </div>

        <span style={{ fontSize: '0.68rem', color: '#475569', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Users size={10} /> {messages.length} msg{messages.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Created-by banner */}
      <div style={{
        background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
        borderRadius: '8px', padding: '6px 12px', marginBottom: '10px',
        fontSize: '0.72rem', color: '#6EE7B7', flexShrink: 0
      }}>
        🌿 Subtree opened by <strong>{subtree.createdBy || 'a debater'}</strong> — scoped discussion on this branch
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '10px' }}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            alignItems: 'center', height: '100%', color: '#475569',
            fontSize: '0.82rem', textAlign: 'center', gap: '8px'
          }}>
            <TreePine size={28} style={{ color: '#334155' }} />
            <span>No messages yet in this branch.</span>
            <span style={{ fontSize: '0.72rem', color: '#334155' }}>
              Focus the conversation on: <em style={{ color: '#6EE7B7' }}>{subtree.label}</em>
            </span>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.author === currentUser;
            return (
              <div
                key={msg.id}
                style={{
                  marginBottom: '9px',
                  padding: '9px 13px',
                  borderRadius: '10px',
                  background: 'rgba(16,185,129,0.06)',
                  borderLeft: `3px solid ${isSelf ? '#10B981' : '#8B5CF6'}`,
                }}
              >
                <span style={{
                  fontWeight: '700', fontSize: '0.78rem',
                  color: isSelf ? '#34D399' : '#C4B5FD', display: 'block',
                  marginBottom: '4px'
                }}>
                  {msg.author}{isSelf && ' (You)'}
                </span>
                <p style={{ fontSize: '0.86rem', color: '#CBD5E1', margin: 0, lineHeight: '1.45', wordBreak: 'break-word' }}>
                  {msg.text}
                </p>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Discuss "${subtree.label}"… (Enter to send)`}
          rows={2}
          style={{
            flex: 1,
            background: 'rgba(15,23,42,0.5)',
            border: '1px solid rgba(16,185,129,0.2)',
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
          onFocus={e => e.target.style.borderColor = '#10B981'}
          onBlur={e  => e.target.style.borderColor = 'rgba(16,185,129,0.2)'}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '10px 14px', flexShrink: 0, alignSelf: 'flex-end',
            background: text.trim() ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.05)',
            border: '1px solid rgba(16,185,129,0.35)',
            borderRadius: '8px', color: '#34D399',
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            opacity: text.trim() ? 1 : 0.4,
            transition: 'all 0.15s'
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
