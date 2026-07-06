import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape from 'cytoscape';
import { ZoomIn, ZoomOut, Maximize, RefreshCw, Compass } from 'lucide-react';
import NodeContextMenu from './NodeContextMenu';

export default function GraphContainer({
  room,
  selectedNode,
  setSelectedNode,
  currentUser,
  onConcede,
  onAttack,
  onOpenSubtree,
  onNodesRemoved,
}) {
  const [viewMode, setViewMode] = useState('battle');

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null);
  // { node: rawNode, position: {x,y}, graphType }

  const [leftMinimapData,  setLeftMinimapData]  = useState(null);
  const [rightMinimapData, setRightMinimapData] = useState(null);

  const leftCyRef           = useRef(null);
  const rightCyRef          = useRef(null);
  const leftContainerRef    = useRef(null);
  const rightContainerRef   = useRef(null);

  const { nodes = [], edges = [], topic = '', participants = [] } = room || {};

  // ── Rebuild graphs whenever data or view changes ─────────────────────────
  useEffect(() => {
    if (leftCyRef.current)  leftCyRef.current.destroy();
    if (rightCyRef.current) rightCyRef.current.destroy();

    if (viewMode === 'battle') {
      initBattleGraph(leftContainerRef.current, leftCyRef, setLeftMinimapData);
    } else if (viewMode === 'knowledge') {
      initKnowledgeGraph(leftContainerRef.current, leftCyRef, setLeftMinimapData);
    } else if (viewMode === 'side-by-side') {
      initKnowledgeGraph(leftContainerRef.current, leftCyRef, setLeftMinimapData);
      initBattleGraph(rightContainerRef.current, rightCyRef, setRightMinimapData);
    }

    return () => {
      if (leftCyRef.current)  leftCyRef.current.destroy();
      if (rightCyRef.current) rightCyRef.current.destroy();
    };
  }, [viewMode, nodes, edges]);

  // ── Focus dim on selection ────────────────────────────────────────────────
  useEffect(() => {
    applyFocusMode(leftCyRef.current);
    applyFocusMode(rightCyRef.current);
  }, [selectedNode]);

  // ── Battle Graph — FOR left / AGAINST right ───────────────────────────────
  const initBattleGraph = (container, cyStoreRef, setMinimap) => {
    if (!container) return;

    const sideA = participants[0] || 'Proposer';  // FOR  → left
    const sideB = participants[1] || 'Opponent';  // AGAINST → right

    const cyNodes = nodes.map(node => {
      // Depth via chain_parent_id chain
      let depth = 0;
      let curr = node.chain_parent_id;
      while (curr) {
        const p = nodes.find(n => n.id === curr);
        if (p) { depth++; curr = p.chain_parent_id; } else break;
      }

      const isSideA = node.author === sideA;
      // FOR side: x grows left  (negative). AGAINST: x grows right (positive).
      // Depth pushes nodes further from center so clash zone stays clear.
      const x = isSideA
        ? -(220 + depth * 150)   // FOR: left column
        :  (220 + depth * 150);  // AGAINST: right column

      const authorNodes = nodes.filter(n => n.author === node.author);
      const yIndex = authorNodes.findIndex(n => n.id === node.id);
      const y = yIndex * 115 - (authorNodes.length * 55);

      const isClashing = edges.some(
        e => e.to === node.id &&
          (e.relation_type === 'attacks' || e.relation_type === 'rebuts') &&
          !e.resolved
      );
      const shortText = node.text.length > 28
        ? node.text.substring(0, 25) + '...'
        : node.text;

      return {
        data: {
          id: node.id,
          label: `${node.author}:\n${shortText}`,
          type: node.type,
          fact_status: node.fact_status,
          fallacies_count: node.fallacy_flags ? node.fallacy_flags.length : 0,
          strength: node.strength_score || 1.0,
          isClashing,
          raw: node,
        },
        position: { x, y },
      };
    });

    const cyEdges = edges.map(edge => {
      const fromAuthor = nodes.find(n => n.id === edge.from)?.author;
      const toAuthor   = nodes.find(n => n.id === edge.to)?.author;
      const isCross    = fromAuthor !== toAuthor;
      return {
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          relation_type: edge.relation_type,
          edge_type: edge.type || 'normal',  // 'clash' | 'normal'
          winner: edge.winner_node_id,
          resolved: edge.resolved,
          curve: isCross ? 'bezier' : 'straight',
        },
      };
    });

    const cy = cytoscape({
      container,
      elements: [...cyNodes, ...cyEdges],
      style: getGraphStylesheet(false),
      layout: { name: 'preset' },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    setupGraphEvents(cy, cyStoreRef, setMinimap, 'battle');
  };

  // ── Knowledge Graph ───────────────────────────────────────────────────────
  const initKnowledgeGraph = (container, cyStoreRef, setMinimap) => {
    if (!container) return;

    const conceptMap = {};
    const cyNodes = [];
    const cyEdges = [];

    cyNodes.push({
      data: {
        id: 'topic_root',
        label: `Motion:\n${topic.length > 35 ? topic.substring(0, 32) + '...' : topic}`,
        type: 'root',
        fact_status: 'unverified',
        strength: 2.0,
        raw: { id: 'topic_root', text: topic, author: 'AI Moderator', type: 'root' },
      },
    });

    nodes.forEach(node => {
      const cId = node.canonical_concept_id || node.id;
      if (!conceptMap[cId]) {
        conceptMap[cId] = {
          id: cId, text: node.text, authorList: [node.author],
          type: node.type, fact_status: node.fact_status,
          fallacies_count: node.fallacy_flags ? node.fallacy_flags.length : 0,
          dependentsCount: 0, raw: node,
        };
      } else {
        if (!conceptMap[cId].authorList.includes(node.author))
          conceptMap[cId].authorList.push(node.author);
        if (node.fact_status === 'true') conceptMap[cId].fact_status = 'true';
      }
    });

    edges.forEach(edge => {
      const targetNode = nodes.find(n => n.id === edge.to);
      if (targetNode) {
        const tId = targetNode.canonical_concept_id || targetNode.id;
        if (conceptMap[tId]) conceptMap[tId].dependentsCount++;
      }
    });

    Object.values(conceptMap).forEach(concept => {
      const authors = concept.authorList.join(' & ');
      const shortText = concept.text.length > 25
        ? concept.text.substring(0, 22) + '...'
        : concept.text;
      cyNodes.push({
        data: {
          id: concept.id,
          label: `${authors}:\n${shortText}`,
          type: concept.type,
          fact_status: concept.fact_status,
          fallacies_count: concept.fallacies_count,
          strength: 1.0 + concept.dependentsCount * 0.4,
          raw: concept.raw,
        },
      });
      if (concept.type === 'claim') {
        cyEdges.push({
          data: {
            id: `edge_root_${concept.id}`,
            source: concept.id,
            target: 'topic_root',
            relation_type: 'supports',
            edge_type: 'normal',
            curve: 'straight',
          },
        });
      }
    });

    edges.forEach(edge => {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode   = nodes.find(n => n.id === edge.to);
      if (fromNode && toNode) {
        const fromC = fromNode.canonical_concept_id || fromNode.id;
        const toC   = toNode.canonical_concept_id   || toNode.id;
        if (fromC !== toC) {
          cyEdges.push({
            data: {
              id: `edge_concept_${edge.id}`,
              source: fromC,
              target: toC,
              relation_type: edge.relation_type,
              edge_type: edge.type || 'normal',
              resolved: edge.resolved,
              winner: edge.winner_node_id
                ? (nodes.find(n => n.id === edge.winner_node_id)?.canonical_concept_id || edge.winner_node_id)
                : null,
              curve: 'straight',
            },
          });
        }
      }
    });

    const cy = cytoscape({
      container,
      elements: [...cyNodes, ...cyEdges],
      style: getGraphStylesheet(true),
      layout: {
        name: 'cose',
        idealEdgeLength: 100, nodeOverlap: 20, refresh: 20, fit: true,
        padding: 30, randomize: false, componentSpacing: 100,
        nodeRepulsion: 400000, edgeElasticity: 100, nestingFactor: 5,
        gravity: 80, numIter: 1000, initialTemp: 200, coolingFactor: 0.95, minTemp: 1.0,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    setupGraphEvents(cy, cyStoreRef, setMinimap, 'knowledge');
  };

  // ── Shared graph events ───────────────────────────────────────────────────
  const setupGraphEvents = (cy, storeRef, setMinimap, graphType) => {
    storeRef.current = cy;

    cy.on('tap', 'node', (evt) => {
      const nodeData = evt.target.data('raw');
      if (!nodeData || nodeData.id === 'topic_root') return;

      setSelectedNode(nodeData);

      // Show context menu at screen position of the node
      const pos = evt.target.renderedPosition();
      const container = cy.container();
      const rect = container.getBoundingClientRect();
      setContextMenu({
        node: nodeData,
        position: { x: rect.left + pos.x + 10, y: rect.top + pos.y + 10 },
        graphType,
      });
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
        setContextMenu(null);
      }
    });

    const updateMinimap = () => {
      const bounds = cy.elements().boundingBox();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const width = cy.width();
      const height = cy.height();
      setMinimap({
        bounds, pan, zoom, width, height,
        nodes: cy.nodes().map(n => ({
          x: n.position('x'), y: n.position('y'),
          color: n.style('background-color'), id: n.id(),
        })),
      });
    };

    cy.on('pan zoom viewport resize', updateMinimap);
    setTimeout(() => { cy.fit(30); updateMinimap(); }, 100);
  };

  // ── Focus mode ────────────────────────────────────────────────────────────
  const applyFocusMode = (cy) => {
    if (!cy) return;
    if (!selectedNode) { cy.elements().removeClass('dimmed focused'); return; }
    const id = selectedNode.canonical_concept_id || selectedNode.id;
    const cyNode = cy.getElementById(id);
    if (cyNode.length > 0) {
      cy.elements().addClass('dimmed');
      cyNode.neighborhood().add(cyNode).removeClass('dimmed').addClass('focused');
    }
  };

  // ── Stylesheet ────────────────────────────────────────────────────────────
  const getGraphStylesheet = (isKnowledge) => [
    {
      selector: 'node',
      style: {
        content: 'data(label)',
        'text-wrap': 'wrap',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-family': 'Plus Jakarta Sans',
        'font-size': '10px',
        'font-weight': '600',
        color: '#F8FAFC',
        'background-color': (ele) => {
          const t = ele.data('type');
          if (t === 'root')       return '#0F172A';
          if (t === 'claim')      return '#2563EB';
          if (t === 'evidence')   return '#059669';
          if (t === 'rebuttal')   return '#7C3AED';
          if (t === 'question')   return '#475569';
          if (t === 'concession') return '#D97706';
          return '#3B82F6';
        },
        'border-width': '3px',
        'border-color': (ele) => {
          if (ele.data('type') === 'root') return 'var(--border-color)';
          const s = ele.data('fact_status');
          if (s === 'true')           return '#10B981';
          if (s === 'false')          return '#EF4444';
          if (s === 'partially_true') return '#F59E0B';
          if (s === 'checking')       return '#F59E0B';
          if (s === 'failed')         return '#94A3B8';
          return '#64748B';
        },
        'border-style': (ele) => ele.data('fact_status') === 'checking' ? 'dashed' : 'solid',
        width: (ele) => `${55 + Math.min((ele.data('strength') || 1.0) * 10, 40)}px`,
        height: (ele) => `${55 + Math.min((ele.data('strength') || 1.0) * 10, 40)}px`,
        shape: (ele) => ele.data('type') === 'root' ? 'round-rectangle' : 'ellipse',
        'transition-property': 'background-color, border-color, opacity',
        'transition-duration': '0.3s',
      },
    },
    {
      // Normal edges (supports, questions, chain)
      selector: 'edge[edge_type != "clash"]',
      style: {
        width: '2.5px',
        'line-color': (ele) => {
          const rt = ele.data('relation_type');
          if (rt === 'attacks' || rt === 'rebuts') {
            return ele.data('resolved')
              ? (ele.data('winner') === ele.data('source') ? '#DC2626' : 'rgba(239,68,68,0.1)')
              : '#EF4444';
          }
          return 'rgba(59,130,246,0.4)';
        },
        'target-arrow-color': (ele) => {
          const rt = ele.data('relation_type');
          return (rt === 'attacks' || rt === 'rebuts') ? '#EF4444' : '#3B82F6';
        },
        'target-arrow-shape': 'triangle',
        'curve-style': 'data(curve)',
        'control-point-step-size': '60px',
        'arrow-scale': '1.2',
        opacity: (ele) => {
          if (ele.data('resolved') && ele.data('winner') !== ele.data('source')) return 0.15;
          return 0.7;
        },
      },
    },
    {
      // Clash edges — red, thicker, dashed bezier curve
      selector: 'edge[edge_type = "clash"]',
      style: {
        width: '3.5px',
        'line-color': '#EF4444',
        'line-style': 'dashed',
        'line-dash-pattern': [8, 5],
        'target-arrow-color': '#EF4444',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'control-point-step-size': '80px',
        'arrow-scale': '1.4',
        opacity: 0.9,
      },
    },
    { selector: '.dimmed',  style: { opacity: 0.12 } },
    { selector: '.focused', style: { opacity: 1.0, 'shadow-blur': '15px', 'shadow-color': 'rgba(59,130,246,0.6)' } },
  ];

  // ── Zoom/Pan helpers ──────────────────────────────────────────────────────
  const handleZoomIn  = (ref) => ref.current?.zoom(ref.current.zoom() * 1.2);
  const handleZoomOut = (ref) => ref.current?.zoom(ref.current.zoom() / 1.2);
  const handleFit     = (ref) => ref.current?.fit(40);
  const handleReset   = (ref) => { ref.current?.zoom(1); ref.current?.center(); };

  // ── Minimap ───────────────────────────────────────────────────────────────
  const Minimap = ({ data, cyRef }) => {
    if (!data?.bounds) return null;
    const { bounds, pan, zoom, width, height, nodes: miniNodes } = data;
    const vx1 = -pan.x / zoom,  vy1 = -pan.y / zoom;
    const vx2 = (width - pan.x) / zoom, vy2 = (height - pan.y) / zoom;
    const ux1 = Math.min(bounds.x1, vx1) - 50, uy1 = Math.min(bounds.y1, vy1) - 50;
    const ux2 = Math.max(bounds.x2, vx2) + 50, uy2 = Math.max(bounds.y2, vy2) + 50;
    const uW = ux2 - ux1, uH = uy2 - uy1;
    const map = (x, y) => ({ x: ((x - ux1) / uW) * 150, y: ((y - uy1) / uH) * 150 });
    const vS = map(vx1, vy1), vE = map(vx2, vy2);

    const handleClick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const gx = ux1 + ((e.clientX - rect.left) / 150) * uW;
      const gy = uy1 + ((e.clientY - rect.top)  / 150) * uH;
      if (cyRef.current) {
        cyRef.current.pan({ x: width / 2 - gx * zoom, y: height / 2 - gy * zoom });
      }
    };

    return (
      <div className="minimap-container" onClick={handleClick}>
        <svg className="minimap-svg">
          {miniNodes.map((n, i) => {
            const p = map(n.x, n.y);
            return <circle key={i} cx={p.x} cy={p.y} r="3" fill={n.color} />;
          })}
          <rect className="minimap-viewport"
            x={vS.x} y={vS.y}
            width={Math.max(vE.x - vS.x, 8)} height={Math.max(vE.y - vS.y, 8)}
            rx="2"
          />
        </svg>
      </div>
    );
  };

  // ── FOR / AGAINST labels (Battle Graph only) ──────────────────────────────
  const BattleLabels = () => {
    if (viewMode === 'knowledge') return null;
    const sideA = participants[0] || 'FOR';
    const sideB = participants[1] || 'AGAINST';
    const labelStyle = (right) => ({
      position: 'absolute',
      top: '8px',
      [right ? 'right' : 'left']: '12px',
      fontSize: '0.68rem',
      fontWeight: '800',
      letterSpacing: '0.09em',
      textTransform: 'uppercase',
      color: right ? '#F472B6' : '#60A5FA',
      background: right ? 'rgba(244,114,182,0.08)' : 'rgba(96,165,250,0.08)',
      border: `1px solid ${right ? 'rgba(244,114,182,0.2)' : 'rgba(96,165,250,0.2)'}`,
      borderRadius: '6px',
      padding: '2px 8px',
      pointerEvents: 'none',
    });
    return (
      <>
        <div style={labelStyle(false)}>⬅ {sideA} (FOR)</div>
        <div style={labelStyle(true)}>{sideB} (AGAINST) ➡</div>
      </>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Context menu — rendered at fixed screen position */}
      {contextMenu && (
        <NodeContextMenu
          node={contextMenu.node}
          currentUser={currentUser}
          graphType={contextMenu.graphType}
          position={contextMenu.position}
          onConcede={(nodeId) => { onConcede?.(nodeId); }}
          onAttack={(target)  => { onAttack?.(target);  }}
          onSubtree={(nodeId, label) => { onOpenSubtree?.(nodeId, label); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      <div className="glass-panel" style={{
        display: 'flex', flexDirection: 'column', flex: 2,
        minHeight: 0, position: 'relative', overflow: 'hidden', padding: '16px',
      }}>
        {/* View Selector */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid var(--border-color)', paddingBottom: '8px',
          marginBottom: '8px', zIndex: 5,
        }}>
          <h3 style={{ fontSize: '1rem', color: '#F8FAFC' }}>Debate Visualizer</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { key: 'battle',      label: 'Battle Graph (Chessboard Flow)' },
              { key: 'knowledge',   label: 'Knowledge Graph (Shared Stance)' },
              { key: 'side-by-side',label: 'Side-by-Side' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                className={`btn-secondary ${viewMode === key ? 'active' : ''}`}
                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, display: 'flex', gap: '12px', minHeight: 0, position: 'relative' }}>

          {/* Left / Single graph */}
          <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
            <div ref={leftContainerRef} style={{ width: '100%', height: '100%' }} />
            <BattleLabels />
            <div className="cy-controls">
              <button className="cy-btn" title="Zoom In"       onClick={() => handleZoomIn(leftCyRef)}><ZoomIn  size={16} /></button>
              <button className="cy-btn" title="Zoom Out"      onClick={() => handleZoomOut(leftCyRef)}><ZoomOut size={16} /></button>
              <button className="cy-btn" title="Fit"           onClick={() => handleFit(leftCyRef)}><Maximize   size={16} /></button>
              <button className="cy-btn" title="Recenter"      onClick={() => handleReset(leftCyRef)}><Compass  size={16} /></button>
            </div>
            <Minimap data={leftMinimapData} cyRef={leftCyRef} />
          </div>

          {/* Right graph (side-by-side only) */}
          {viewMode === 'side-by-side' && (
            <div style={{
              flex: 1, height: '100%', position: 'relative',
              borderLeft: '1px solid var(--border-color)', paddingLeft: '12px', overflow: 'hidden',
            }}>
              <div ref={rightContainerRef} style={{ width: '100%', height: '100%' }} />
              <div className="cy-controls">
                <button className="cy-btn" title="Zoom In"  onClick={() => handleZoomIn(rightCyRef)}><ZoomIn  size={16} /></button>
                <button className="cy-btn" title="Zoom Out" onClick={() => handleZoomOut(rightCyRef)}><ZoomOut size={16} /></button>
                <button className="cy-btn" title="Fit"      onClick={() => handleFit(rightCyRef)}><Maximize   size={16} /></button>
                <button className="cy-btn" title="Recenter" onClick={() => handleReset(rightCyRef)}><Compass  size={16} /></button>
              </div>
              <Minimap data={rightMinimapData} cyRef={rightCyRef} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
