const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { parseMessage, verifyClaim, generateSummary } = require('./services/ai');
const { searchWeb } = require('./services/search');
const { saveRoom, loadAllRooms } = require('./services/db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// In-memory state: roomId -> room object
const rooms = {};

// Debounced per-room write timers — prevent spamming Supabase on every broadcast
const writeTimers = {};

/**
 * Schedule a Supabase save for this room, debounced by 1.5s.
 * Multiple rapid calls collapse into one DB write.
 */
function persistRoom(roomId) {
  const roomData = rooms[roomId];
  if (!roomData) return;
  clearTimeout(writeTimers[roomId]);
  writeTimers[roomId] = setTimeout(() => saveRoom(roomData), 1500);
}

// API Endpoints
app.get('/api/rooms', (req, res) => {
  const roomList = Object.values(rooms).map(r => ({
    id: r.id,
    topic: r.topic,
    mode: r.mode,
    participantsCount: r.participants.length,
    nodeCount: r.nodes.length
  }));
  res.json(roomList);
});

app.get('/api/rooms/:id', (req, res) => {
  const room = rooms[req.params.id];
  if (room) {
    res.json(room);
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

// Broadcast state to all clients in a room
function broadcastToRoom(roomId, event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.roomId === roomId && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Send private event to a specific user in a room
function sendPrivate(roomId, username, event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.roomId === roomId && client.username === username && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Broadcast list of active rooms to all connected clients not in a room
function broadcastRoomsList() {
  const roomList = Object.values(rooms).map(r => ({
    id: r.id,
    topic: r.topic,
    mode: r.mode,
    participantsCount: r.participants.length,
    nodeCount: r.nodes.length
  }));
  const message = JSON.stringify({ event: 'rooms_list', data: roomList });
  wss.clients.forEach(client => {
    if (!client.roomId && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Helper to calculate / recalculate Battle Graph edge clash winners & survival strength
function recalculateDebateClashes(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // 1. Reset all diminished states and start with base strength
  room.nodes.forEach(node => {
    // Base strength depends on fact_status
    let base = 1.0;
    if (node.fact_status === 'true') base = 2.0;
    else if (node.fact_status === 'false') base = 0.2;
    else if (node.fact_status === 'partially_true') base = 1.2;
    else if (node.fact_status === 'failed') base = 0.5;

    // Apply fallacy penalty
    const fallacyCount = node.fallacy_flags ? node.fallacy_flags.length : 0;
    node.strength_score = Math.max(0.1, base - 0.5 * fallacyCount);
  });

  // 2. Resolve "attacks" edges (from B to A)
  room.edges.forEach(edge => {
    if (edge.relation_type === 'attacks' || edge.relation_type === 'rebuts') {
      const attackerNode = room.nodes.find(n => n.id === edge.from);
      const targetNode = room.nodes.find(n => n.id === edge.to);

      if (attackerNode && targetNode) {
        // Compare strengths
        if (attackerNode.strength_score > targetNode.strength_score) {
          edge.resolved = true;
          edge.winner_node_id = attackerNode.id;
          // Target node is weakened by a successful rebuttal
          targetNode.strength_score = Math.max(0.1, targetNode.strength_score - 0.6);
        } else if (targetNode.strength_score > attackerNode.strength_score) {
          edge.resolved = true;
          edge.winner_node_id = targetNode.id;
          // Attacker node is weakened by a failed attack
          attackerNode.strength_score = Math.max(0.1, attackerNode.strength_score - 0.4);
        } else {
          // Tied clash
          edge.resolved = false;
          edge.winner_node_id = null;
        }
      }
    }
  });

  persistRoom(roomId);
}

// ── Helpers ──────────────────────────────────────────────────────────────
// Returns all descendant node IDs (via chain_parent_id) of a given node
function getDescendants(nodeId, nodes) {
  const result = [];
  const queue = [nodeId];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const children = nodes.filter(n => n.chain_parent_id === current && n.id !== nodeId);
    for (const child of children) {
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

// Asynchronous background moderation pipeline
async function runAsyncPipeline(roomId, nodeId) {
  const room = rooms[roomId];
  if (!room) return;

  const node = room.nodes.find(n => n.id === nodeId);
  if (!node) return;

  console.log(`[Pipeline] Starting async analysis for node: ${nodeId}`);

  try {
    const analysis = await parseMessage(
      node.text, node.author, room.topic,
      room.nodes.filter(n => n.id !== nodeId)
    );
    console.log(`[Pipeline] AI result for node ${nodeId}:`, JSON.stringify(analysis));

    // Core classification
    node.type = analysis.type || node.type;
    if (analysis.canonical_concept_match) {
      node.canonical_concept_id = analysis.canonical_concept_match;
    }
    if (analysis.fallacies?.length > 0) {
      node.fallacy_flags = analysis.fallacies;
      sendPrivate(roomId, node.author, 'fallacy_nudge', {
        nodeId: node.id, text: node.text, fallacies: analysis.fallacies
      });
    }

    // New natural-chat fields
    node.detected_subtopic    = analysis.detected_subtopic  || false;
    node.subtopic_label       = analysis.subtopic_label     || null;
    node.contains_factual_claim = !!analysis.extracted_claim;
    node.extracted_claim      = analysis.extracted_claim    || null;

    // Auto-create graph edge if AI detected a reply relationship
    let newEdge = null;
    if (analysis.reply_to_node_id) {
      const targetNode = room.nodes.find(n => n.id === analysis.reply_to_node_id);
      const alreadyLinked = room.edges.some(
        e => e.from === nodeId && e.to === analysis.reply_to_node_id
      );
      if (targetNode && !alreadyLinked) {
        const relationType =
          node.type === 'rebuttal'  ? 'attacks'  :
          node.type === 'evidence'  ? 'supports' :
          node.type === 'question'  ? 'questions': 'supports';
        newEdge = {
          id: `edge_${nodeId}_${analysis.reply_to_node_id}`,
          from: nodeId,
          to: analysis.reply_to_node_id,
          relation_type: relationType,
          resolved: false,
          winner_node_id: null
        };
        room.edges.push(newEdge);
      }
    }

    recalculateDebateClashes(roomId);
    broadcastToRoom(roomId, 'node_updated', node);
    if (newEdge) broadcastToRoom(roomId, 'new_edge', newEdge);
    broadcastToRoom(roomId, 'edges_updated', room.edges);
    persistRoom(roomId);

  } catch (err) {
    console.error(`[Pipeline] Error for node ${nodeId}:`, err);
  }
}

// WebSocket Event Handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', async (messageStr) => {
    try {
      const { event, data } = JSON.parse(messageStr);
      console.log(`WS Event received: ${event}`);

      switch (event) {
        case 'join_lobby': {
          ws.roomId = null;
          ws.username = null;
          // Send active rooms list
          broadcastRoomsList();
          break;
        }

        case 'create_room': {
          const { topic, mode } = data;
          const roomId = `room_${Date.now()}`;
          rooms[roomId] = {
            id: roomId,
            topic,
            mode: mode || 'free',
            participants: [],
            messages: [],
            nodes: [],
            edges: [],
            subtrees: {}         // subtree chats keyed by subtreeId
          };
          console.log(`Room created: ${roomId} with topic: "${topic}"`);
          persistRoom(roomId);
          ws.send(JSON.stringify({ event: 'room_created', data: rooms[roomId] }));
          broadcastRoomsList();
          break;
        }

        case 'join_room': {
          const { roomId, username } = data;
          const room = rooms[roomId];
          if (!room) {
            ws.send(JSON.stringify({ event: 'error', data: { message: 'Room not found' } }));
            return;
          }

          ws.roomId = roomId;
          ws.username = username;

          if (!room.participants.includes(username)) {
            room.participants.push(username);
          }

          console.log(`User "${username}" joined room ${roomId}`);
          persistRoom(roomId);

          ws.send(JSON.stringify({ event: 'room_joined', data: room }));
          broadcastToRoom(roomId, 'user_joined', { username, participants: room.participants });
          broadcastRoomsList();
          break;
        }

        case 'chat_message': {
          // Natural free-form chat — AI determines type and connections
          // Optional: attackTargetId creates an immediate clash edge
          const { roomId, username, text, attackTargetId } = data;
          const room = rooms[roomId];
          if (!room) return;

          // Track chain parent (last node this author posted)
          const authorNodes = room.nodes.filter(n => n.author === username);
          const chainParentId = authorNodes.length > 0 ? authorNodes[authorNodes.length - 1].id : null;

          const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          const newNode = {
            id: nodeId,
            author: username,
            text,
            type: attackTargetId ? 'rebuttal' : 'claim', // pre-classify attacks
            fact_status: 'unverified',
            sources: [],
            fallacy_flags: [],
            strength_score: 1.0,
            canonical_concept_id: nodeId,
            chain_parent_id: chainParentId,
            timestamp: Date.now(),
            detected_subtopic: false,
            subtopic_label: null,
            contains_factual_claim: false,
            extracted_claim: null,
            conceded: false
          };

          room.nodes.push(newNode);
          room.messages.push({ id: nodeId, author: username, text, timestamp: Date.now() });

          // If attacking a specific node — create clash edge immediately
          let clashEdge = null;
          if (attackTargetId && room.nodes.find(n => n.id === attackTargetId)) {
            clashEdge = {
              id: `clash_${nodeId}_${attackTargetId}`,
              from: nodeId,
              to: attackTargetId,
              relation_type: 'attacks',
              type: 'clash',
              resolved: false,
              winner_node_id: null
            };
            room.edges.push(clashEdge);
          }

          persistRoom(roomId);
          broadcastToRoom(roomId, 'new_node', newNode);
          if (clashEdge) {
            broadcastToRoom(roomId, 'new_edge', clashEdge);
            broadcastToRoom(roomId, 'edges_updated', room.edges);
          }

          // AI analysis runs in background — updates node type, edges, flags
          runAsyncPipeline(roomId, nodeId);
          break;
        }

        case 'rephrase_message': {
          const { roomId, nodeId, newText } = data;
          const room = rooms[roomId];
          if (!room) return;

          const node = room.nodes.find(n => n.id === nodeId);
          if (!node) return;

          console.log(`User rephrased node ${nodeId} to: "${newText}"`);
          node.text = newText;
          node.fallacy_flags = [];
          node.fact_status = 'unverified';
          node.extracted_claim = null;
          node.contains_factual_claim = false;

          const msg = room.messages.find(m => m.id === nodeId);
          if (msg) msg.text = newText;

          recalculateDebateClashes(roomId);
          broadcastToRoom(roomId, 'node_updated', node);
          runAsyncPipeline(roomId, nodeId);
          break;
        }

        case 'concede_claim': {
          const { roomId, nodeId } = data;
          const room = rooms[roomId];
          if (!room) return;
          const node = room.nodes.find(n => n.id === nodeId);
          if (!node) return;

          console.log(`[Concede] ${node.author} conceded node: ${nodeId}`);

          // Collect all descendants recursively via chain_parent_id
          const descendantIds = getDescendants(nodeId, room.nodes);
          const removedIds = [nodeId, ...descendantIds];

          const snippet = node.text.length > 80 ? node.text.substring(0, 80) + '...' : node.text;

          // Remove nodes and any edges that touch removed nodes
          room.nodes = room.nodes.filter(n => !removedIds.includes(n.id));
          room.edges = room.edges.filter(e => !removedIds.includes(e.from) && !removedIds.includes(e.to));

          const aiMsg = {
            id: `ai_${Date.now()}`,
            author: 'Agora AI',
            text: `🏳️ **${node.author}** has conceded: *"${snippet}"*${descendantIds.length > 0 ? ` — ${descendantIds.length} follow-up argument${descendantIds.length > 1 ? 's' : ''} also removed.` : ' This argument has been retired.'}`,
            timestamp: Date.now(),
            isAI: true,
            aiType: 'concession'
          };
          room.messages.push(aiMsg);

          recalculateDebateClashes(roomId);
          persistRoom(roomId);

          // Broadcast full removal list so all clients vanish the nodes instantly
          broadcastToRoom(roomId, 'nodes_removed', { ids: removedIds });
          broadcastToRoom(roomId, 'new_ai_message', aiMsg);
          broadcastToRoom(roomId, 'edges_updated', room.edges);
          break;
        }

        case 'fact_check_request': {
          // Manual fact-check triggered by user clicking 🔍
          const { roomId, nodeId, claim } = data;
          const room = rooms[roomId];
          if (!room) return;
          const node = room.nodes.find(n => n.id === nodeId);
          if (!node || !claim) return;

          node.fact_status = 'checking';
          broadcastToRoom(roomId, 'node_updated', node);

          // Run search + verify asynchronously
          (async () => {
            try {
              const searchResults = await searchWeb(claim);
              const verification = await verifyClaim(claim, searchResults);

              node.fact_status = verification.verdict;
              node.sources = searchResults;
              node.fact_explanation = verification.explanation;

              const verdictEmoji =
                verification.verdict === 'true' ? '✅' :
                verification.verdict === 'false' ? '❌' :
                verification.verdict === 'partially_true' ? '⚠️' : '❓';

              const verdictLabel = verification.verdict.replace(/_/g, ' ').toUpperCase();
              const claimSnippet = claim.length > 100 ? claim.substring(0, 100) + '...' : claim;

              const aiMsg = {
                id: `ai_${Date.now()}`,
                author: 'Agora AI',
                text: `${verdictEmoji} **FACT CHECK** — *"${claimSnippet}"*\n\n**Verdict: ${verdictLabel}**\n\n${verification.explanation}`,
                timestamp: Date.now(),
                isAI: true,
                aiType: 'fact_check',
                verdict: verification.verdict,
                nodeId,
                sources: searchResults
              };
              room.messages.push(aiMsg);

              recalculateDebateClashes(roomId);
              persistRoom(roomId);

              broadcastToRoom(roomId, 'node_updated', node);
              broadcastToRoom(roomId, 'new_ai_message', aiMsg);
              broadcastToRoom(roomId, 'edges_updated', room.edges);
            } catch (err) {
              console.error('[FactCheck] Error:', err.message);
              node.fact_status = 'failed';
              node.fact_explanation = `Fact check failed: ${err.message}`;
              broadcastToRoom(roomId, 'node_updated', node);
            }
          })();
          break;
        }

        case 'open_subtree': {
          // Opens a scoped sub-chat for a subtopic — broadcast to ALL room clients
          const { roomId, parentNodeId, label } = data;
          const room = rooms[roomId];
          if (!room) return;

          if (!room.subtrees) room.subtrees = {};

          const subtreeId = `subtree_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
          const subtree = {
            id: subtreeId,
            label: label || 'Subtopic Discussion',
            parentNodeId,
            messages: [],
            createdAt: Date.now(),
            createdBy: ws.username
          };
          room.subtrees[subtreeId] = subtree;

          persistRoom(roomId);
          // Broadcast to EVERY connected client in the room
          broadcastToRoom(roomId, 'subtree_created', subtree);
          break;
        }

        case 'subtree_message': {
          const { roomId, subtreeId, username, text } = data;
          const room = rooms[roomId];
          if (!room || !room.subtrees?.[subtreeId]) return;

          const msgId = `stmsg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
          const msg = { id: msgId, author: username, text, timestamp: Date.now() };
          room.subtrees[subtreeId].messages.push(msg);

          persistRoom(roomId);
          broadcastToRoom(roomId, 'subtree_message_received', { subtreeId, message: msg });
          break;
        }


        case 'request_summary': {
          const { roomId } = data;
          const room = rooms[roomId];
          if (!room) return;

          console.log(`AI Summary requested for room ${roomId}`);
          ws.send(JSON.stringify({ event: 'summary_loading', data: {} }));

          try {
            const summary = await generateSummary(room.topic, room.nodes, room.edges);
            ws.send(JSON.stringify({ event: 'debate_summary', data: { summary } }));
          } catch (err) {
            ws.send(JSON.stringify({ event: 'error', data: { message: `Summary failed: ${err.message}` } }));
          }
          break;
        }

        default:
          console.warn(`Unknown WebSocket event: ${event}`);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    // Clean up participants if we wanted to (omitted here to preserve participant lists on reload)
  });
});

// Serve React frontend build in production
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(buildPath));
  // All non-API, non-WS routes → index.html (React Router support)
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
  console.log('[Server] Serving React build from', buildPath);
}

// Start server — async so we can await DB load before accepting connections
async function start() {
  // Load all persisted rooms from Supabase into memory
  const loaded = await loadAllRooms();
  Object.assign(rooms, loaded);

  server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Agora Backend running on http://localhost:${PORT}`);
    console.log(` WebSocket Server active`);
    console.log(` Rooms loaded from DB: ${Object.keys(rooms).length}`);
    console.log(`=================================================`);
  });
}

start();
