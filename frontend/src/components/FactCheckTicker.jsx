import React from 'react';
import { Shield, CheckCircle, XCircle, AlertTriangle, HelpCircle, ExternalLink, Loader } from 'lucide-react';

export default function FactCheckTicker({ room }) {
  const { nodes = [] } = room || {};

  // Filter nodes that have checkable claims (any node that has gone through fact-checking)
  const factCheckedNodes = nodes
    .filter(n => n.fact_status && n.fact_status !== 'unverified')
    .sort((a, b) => b.timestamp - a.timestamp); // latest first

  const getVerdictStyle = (status) => {
    switch (status) {
      case 'checking':
        return {
          bg: 'rgba(245, 158, 11, 0.1)',
          border: 'rgba(245, 158, 11, 0.3)',
          text: '#F59E0B',
          icon: <Loader size={12} className="spin-slow" />
        };
      case 'true':
        return {
          bg: 'rgba(16, 185, 129, 0.1)',
          border: 'rgba(16, 185, 129, 0.3)',
          text: '#10B981',
          icon: <CheckCircle size={12} />
        };
      case 'false':
        return {
          bg: 'rgba(239, 68, 68, 0.1)',
          border: 'rgba(239, 68, 68, 0.3)',
          text: '#EF4444',
          icon: <XCircle size={12} />
        };
      case 'partially_true':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          border: 'rgba(245, 158, 11, 0.4)',
          text: '#F59E0B',
          icon: <AlertTriangle size={12} />
        };
      case 'failed':
      default:
        return {
          bg: 'rgba(100, 116, 139, 0.1)',
          border: 'rgba(100, 116, 139, 0.3)',
          text: '#94A3B8',
          icon: <HelpCircle size={12} />
        };
    }
  };

  return (
    <div className="glass-panel" style={{
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      flex: 1,
      minHeight: 0
    }}>
      <h3 style={{
        fontSize: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px',
        color: '#F8FAFC'
      }}>
        <Shield size={16} style={{ color: 'var(--accent-primary)' }} />
        <span>Live Fact-Check Feed</span>
      </h3>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        overflowY: 'auto',
        flex: 1,
        paddingRight: '4px'
      }}>
        {factCheckedNodes.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#64748B',
            fontSize: '0.85rem',
            textAlign: 'center',
            padding: '24px',
            gap: '8px'
          }}>
            <Shield size={24} strokeWidth={1.5} opacity={0.5} />
            <span>Factual statistics and claims will be automatically verified here.</span>
          </div>
        ) : (
          factCheckedNodes.map(node => {
            const style = getVerdictStyle(node.fact_status);
            return (
              <div key={node.id} style={{
                background: 'rgba(30, 41, 59, 0.25)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '0.85rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>{node.author}</span>
                  <span style={{
                    backgroundColor: style.bg,
                    border: `1px solid ${style.border}`,
                    color: style.text,
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    textTransform: 'uppercase'
                  }}>
                    {style.icon}
                    <span>{node.fact_status === 'failed' ? 'UNABLE TO VERIFY' : node.fact_status}</span>
                  </span>
                </div>

                <p style={{ color: '#E2E8F0', fontStyle: 'italic', background: 'rgba(0,0,0,0.1)', padding: '6px 8px', borderRadius: '6px' }}>
                  "{node.text}"
                </p>

                {node.fact_explanation && (
                  <p style={{ color: '#CBD5E1', fontSize: '0.8rem', lineHeight: '1.4' }}>
                    {node.fact_explanation}
                  </p>
                )}

                {node.sources && node.sources.length > 0 && (
                  <div style={{
                    borderTop: '1px dashed var(--border-color)',
                    paddingTop: '6px',
                    marginTop: '2px'
                  }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: '500' }}>Sources cited:</span>
                    <ul style={{ listStyle: 'none', padding: 0, marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {node.sources.map((src, idx) => (
                        <li key={idx} style={{ fontSize: '0.75rem' }}>
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: '#60A5FA',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              maxWidth: '100%',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            <ExternalLink size={10} />
                            <span>{src.title || src.url}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
