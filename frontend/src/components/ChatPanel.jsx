import React, { useState, useEffect, useRef } from 'react';
import { Send, X, Reply, ShieldAlert, GitBranch, MessageSquare, Search, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

// Message type configuration
const MSG_TYPES = [
  { key: 'claim',      label: 'Claim',      color: '#2563EB',  desc: 'Assert a new position or argument' },
  { key: 'rebuttal',   label: 'Rebuttal',   color: '#7C3AED',  desc: 'Directly challenge a specific point' },
  { key: 'evidence',   label: 'Evidence',   color: '#059669',  desc: 'Cite a fact, study, or data point' },
  { key: 'question',   label: 'Question',   color: '#475569',  desc: 'Ask for clarification or proof' },
  { key: 'concession', label: 'Concession', color: '#D97706',  desc: 'Acknowledge a valid opposing point' },
  { key: 'subtree',    label: 'New Branch', color: '#BE185D',  desc: 'Start a new sub-argument thread' },
];

function TypePicker({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const current = MSG_TYPES.find(t => t.key === selected) || MSG_TYPES[0];

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: `${current.color}22`,
          border: `1px solid ${current.color}66`,
          borderRadius: '8px',
          color: current.color,
          padding: '8px 12px',
          fontSize: '0.8rem',
          fontWeight: '600',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'all 0.2s'
        }}
      >
        <span>{current.label}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: '6px',
          background: 'rgba(10, 15, 28, 0.97)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          overflow: 'hidden',
          zIndex: 100,
          minWidth: '200px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {MSG_TYPES.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => { onChange(t.key); setOpen(false); }}
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '2px',
                padding: '10px 14px',
                background: selected === t.key ? `${t.color}18` : 'transparent',
                border: 'none',
                borderLeft: selected === t.key ? `3px solid ${t.color}` : '3px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.15s'
              }}
              onMouseOver={e => e.currentTarget.style.background = `${t.color}15`}
              onMouseOut={e => e.currentTarget.style.background = selected === t.key ? `${t.color}18` : 'transparent'}
            >
              <span style={{ color: t.color, fontWeight: '700', fontSize: '0.8rem' }}>{t.label}</span>
              <span style={{ color: '#64748B', fontSize: '0.72rem' }}>{t.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Per-message inline reply actions
function MessageActions({ msg, node, isSelf, onReply, onQuickReply }) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {/* Always show reply options on others' messages */}
      {!isSelf && (
        <>
          <button
            onClick={() => onReply(node, 'rebuttal')}
            style={{
              background: 'rgba(124,58,237,0.1)',
              border: '1px solid rgba(124,58,237,0.3)',
              borderRadius: '6px',
              color: '#A78BFA',
              fontSize: '0.7rem',
              fontWeight: '600',
              padding: '3px 8px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '3px'
            }}
          >
            <Reply size={10} /> Rebut
          </button>
          <button
            onClick={() => onReply(node, 'supports')}
            style={{
              background: 'rgba(5,150,105,0.1)',
              border: '1px solid rgba(5,150,105,0.3)',
              borderRadius: '6px',
              color: '#34D399',
              fontSize: '0.7rem',
              fontWeight: '600',
              padding: '3px 8px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '3px'
            }}
          >
            ✓ Support
          </button>
          <button
            onClick={() => onReply(node, 'questions')}
            style={{
              background: 'rgba(71,85,105,0.15)',
              border: '1px solid rgba(71,85,105,0.4)',
              borderRadius: '6px',
              color: '#94A3B8',
              fontSize: '0.7rem',
              fontWeight: '600',
              padding: '3px 8px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '3px'
            }}
          >
            ? Question
          </button>
        </>
      )}

      {/* New subtree always available on any message */}
      <button
        onClick={() => onReply(node, 'subtree')}
        style={{
          background: 'rgba(190,24,93,0.1)',
          border: '1px solid rgba(190,24,93,0.3)',
          borderRadius: '6px',
          color: '#F472B6',
          fontSize: '0.7rem',
          fontWeight: '600',
          padding: '3px 8px',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '3px'
        }}
      >
        <GitBranch size={10} /> Branch
      </button>
    </div>
  );
}

