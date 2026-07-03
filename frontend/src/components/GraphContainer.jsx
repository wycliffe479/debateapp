import React, { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { ZoomIn, ZoomOut, Maximize, RefreshCw, Compass, EyeOff, ShieldAlert } from 'lucide-react';

export default function GraphContainer({ room, selectedNode, setSelectedNode }) {
  const [viewMode, setViewMode] = useState('battle'); // 'battle', 'knowledge', 'side-by-side'
  
  // Viewports state for minimaps
  const [leftMinimapData, setLeftMinimapData] = useState(null);
  const [rightMinimapData, setRightMinimapData] = useState(null);

  const leftCyRef = useRef(null);
  const rightCyRef = useRef(null);
  const leftContainerRef = useRef(null);
  const rightContainerRef = useRef(null);

  const { nodes = [], edges = [], topic = '', participants = [] } = room || {};

  // Setup layouts and data mappings
  useEffect(() => {
    // Destroy previous instances
    if (leftCyRef.current) leftCyRef.current.destroy();
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
      if (leftCyRef.current) leftCyRef.current.destroy();
      if (rightCyRef.current) rightCyRef.current.destroy();
    };
  }, [viewMode, nodes, edges]);

  // Synchronize selection changes (dimming unselected nodes)
  useEffect(() => {
    applyFocusMode(leftCyRef.current);
    applyFocusMode(rightCyRef.current);
  }, [selectedNode]);

  // Initialize Battle Graph (Adversarial Columns)
  const initBattleGraph = (container, cyStoreRef, setMinimap) => {
    if (!container) return;

    // Convert room nodes into Cytoscape nodes with programmatic positioning
    const sideA = participants[0] || 'Proposer';
    const sideB = participants[1] || 'Opponent';

    const cyNodes = nodes.map(node => {
      // Calculate depth in chain (traverse chain_parent_id ancestors)
      let depth = 0;
      let currParentId = node.chain_parent_id;
      while (currParentId) {
        const parentNode = nodes.find(n => n.id === currParentId);
        if (parentNode) {
          depth++;
          currParentId = parentNode.chain_parent_id;
        } else {
          break;
        }
      }

      // Chronological vertical index per author
      const authorNodes = nodes.filter(n => n.author === node.author);
      const yIndex = authorNodes.findIndex(n => n.id === node.id);

      // Determine side placement
      const isSideA = node.author === sideA;
      
      // Layout Math:
      // Side A goes left: x = -150 - depth * 150
      // Side B goes right: x = 150 + depth * 150
      // Vertically space nodes by 100px
      const x = isSideA ? (-150 - depth * 150) : (150 + depth * 150);
      const y = yIndex * 110 - 50;

      // Label details
      const isClashing = edges.some(e => e.to === node.id && (e.relation_type === 'attacks' || e.relation_type === 'rebuts') && !e.resolved);
      const shortText = node.text.length > 28 ? node.text.substring(0, 25) + '...' : node.text;
      
      return {
        data: {
          id: node.id,
          label: `${node.author}:\n${shortText}`,
          type: node.type,
          fact_status: node.fact_status,
          fallacies_count: node.fallacy_flags ? node.fallacy_flags.length : 0,
          strength: node.strength_score || 1.0,
          isClashing: isClashing,
          raw: node
        },
        position: { x, y }
      };
    });

    const cyEdges = edges.map(edge => {
      // Draw cross-edges (attacks) as curved paths, supports as normal lines
      const isCrossSide = nodes.find(n => n.id === edge.from)?.author !== nodes.find(n => n.id === edge.to)?.author;
      return {
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          relation_type: edge.relation_type,
          winner: edge.winner_node_id,
          resolved: edge.resolved,
          curve: isCrossSide ? 'bezier' : 'straight'
        }
      };
    });

    const cy = cytoscape({
      container: container,
      elements: [...cyNodes, ...cyEdges],
      style: getGraphStylesheet(false),
      layout: { name: 'preset' }, // preset positions manually calculated
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false
    });

    setupGraphEvents(cy, cyStoreRef, setMinimap);
  };

  // Initialize Knowledge Graph (Shared Concepts collapsed by canonical_concept_id)
  const initKnowledgeGraph = (container, cyStoreRef, setMinimap) => {
    if (!container) return;

    // Create unique conceptual nodes
    const conceptMap = {};
    const cyNodes = [];
    const cyEdges = [];

    // Add Topic Root Node
    cyNodes.push({
      data: {
        id: 'topic_root',
        label: `Motion:\n${topic.length > 35 ? topic.substring(0, 32) + '...' : topic}`,
        type: 'root',
        fact_status: 'unverified',
        strength: 2.0,
        raw: { id: 'topic_root', text: topic, author: 'AI Moderator', type: 'root' }
      }
    });

    // Populate concept nodes grouped by canonical_concept_id
    nodes.forEach(node => {
      const cId = node.canonical_concept_id || node.id;
      if (!conceptMap[cId]) {
        conceptMap[cId] = {
          id: cId,
          text: node.text,
          authorList: [node.author],
          type: node.type,
          fact_status: node.fact_status,
          fallacies_count: node.fallacy_flags ? node.fallacy_flags.length : 0,
          dependentsCount: 0,
          raw: node
        };
      } else {
        // Accumulate details
        if (!conceptMap[cId].authorList.includes(node.author)) {
          conceptMap[cId].authorList.push(node.author);
        }
        // Take the strongest fact check status
        if (node.fact_status === 'true') conceptMap[cId].fact_status = 'true';
      }
    });

    // Count dependent edges to scale size
    edges.forEach(edge => {
      const sourceNode = nodes.find(n => n.id === edge.from);
      const targetNode = nodes.find(n => n.id === edge.to);
      if (sourceNode && targetNode) {
        const targetConceptId = targetNode.canonical_concept_id || targetNode.id;
        if (conceptMap[targetConceptId]) {
          conceptMap[targetConceptId].dependentsCount++;
        }
      }
    });

    // Add concepts to cyNodes
    Object.values(conceptMap).forEach(concept => {
      const authors = concept.authorList.join(' & ');
      const shortText = concept.text.length > 25 ? concept.text.substring(0, 22) + '...' : concept.text;
      
      cyNodes.push({
        data: {
          id: concept.id,
          label: `${authors}:\n${shortText}`,
          type: concept.type,
          fact_status: concept.fact_status,
          fallacies_count: concept.fallacies_count,
          strength: 1.0 + concept.dependentsCount * 0.4, // Size matches dependents
          raw: concept.raw
        }
      });

      // Connect concept to topic root initially if it has no obvious ancestor
      // To keep it centered, connect all major concept claims to topic root
      if (concept.type === 'claim') {
        cyEdges.push({
          data: {
            id: `edge_root_${concept.id}`,
            source: concept.id,
            target: 'topic_root',
            relation_type: 'supports',
            curve: 'straight'
          }
        });
      }
    });

    // Collapse and map edges onto the concept level
    edges.forEach(edge => {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);

      if (fromNode && toNode) {
        const fromConcept = fromNode.canonical_concept_id || fromNode.id;
        const toConcept = toNode.canonical_concept_id || toNode.id;

        if (fromConcept !== toConcept) {
          cyEdges.push({
            data: {
              id: `edge_concept_${edge.id}`,
              source: fromConcept,
              target: toConcept,
              relation_type: edge.relation_type,
              resolved: edge.resolved,
              winner: edge.winner_node_id ? (nodes.find(n => n.id === edge.winner_node_id)?.canonical_concept_id || edge.winner_node_id) : null,
              curve: 'straight'
            }
          });
        }
      }
    });

    const cy = cytoscape({
      container: container,
      elements: [...cyNodes, ...cyEdges],
      style: getGraphStylesheet(true),
      layout: {
        name: 'cose',
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: false,
        componentSpacing: 100,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false
    });

    setupGraphEvents(cy, cyStoreRef, setMinimap);
  };

  // Shared events (clicking nodes, updating minimap boundaries)
  const setupGraphEvents = (cy, storeRef, setMinimap) => {
    storeRef.current = cy;

    cy.on('tap', 'node', (evt) => {
      const nodeData = evt.target.data('raw');
      if (nodeData && nodeData.id !== 'topic_root') {
        setSelectedNode(nodeData);
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });

    // Update minimap on pan/zoom/viewport changes
    const updateMinimap = () => {
      const bounds = cy.elements().boundingBox();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const width = cy.width();
      const height = cy.height();

      setMinimap({
        bounds,
        pan,
        zoom,
        width,
        height,
        nodes: cy.nodes().map(n => ({
          x: n.position('x'),
          y: n.position('y'),
          color: n.style('background-color'),
          id: n.id()
        }))
      });
    };

    cy.on('pan zoom viewport resize', updateMinimap);
    
    // Fit elements on initial load and generate starting minimap bounds
    setTimeout(() => {
      cy.fit(30);
      updateMinimap();
    }, 100);
  };

  // Apply focus mode (fade nodes not directly linked to selected)
  const applyFocusMode = (cy) => {
    if (!cy) return;

    if (!selectedNode) {
      cy.elements().removeClass('dimmed focused');
      return;
    }

    const selNodeId = selectedNode.canonical_concept_id || selectedNode.id;
    const cyNode = cy.getElementById(selNodeId);

    if (cyNode.length > 0) {
      const neighborhood = cyNode.neighborhood().add(cyNode);
      cy.elements().addClass('dimmed');
      neighborhood.removeClass('dimmed').addClass('focused');
    }
  };

  // Stylesheet definition for Cytoscape
  const getGraphStylesheet = (isKnowledge) => [
    {
      selector: 'node',
      style: {
        'content': 'data(label)',
        'text-wrap': 'wrap',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-family': 'Plus Jakarta Sans',
        'font-size': '10px',
        'font-weight': '600',
        'color': '#F8FAFC',
        'background-color': (ele) => {
          const type = ele.data('type');
          if (type === 'root') return '#0F172A';
          if (type === 'claim') return '#2563EB'; // Blue
          if (type === 'evidence') return '#059669'; // Green
          if (type === 'rebuttal') return '#7C3AED'; // Purple/Violet
          if (type === 'question') return '#475569'; // Slate
          if (type === 'concession') return '#D97706'; // Amber
          return '#3B82F6';
        },
        // Border indicates fact-checking status
        'border-width': '3px',
        'border-color': (ele) => {
          if (ele.data('type') === 'root') return 'var(--border-color)';
          const status = ele.data('fact_status');
          if (status === 'true') return '#10B981'; // Green
          if (status === 'false') return '#EF4444'; // Red
          if (status === 'partially_true') return '#F59E0B'; // Amber
          if (status === 'checking') return '#F59E0B'; // Dash yellow
          if (status === 'failed') return '#94A3B8'; // gray
          return '#64748B'; // Unverified - Slate
        },
        'border-style': (ele) => {
          return ele.data('fact_status') === 'checking' ? 'dashed' : 'solid';
        },
        'width': (ele) => {
          const strength = ele.data('strength') || 1.0;
          return `${55 + Math.min(strength * 10, 40)}px`;
        },
        'height': (ele) => {
          const strength = ele.data('strength') || 1.0;
          return `${55 + Math.min(strength * 10, 40)}px`;
        },
        'shape': (ele) => {
          return ele.data('type') === 'root' ? 'round-rectangle' : 'ellipse';
        },
        'transition-property': 'background-color, border-color, opacity',
        'transition-duration': '0.3s'
      }
    },
    {
      selector: 'edge',
      style: {
        'width': '2.5px',
        'line-color': (ele) => {
          // Attacking edge shows clash dynamics
          if (ele.data('relation_type') === 'attacks' || ele.data('relation_type') === 'rebuts') {
            if (ele.data('resolved')) {
              // The winner edge gets active highlight
              return ele.data('winner') === ele.data('source') ? '#DC2626' : 'rgba(239, 68, 68, 0.1)';
            }
            return '#EF4444'; // unresolved attack: bright red
          }
          return 'rgba(59, 130, 246, 0.4)'; // supports edge
        },
        'target-arrow-color': (ele) => {
          if (ele.data('relation_type') === 'attacks' || ele.data('relation_type') === 'rebuts') {
            return '#EF4444';
          }
          return '#3B82F6';
        },
        'target-arrow-shape': 'triangle',
        'curve-style': 'data(curve)',
        'control-point-step-size': '60px', // curve intensity for cross-side beats
        'arrow-scale': '1.2',
        'opacity': (ele) => {
          if (ele.data('resolved') && ele.data('winner') !== ele.data('source')) {
            return 0.15; // Dim the defeated attacks
          }
          return 0.7;
        }
      }
    },
    // Focus mode classes
    {
      selector: '.dimmed',
      style: {
        'opacity': 0.15
      }
    },
    {
      selector: '.focused',
      style: {
        'opacity': 1.0,
        'shadow-blur': '15px',
        'shadow-color': 'rgba(59, 130, 246, 0.6)'
      }
    }
  ];

  // Manual Zoom/Pan operations on active Cy instance
  const handleZoomIn = (cyRef) => {
    if (cyRef.current) cyRef.current.zoom(cyRef.current.zoom() * 1.2);
  };
  const handleZoomOut = (cyRef) => {
    if (cyRef.current) cyRef.current.zoom(cyRef.current.zoom() / 1.2);
  };
  const handleFit = (cyRef) => {
    if (cyRef.current) cyRef.current.fit(40);
  };
  const handleReset = (cyRef) => {
    if (cyRef.current) {
      cyRef.current.zoom(1);
      cyRef.current.center();
    }
  };

  // Custom Interactive Minimap Component
  const Minimap = ({ data, cyRef }) => {
    if (!data || !data.bounds) return null;

    const { bounds, pan, zoom, width, height, nodes: miniNodes } = data;

    // Viewport box in graph space
    const vx1 = -pan.x / zoom;
    const vy1 = -pan.y / zoom;
    const vx2 = (width - pan.x) / zoom;
    const vy2 = (height - pan.y) / zoom;

    // Union box containing all elements AND the viewport box
    const ux1 = Math.min(bounds.x1, vx1) - 50;
    const uy1 = Math.min(bounds.y1, vy1) - 50;
    const ux2 = Math.max(bounds.x2, vx2) + 50;
    const uy2 = Math.max(bounds.y2, vy2) + 50;

    const uWidth = ux2 - ux1;
    const uHeight = uy2 - uy1;

    // Map graph coordinates to 150x150 minimap viewport
    const mapCoords = (x, y) => {
      const mx = ((x - ux1) / uWidth) * 150;
      const my = ((y - uy1) / uHeight) * 150;
      return { x: mx, y: my };
    };

    const vStart = mapCoords(vx1, vy1);
    const vEnd = mapCoords(vx2, vy2);
    const vW = Math.max(vEnd.x - vStart.x, 8);
    const vH = Math.max(vEnd.y - vStart.y, 8);

    // Map drag-to-pan click events on minimap
    const handleMinimapClick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Translate click relative to minimap coordinate space
      const graphX = ux1 + (clickX / 150) * uWidth;
      const graphY = uy1 + (clickY / 150) * uHeight;

      if (cyRef.current) {
        // Pan so the graph centers around the clicked position
        cyRef.current.center(cyRef.current.elements());
        cyRef.current.pan({
          x: width / 2 - graphX * zoom,
          y: height / 2 - graphY * zoom
        });
      }
    };

    return (
      <div className="minimap-container" onClick={handleMinimapClick}>
        <svg className="minimap-svg">
          {/* Render miniature nodes */}
          {miniNodes.map((n, idx) => {
            const pos = mapCoords(n.x, n.y);
            return (
              <circle
                key={idx}
                cx={pos.x}
                cy={pos.y}
                r="3"
                fill={n.color}
              />
            );
          })}
          {/* Render viewport indicator box */}
          <rect
            className="minimap-viewport"
            x={vStart.x}
            y={vStart.y}
            width={vW}
            height={vH}
            rx="2"
          />
        </svg>
      </div>
    );
  };

  return (
    <div className="glass-panel" style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 2,
      minHeight: 0,
      position: 'relative',
      overflow: 'hidden',
      padding: '16px'
    }}>
      {/* View Selector Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px',
        marginBottom: '8px',
        zIndex: 5
      }}>
        <h3 style={{ fontSize: '1rem', color: '#F8FAFC' }}>Debate Visualizer</h3>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setViewMode('battle')}
            className={`btn-secondary ${viewMode === 'battle' ? 'active' : ''}`}
            style={{ padding: '4px 12px', fontSize: '0.8rem' }}
          >
            Battle Graph (Chessboard Flow)
          </button>
          <button
            onClick={() => setViewMode('knowledge')}
            className={`btn-secondary ${viewMode === 'knowledge' ? 'active' : ''}`}
            style={{ padding: '4px 12px', fontSize: '0.8rem' }}
          >
            Knowledge Graph (Shared Stance)
          </button>
          <button
            onClick={() => setViewMode('side-by-side')}
            className={`btn-secondary ${viewMode === 'side-by-side' ? 'active' : ''}`}
            style={{ padding: '4px 12px', fontSize: '0.8rem' }}
          >
            Side-by-Side
          </button>
        </div>
      </div>

      {/* Main Canvas layouts container */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: '12px',
        minHeight: 0,
        position: 'relative'
      }}>
        
        {/* Left/Single Graph Container */}
        <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
          <div ref={leftContainerRef} style={{ width: '100%', height: '100%' }} />
          
          {/* Zoom controls overlay */}
          <div className="cy-controls">
            <button className="cy-btn" title="Zoom In" onClick={() => handleZoomIn(leftCyRef)}><ZoomIn size={16} /></button>
            <button className="cy-btn" title="Zoom Out" onClick={() => handleZoomOut(leftCyRef)}><ZoomOut size={16} /></button>
            <button className="cy-btn" title="Fit to Viewport" onClick={() => handleFit(leftCyRef)}><Maximize size={16} /></button>
            <button className="cy-btn" title="Recenter" onClick={() => handleReset(leftCyRef)}><Compass size={16} /></button>
          </div>

          {/* Minimap overlay */}
          <Minimap data={leftMinimapData} cyRef={leftCyRef} />
        </div>

        {/* Right Graph Container (only active in side-by-side) */}
        {viewMode === 'side-by-side' && (
          <div style={{
            flex: 1,
            height: '100%',
            position: 'relative',
            borderLeft: '1px solid var(--border-color)',
            paddingLeft: '12px',
            overflow: 'hidden'
          }}>
            <div ref={rightContainerRef} style={{ width: '100%', height: '100%' }} />
            
            {/* Zoom controls overlay */}
            <div className="cy-controls">
              <button className="cy-btn" title="Zoom In" onClick={() => handleZoomIn(rightCyRef)}><ZoomIn size={16} /></button>
              <button className="cy-btn" title="Zoom Out" onClick={() => handleZoomOut(rightCyRef)}><ZoomOut size={16} /></button>
              <button className="cy-btn" title="Fit to Viewport" onClick={() => handleFit(rightCyRef)}><Maximize size={16} /></button>
              <button className="cy-btn" title="Recenter" onClick={() => handleReset(rightCyRef)}><Compass size={16} /></button>
            </div>

            {/* Minimap overlay */}
            <Minimap data={rightMinimapData} cyRef={rightCyRef} />
          </div>
        )}

      </div>
    </div>
  );
}
