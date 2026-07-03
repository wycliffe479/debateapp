import React, { useState, useEffect } from 'react';
import { AlertTriangle, Sparkles, RefreshCw, Send, Check } from 'lucide-react';

export default function NudgeModal({ isOpen, data, onRephrase, onPostAnyway }) {
  const [editedText, setEditedText] = useState('');

  useEffect(() => {
    if (data && data.text) {
      setEditedText(data.text);
    }
  }, [data]);

  if (!isOpen || !data) return null;

  const { nodeId, fallacies } = data;

  const applySuggestion = (suggestion) => {
    setEditedText(suggestion);
  };

  const handleRephraseSubmit = (e) => {
    e.preventDefault();
    if (editedText.trim()) {
      onRephrase(nodeId, editedText);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(8px)',
      padding: '16px'
    }}>
      <div className="glass-panel glass-panel-glow" style={{
        width: '100%',
        maxWidth: '600px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
      }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--accent-danger)',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-danger)'
          }}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem' }}>AI Moderation: Logical Fallacy Nudge</h3>
            <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Private notification — only visible to you</span>
          </div>
        </div>

        {/* Info text */}
        <p style={{ fontSize: '0.9rem', color: '#CBD5E1', lineHeight: '1.5' }}>
          Your argument has been posted to the graph. However, the AI Moderator identified logical fallacies. 
          To improve your debate rating and stance credibility, you can rephrase your point below.
        </p>

        {/* Fallacies List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fallacies.map((fal, idx) => (
            <div key={idx} style={{
              background: 'rgba(239, 68, 68, 0.05)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  backgroundColor: 'var(--accent-danger)',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {fal.type}
                </span>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#E2E8F0' }}>{fal.explanation}</p>
              
              {fal.rephrase_suggestion && (
                <div style={{
                  marginTop: '6px',
                  background: 'rgba(59, 130, 246, 0.05)',
                  border: '1px dashed rgba(59, 130, 246, 0.2)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60A5FA', fontSize: '0.8rem', fontWeight: '500' }}>
                    <Sparkles size={14} />
                    <span>AI Suggested Rephrasing</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#93C5FD', fontStyle: 'italic' }}>
                    "{fal.rephrase_suggestion}"
                  </p>
                  <button
                    onClick={() => applySuggestion(fal.rephrase_suggestion)}
                    type="button"
                    style={{
                      alignSelf: 'flex-end',
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      borderRadius: '6px',
                      color: '#93C5FD',
                      fontSize: '0.75rem',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'}
                  >
                    <Check size={12} />
                    <span>Apply Suggestion</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Input Form */}
        <form onSubmit={handleRephraseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.85rem', color: '#94A3B8', fontWeight: '500' }}>Modify Message:</label>
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '10px 12px',
              fontSize: '0.875rem',
              resize: 'none',
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
          />
          
          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onPostAnyway}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                fontSize: '0.875rem',
                padding: '8px 16px',
                transition: 'color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = '#F8FAFC'}
              onMouseOut={(e) => e.currentTarget.style.color = '#94A3B8'}
            >
              Keep Original
            </button>
            <button
              type="submit"
              disabled={!editedText.trim() || editedText.trim() === data.text}
              style={{
                background: 'linear-gradient(135deg, var(--accent-success) 0%, #059669 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '0.875rem',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: (!editedText.trim() || editedText.trim() === data.text) ? 0.5 : 1,
                pointerEvents: (!editedText.trim() || editedText.trim() === data.text) ? 'none' : 'auto',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <Send size={14} />
              <span>Update Claim</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
