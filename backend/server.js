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

// Asynchronous background moderation pipeline
async function runAsyncPipeline(roomId, nodeId) {
  const room = rooms[roomId];
  if (!room) return;

  const node = room.nodes.find(n => n.id === nodeId);
  if (!node) return;

  console.log(`[Pipeline] Ingestion completed. Starting async pipeline for node: ${nodeId}`);

  try {
    // 1. Structured Gemini parsing (Node classification, Fallacies, Claim extraction, Canonical match)
    const analysis = await parseMessage(node.text, node.author, room.topic, room.nodes.filter(n => n.id !== nodeId));
    console.log(`[Pipeline] AI Parsing result for node ${nodeId}:`, JSON.stringify(analysis));

    // Update node properties based on classification
    node.type = analysis.type || node.type;
    
    // Group canonical concepts
    if (analysis.canonical_concept_match) {
      node.canonical_concept_id = analysis.canonical_concept_match;
    }

    // Apply logical fallacies if found
    if (analysis.fallacies && analysis.fallacies.length > 0) {
      node.fallacy_flags = analysis.fallacies;
      // Triggers fallacy badge updates in room state immediately
      console.log(`[Pipeline] Fallacy detected on node ${nodeId}:`, analysis.fallacies);
      
      // Notify sender privately with a rephrasing nudge
      sendPrivate(roomId, node.author, 'fallacy_nudge', {
        nodeId: node.id,
        text: node.text,
        fallacies: analysis.fallacies
      });
    }

    // Recalculate clash state immediately after classification/fallacy check
    recalculateDebateClashes(roomId);
    
    // Broadcast the initial update (type, fallacies)
    broadcastToRoom(roomId, 'node_updated', node);
    broadcastToRoom(roomId, 'edges_updated', room.edges);

    // 2. Fact-Checking Phase
    if (analysis.extracted_claim) {
      console.log(`[Pipeline] Extracted claim to check: "${analysis.extracted_claim}"`);
      
      // Set status to checking
      node.fact_status = 'checking';
      broadcastToRoom(roomId, 'node_updated', node);

      try {
        // Run web search
        const searchResults = await searchWeb(analysis.extracted_claim);
        
        // Query Gemini to synthesize verdict
        const verification = await verifyClaim(analysis.extracted_claim, searchResults);
        console.log(`[Pipeline] Fact-check verdict for node ${nodeId}:`, JSON.stringify(verification));

        node.fact_status = verification.verdict;
        node.sources = searchResults;
        // Prepend fact check reasoning to explain border color
        node.fact_explanation = verification.explanation;

      } catch (searchError) {
        console.error(`[Pipeline] Fact-checking search/verdict failed for node ${nodeId}:`, searchError.message);
        // Fail loudly on UI
        node.fact_status = 'failed';
        node.fact_explanation = `Fact check failed: ${searchError.message}`;
      }

      // Recalculate all node strengths and edge resolution states
      recalculateDebateClashes(roomId);

      // Broadcast results
      broadcastToRoom(roomId, 'node_updated', node);
      broadcastToRoom(roomId, 'edges_updated', room.edges);
      broadcastToRoom(roomId, 'fact_check_alert', {
        nodeId: node.id,
        claim: analysis.extracted_claim,
        verdict: node.fact_status,
        explanation: node.fact_explanation,
        sources: node.sources
      });
    }

    persistRoom(roomId);

  } catch (err) {
    console.error(`[Pipeline] General error in async pipeline for node ${nodeId}:`, err);
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
            topic: topic,
            mode: mode || 'free', // 'free' or 'structured'
            participants: [],
            messages: [],
            nodes: [],
            edges: []
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
          const { roomId, username, text, replyToNodeId, relationType, msgType } = data;
          const room = rooms[roomId];
          if (!room) return;

          // Find this author's chain parent (last node they posted)
          const authorNodes = room.nodes.filter(n => n.author === username);
          const chainParentId = authorNodes.length > 0 ? authorNodes[authorNodes.length - 1].id : null;

          // Use client-supplied msgType if present; fall back to guessing from context
          const nodeType = msgType && msgType !== 'subtree'
            ? msgType
            : (replyToNodeId ? 'rebuttal' : 'claim');

          const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          const newNode = {
            id: nodeId,
            author: username,
            text: text,
            type: nodeType,
            fact_status: 'unverified',
            sources: [],
            fallacy_flags: [],
            strength_score: 1.0,
            canonical_concept_id: nodeId,
            chain_parent_id: msgType === 'subtree' ? null : chainParentId, // subtree = new root
            timestamp: Date.now()
          };

          room.nodes.push(newNode);

          // Add cross-edge or support edge if replying to a node
          let newEdge = null;
          if (replyToNodeId) {
            const relationship = relationType || 'rebuts'; // default to rebuts/attacks
            newEdge = {
              id: `edge_${nodeId}_${replyToNodeId}`,
              from: nodeId,
              to: replyToNodeId,
              relation_type: relationship === 'rebuts' ? 'attacks' : relationship, // standardizes rebuttal as "attacks" for battle dynamics
              resolved: false,
              winner_node_id: null
            };
            room.edges.push(newEdge);
          }

          // Add to simple messages log
          room.messages.push({
            id: nodeId,
            author: username,
            text: text,
            timestamp: Date.now()
          });

          // Save room state
          persistRoom(roomId);

          // Immediately broadcast the new state elements
          broadcastToRoom(roomId, 'new_node', newNode);
          if (newEdge) {
            broadcastToRoom(roomId, 'new_edge', newEdge);
          }

          // Run background async moderation tasks
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
          node.fallacy_flags = []; // clear fallacies for re-evaluation
          node.fact_status = 'unverified'; // reset fact verification

          // Update message log
          const msg = room.messages.find(m => m.id === nodeId);
          if (msg) msg.text = newText;

          recalculateDebateClashes(roomId);

          broadcastToRoom(roomId, 'node_updated', node);
          
          // Re-trigger async pipeline for the new text
          runAsyncPipeline(roomId, nodeId);
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
