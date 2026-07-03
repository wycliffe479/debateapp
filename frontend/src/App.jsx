import React, { useState, useEffect } from 'react';
import { Shield, Sparkles, MessageSquare, Plus, Users, GitBranch, ArrowRight, Loader } from 'lucide-react';
import DebateRoom from './components/DebateRoom';

export default function App() {
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('agora_username') || '';
  });
  const [activeRoomId, setActiveRoomId] = useState(null);

  // Backend URL — reads from Vite env at build time, falls back to localhost for dev
  const backendHttp = import.meta.env.VITE_BACKEND_WS_URL
    ? import.meta.env.VITE_BACKEND_WS_URL.replace('wss://', 'https://').replace('ws://', 'http://')
    : `http://${window.location.hostname}:5000`;
  const backendWs = import.meta.env.VITE_BACKEND_WS_URL
    || `ws://${window.location.hostname}:5000`;

  // Lobby states
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTopic, setNewTopic] = useState('');
  const [newMode, setNewMode] = useState('free');

  // Fetch active rooms from backend API
  const fetchRooms = async () => {
    try {
      const res = await fetch(`${backendHttp}/api/rooms`);
      if (res.ok) {
        const data = await res.json();
        setRooms(data);
      }
    } catch (err) {
      console.error('Failed to fetch rooms list:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    
    // Poll lobby list periodically every 5 seconds
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveUsername = (name) => {
    const trimmed = name.trim();
    if (trimmed) {
      setUsername(trimmed);
      localStorage.setItem('agora_username', trimmed);
    }
  };

  // Create a room through a backend WebSocket triggers
  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newTopic.trim() || !username) return;

    try {
      const socket = new WebSocket(backendWs);
      socket.onopen = () => {
        socket.send(JSON.stringify({
          event: 'create_room',
          data: {
            topic: newTopic.trim(),
            mode: newMode
          }
        }));
      };

      socket.onmessage = (event) => {
        const { event: evType, data } = JSON.parse(event.data);
        if (evType === 'room_created') {
          setActiveRoomId(data.id);
          setNewTopic('');
          socket.close();
        }
      };
    } catch (err) {
      alert(`Failed to create room: ${err.message}`);
    }
  };

  const handleJoinRoom = (roomId) => {
    if (!username) {
      alert('Please enter a username first!');
      return;
    }
    setActiveRoomId(roomId);
  };

  const handleLeaveRoom = () => {
    setActiveRoomId(null);
    fetchRooms();
  };

  // Render the debate room if active
  if (activeRoomId) {
    return (
      <DebateRoom
        roomId={activeRoomId}
        username={username}
        onLeave={handleLeaveRoom}
      />
    );
  }

  // Lobby UI
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px',
      background: 'radial-gradient(circle at 10% 20%, rgba(13, 27, 42, 0.4) 0%, rgba(8, 12, 20, 1) 90%)'
    }}>
      
      {/* 1. App Title Logo Branding */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '8px',
        marginBottom: '40px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '24px',
          padding: '8px 20px',
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.2)'
        }} className="float-animation">
          <GitBranch size={22} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ fontSize: '1.4rem', fontWeight: '800', letterSpacing: '0.05em' }}>AGORA</h2>
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '800', background: 'linear-gradient(135deg, #FFF 40%, #94A3B8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          AI-Moderated Debate Maps
        </h1>
        <p style={{ color: '#94A3B8', maxWidth: '500px', fontSize: '0.95rem', lineHeight: '1.6' }}>
          Debate key issues with live interactive knowledge graphs, real-time fallacy audits, and background search fact-checking.
        </p>
      </div>

      {/* 2. Setup Profile Panel */}
      {!username ? (
        <div className="glass-panel glass-panel-glow" style={{
          width: '100%',
          maxWidth: '450px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          marginBottom: '32px'
        }}>
          <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} style={{ color: 'var(--accent-primary)' }} />
            <span>Create Profile</span>
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#94A3B8' }}>
            Enter your display name to start or join debate threads.
          </p>
          <form onSubmit={(e) => {
            e.preventDefault();
            handleSaveUsername(e.target.usernameInput.value);
          }} style={{ display: 'flex', gap: '8px' }}>
            <input
              name="usernameInput"
              type="text"
              required
              placeholder="e.g. Socrates"
              style={{
                flex: 1,
                background: 'rgba(15, 23, 42, 0.5)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: '#F8FAFC',
                padding: '10px 14px',
                fontSize: '0.875rem',
                outline: 'none'
              }}
            />
            <button type="submit" className="btn-primary">
              <span>Set Name</span>
              <ArrowRight size={14} />
            </button>
          </form>
        </div>
      ) : (
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '10px 20px',
          fontSize: '0.85rem',
          color: '#CBD5E1',
          marginBottom: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span>Welcome, <strong style={{ color: 'var(--accent-primary)' }}>{username}</strong>!</span>
          <button
            onClick={() => {
              setUsername('');
              localStorage.removeItem('agora_username');
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#F87171',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: '600'
            }}
          >
            Change Profile
          </button>
        </div>
      )}

      {/* 3. Main Lobby Grid */}
      {username && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '400px 500px',
          gap: '24px',
          width: '100%',
          maxWidth: '924px',
          minHeight: '400px'
        }}>
          
          {/* Create Debate Panel */}
          <div className="glass-panel" style={{ padding: '24px', height: 'fit-content' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} style={{ color: 'var(--accent-success)' }} />
              <span>Start New Debate</span>
            </h3>
            
            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: '600' }}>Debate Topic / Motion:</label>
                <textarea
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  required
                  rows={3}
                  placeholder="e.g. Remote work reduces collaboration and productivity compared to office presence."
                  style={{
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    padding: '10px 12px',
                    fontSize: '0.875rem',
                    resize: 'none',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: '600' }}>Debate Flow Mode:</label>
                <select
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value)}
                  style={{
                    background: '#0F172A',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    padding: '8px 10px',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                >
                  <option value="free">Free Flow (Replies build cross-edges)</option>
                  <option value="structured">Structured Mode (Timed Turns)</option>
                </select>
              </div>

              <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}>
                <Sparkles size={16} />
                <span>Launch Room</span>
              </button>
            </form>
          </div>

          {/* Active Debate List Panel */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={18} style={{ color: 'var(--accent-primary)' }} />
              <span>Active & Saved Debates</span>
            </h3>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
                  <Loader size={24} className="spin-slow" style={{ color: 'var(--accent-primary)' }} />
                </div>
              ) : rooms.length === 0 ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '200px',
                  color: '#64748B',
                  fontSize: '0.85rem'
                }}>
                  No active debates. Launch one to start!
                </div>
              ) : (
                rooms.map((room) => (
                  <div
                    key={room.id}
                    onClick={() => handleJoinRoom(room.id)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.02)';
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '340px' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#F1F5F9' }}>
                        {room.topic}
                      </span>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: '#64748B' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Users size={12} />
                          <span>{room.participantsCount} participants</span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <GitBranch size={12} />
                          <span>{room.nodeCount} graph nodes</span>
                        </span>
                      </div>
                    </div>
                    <div style={{
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      color: '#60A5FA',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <ArrowRight size={16} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