export default function ChatPanel({ room, currentUser, onSendMessage }) {
  const [text, setText] = useState('');
  const [msgType, setMsgType] = useState('claim');
  const [replyTarget, setReplyTarget] = useState(null); // { node, relation }
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const { messages = [], nodes = [] } = room || {};

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getMsgNode = (msgId) => nodes.find(n => n.id === msgId);

  const handleReply = (node, relation) => {
    setReplyTarget({ node, relation });
    // Auto-set message type to match action
    if (relation === 'rebuttal' || relation === 'rebuts') setMsgType('rebuttal');
    else if (relation === 'supports') setMsgType('evidence');
    else if (relation === 'questions') setMsgType('question');
    else if (relation === 'subtree') setMsgType('claim');
    inputRef.current?.focus();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    // subtree = no parent, fresh chain
    const replyId = (replyTarget && replyTarget.relation !== 'subtree') ? replyTarget.node?.id : null;
    const relation = replyTarget?.relation || null;

    onSendMessage(text, replyId, relation, msgType);
    setText('');
    setReplyTarget(null);
    setMsgType('claim');
  };

  const cancelReply = () => setReplyTarget(null);

  return (
    <div className="glass-panel" style={{
      display: 'flex',
      flexDirection: 'column',
      padding: '16px',
      flex: 1,
      minHeight: 0,
      overflow: 'hidden'
    }}>
      <h3 style={{
        fontSize: '1rem',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px',
        marginBottom: '12px',
        color: '#F8FAFC',
        flexShrink: 0
      }}>
        Debate Chat Log
      </h3>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '10px' }}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            height: '100%', color: '#64748B', fontSize: '0.875rem', textAlign: 'center'
          }}>
            Post a claim to start the debate.
          </div>
        ) : (
          messages.map((msg) => {
            const node = getMsgNode(msg.id);
            const nodeType = node?.type || 'claim';
            const factStatus = node?.fact_status || 'unverified';
            const isSelf = msg.author === currentUser;
            const typeConf = MSG_TYPES.find(t => t.key === nodeType) || MSG_TYPES[0];

            return (
              <div key={msg.id} style={{
                marginBottom: '12px',
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'rgba(30, 41, 59, 0.4)',
                borderLeft: `4px solid ${typeConf.color}`,
                transition: 'all 0.2s'
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', flexWrap: 'wrap', gap: '4px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '0.82rem', color: isSelf ? '#60A5FA' : '#F472B6' }}>
                    {msg.author}{isSelf && ' (You)'}
                  </span>

                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {/* Type badge */}
                    <span style={{
                      fontSize: '0.62rem', fontWeight: '700', padding: '1px 6px',
                      borderRadius: '4px', background: `${typeConf.color}22`,
                      border: `1px solid ${typeConf.color}55`, color: typeConf.color,
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>{nodeType}</span>

                    {/* Fact status badge */}
                    {factStatus !== 'unverified' && (
                      <span style={{
                        fontSize: '0.62rem', fontWeight: '700', padding: '1px 6px',
                        borderRadius: '4px', textTransform: 'uppercase',
                        background: factStatus === 'true' ? 'rgba(16,185,129,0.15)' :
                                    factStatus === 'false' ? 'rgba(239,68,68,0.15)' :
                                    factStatus === 'checking' ? 'rgba(245,158,11,0.15)' :
                                    'rgba(100,116,139,0.15)',
                        border: `1px solid ${
                          factStatus === 'true' ? 'var(--accent-success)' :
                          factStatus === 'false' ? 'var(--accent-danger)' :
                          factStatus === 'checking' ? 'var(--accent-warning)' : 'var(--accent-gray)'}`,
                        color: factStatus === 'true' ? 'var(--accent-success)' :
                               factStatus === 'false' ? 'var(--accent-danger)' :
                               factStatus === 'checking' ? 'var(--accent-warning)' : '#94A3B8'
                      }}>{factStatus === 'checking' ? '⟳ checking' : factStatus === 'failed' ? 'unverifiable' : factStatus}</span>
                    )}

                    {/* Fallacy badge */}
                    {node?.fallacy_flags?.length > 0 && (
                      <span style={{
                        fontSize: '0.62rem', fontWeight: '700', padding: '1px 6px',
                        borderRadius: '4px', background: 'rgba(239,68,68,0.2)',
                        border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)',
                        display: 'inline-flex', alignItems: 'center', gap: '2px'
                      }}>
                        <ShieldAlert size={9} /> FALLACY
                      </span>
                    )}
                  </div>
                </div>

                {/* Message text */}
                <p style={{ fontSize: '0.88rem', color: '#F1F5F9', wordBreak: 'break-word', lineHeight: '1.45' }}>
                  {msg.text}
                </p>

                {/* Inline reply / branch actions */}
                <MessageActions
                  msg={msg}
                  node={node}
                  isSelf={isSelf}
                  onReply={handleReply}
                />
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Reply target banner */}
      {replyTarget && (
        <div style={{
          background: 'rgba(59,130,246,0.07)',
          border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: '8px',
          padding: '8px 12px',
          marginBottom: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '0.78rem', color: '#93C5FD', overflow: 'hidden' }}>
            {replyTarget.relation === 'subtree'
              ? <span style={{ color: '#F472B6' }}><GitBranch size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Starting a new branch from this point</span>
              : <span>
                  <span style={{ fontWeight: '600' }}>
                    {replyTarget.relation === 'supports' ? '✓ Supporting' :
                     replyTarget.relation === 'questions' ? '? Questioning' : '⚔ Rebutting'}
                  </span>
                  {' → '}
                  <span style={{ color: '#CBD5E1', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px', display: 'inline-block', verticalAlign: 'bottom' }}>
                    "{replyTarget.node?.text}"
                  </span>
                </span>
            }
          </div>
          <button onClick={cancelReply} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <TypePicker selected={msgType} onChange={setMsgType} />
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={
              msgType === 'rebuttal'   ? 'Counter the argument...' :
              msgType === 'evidence'   ? 'Cite data or a source...' :
              msgType === 'question'   ? 'Ask a clarifying question...' :
              msgType === 'concession' ? 'Acknowledge a valid point...' :
              msgType === 'subtree'    ? 'Start a new sub-thread...' :
                                        'State a claim...'
            }
            style={{
              flex: 1,
              background: 'rgba(15,23,42,0.5)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '9px 14px',
              fontSize: '0.875rem',
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent-primary)'}
            onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="btn-primary"
            style={{ padding: '9px 14px', opacity: text.trim() ? 1 : 0.4, pointerEvents: text.trim() ? 'auto' : 'none', flexShrink: 0 }}
          >
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
