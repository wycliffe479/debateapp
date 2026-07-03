import React, { useState } from 'react';
import { Award, TrendingUp, Sparkles, BookOpen, AlertCircle, Loader } from 'lucide-react';

export default function Dashboard({ room, onReqSummary, summary, summaryLoading }) {
  const { participants = [], nodes = [], edges = [] } = room || {};

  // 1. Calculate Balance
  const sideA = participants[0] || 'Proposer';
  const sideB = participants[1] || 'Opponent';

  const nodesA = nodes.filter(n => n.author === sideA);
  const nodesB = nodes.filter(n => n.author === sideB);

  const strengthA = nodesA.reduce((sum, n) => sum + (n.strength_score || 0), 0);
  const strengthB = nodesB.reduce((sum, n) => sum + (n.strength_score || 0), 0);

  const totalStrength = strengthA + strengthB;
  const pctA = totalStrength > 0 ? (strengthA / totalStrength) * 100 : 50;
  const pctB = totalStrength > 0 ? (strengthB / totalStrength) * 100 : 50;

  // 2. Fallacy Counts per participant
  const fallacyCounts = {};
  participants.forEach(p => {
    fallacyCounts[p] = 0;
  });
  nodes.forEach(n => {
    if (n.fallacy_flags && n.fallacy_flags.length > 0 && fallacyCounts[n.author] !== undefined) {
      fallacyCounts[n.author] += n.fallacy_flags.length;
    }
  });

  // 3. Compute Convergence History
  // Convergence = (shared canonical concepts / total canonical concepts) * 100
  // Let's compute this at every point in node history (sorted by timestamp)
  const getConvergenceHistory = () => {
    const sortedNodes = [...nodes].sort((a, b) => a.timestamp - b.timestamp);
    const history = [];
    const runningNodes = [];

    // Pre-populate initial point
    history.push({ step: 0, val: 50 });

    sortedNodes.forEach((node, idx) => {
      runningNodes.push(node);
      const uniqueConcepts = new Set(runningNodes.map(n => n.canonical_concept_id));
      
      // Count concepts used by both sideA and sideB in the running subset
      let sharedCount = 0;
      uniqueConcepts.forEach(conceptId => {
        const hasA = runningNodes.some(n => n.canonical_concept_id === conceptId && n.author === sideA);
        const hasB = runningNodes.some(n => n.canonical_concept_id === conceptId && n.author === sideB);
        if (hasA && hasB) {
          sharedCount++;
        }
      });

      const totalConcepts = uniqueConcepts.size;
      const ratio = totalConcepts > 0 ? (sharedCount / totalConcepts) * 100 : 0;
      // Map ratio to a nicer percentage starting at 50%
      // e.g. 50% base + 50% * ratio
      const convergenceVal = 30 + (ratio * 0.7); // scale between 30% and 100%
      history.push({
        step: idx + 1,
        val: parseFloat(convergenceVal.toFixed(1))
      });
    });

    return history;
  };

  const convHistory = getConvergenceHistory();
  const latestConv = convHistory[convHistory.length - 1]?.val || 50;

  // SVG Line Chart Drawer
  const renderChart = () => {
    const width = 240;
    const height = 60;
    const padding = 5;

    if (convHistory.length <= 1) {
      return (
        <div style={{ fontSize: '0.8rem', color: '#64748B', textAlign: 'center', marginTop: '15px' }}>
          Awaiting more arguments...
        </div>
      );
    }

    const minX = 0;
    const maxX = convHistory.length - 1;
    const minY = 0;
    const maxY = 100;

    const points = convHistory.map((pt, idx) => {
      const x = padding + (idx / maxX) * (width - padding * 2);
      const y = height - padding - (pt.val / maxY) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} style={{ overflow: 'visible', marginTop: '10px' }}>
        {/* Grid line */}
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
        {/* Chart Line */}
        <polyline
          fill="none"
          stroke="url(#chartGrad)"
          strokeWidth="2.5"
          points={points}
        />
        {/* Glow Line */}
        <polyline
          fill="none"
          stroke="var(--accent-success)"
          strokeWidth="5"
          opacity="0.15"
          points={points}
        />
        {/* Gradients */}
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent-primary)" />
            <stop offset="100%" stopColor="var(--accent-success)" />
          </linearGradient>
        </defs>
        {/* Latest Dot */}
        {convHistory.length > 0 && (
          <circle
            cx={padding + ((convHistory.length - 1) / maxX) * (width - padding * 2)}
            cy={height - padding - (latestConv / maxY) * (height - padding * 2)}
            r="4"
            fill="var(--accent-success)"
            stroke="#080C14"
            strokeWidth="1.5"
          />
        )}
      </svg>
    );
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 280px 300px',
      gap: '16px',
      padding: '16px',
      minHeight: '140px'
    }}>
      {/* 1. Balance Meter Panel */}
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: '#94A3B8' }}>
            <Award size={16} />
            <span>Debate Balance</span>
          </h4>
          <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', color: '#CBD5E1' }}>
            Strength Weighted
          </span>
        </div>

        <div style={{ margin: '14px 0 8px 0' }}>
          <div className="balance-container">
            <div className="balance-fill-left" style={{ width: `${pctA}%` }} />
            <div className="balance-fill-right" style={{ width: `${pctB}%` }} />
            <div className="balance-center-line" />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>{sideA}</span>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Score: {strengthA.toFixed(1)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontWeight: '600', color: 'var(--accent-purple)' }}>{sideB}</span>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Score: {strengthB.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* 2. Stance Convergence Line Chart */}
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: '#94A3B8' }}>
            <TrendingUp size={16} />
            <span>Stance Convergence</span>
          </h4>
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--accent-success)' }}>
            {latestConv.toFixed(0)}%
          </span>
        </div>
        
        {renderChart()}
      </div>

      {/* 3. Fallacies & Summary Panel */}
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: '#94A3B8' }}>
            <AlertCircle size={16} />
            <span>Fallacies & Summary</span>
          </h4>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '8px 0' }}>
          {participants.map(p => (
            <div key={p} style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-color)',
              padding: '4px 10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.75rem'
            }}>
              <span style={{ color: '#E2E8F0', fontWeight: '500' }}>{p}:</span>
              <span style={{
                background: (fallacyCounts[p] || 0) > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.1)',
                border: `1px solid ${(fallacyCounts[p] || 0) > 0 ? 'var(--accent-danger)' : 'var(--accent-success)'}`,
                color: (fallacyCounts[p] || 0) > 0 ? 'var(--accent-danger)' : 'var(--accent-success)',
                padding: '1px 6px',
                borderRadius: '6px',
                fontWeight: 'bold',
                fontSize: '0.7rem'
              }}>
                {fallacyCounts[p] || 0} flag{(fallacyCounts[p] || 0) !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={onReqSummary}
          disabled={summaryLoading}
          className="btn-primary"
          style={{
            width: '100%',
            padding: '6px 12px',
            fontSize: '0.8rem',
            justifyContent: 'center'
          }}
        >
          {summaryLoading ? (
            <>
              <Loader size={12} className="spin-slow" />
              <span>Analyzing Debate...</span>
            </>
          ) : (
            <>
              <Sparkles size={12} />
              <span>Generate AI Summary</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
