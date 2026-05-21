import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../network/socket';
import { useLobbyStore } from '../stores/gameStore';

type Screen = 'home' | 'create_custom' | 'join' | 'online_queue' | 'online_lobby';

// Animated geometric background player token
function GeoToken({ x, y, team, angle }: { x: number; y: number; team: 'atk' | 'def'; angle: number }) {
  const color = team === 'atk' ? '#ef4444' : '#3b82f6';
  const size = 14;
  return (
    <g transform={`translate(${x},${y}) rotate(${angle})`} opacity="0.15">
      {/* Body triangle */}
      <polygon
        points={`0,${-size} ${size * 0.7},${size * 0.6} ${-size * 0.7},${size * 0.6}`}
        fill={color}
        stroke={color}
        strokeWidth="1"
      />
      {/* Inner diamond detail */}
      <polygon
        points={`0,${-size * 0.5} ${size * 0.3},0 0,${size * 0.3} ${-size * 0.3},0`}
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.6"
      />
      {/* Head circle */}
      <circle cx="0" cy={-size - 5} r="5" fill={color} />
    </g>
  );
}

export function MainMenu() {
  const navigate = useNavigate();
  const { playerName, setPlayerName, setLobby, setMyId, setError, setQueueStatus, error, queueStatus, queuePosition, queueEstimated } = useLobbyStore();
  const [screen, setScreen] = useState<Screen>('home');
  const [joinCode, setJoinCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [tick, setTick] = useState(0);
  const nameRef = useRef(playerName);
  nameRef.current = playerName;

  // Animate background tokens
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => setMyId(socket.id ?? ''));

    socket.on('lobby_state', (state) => {
      setLobby(state);
      navigate('/lobby');
      setConnecting(false);
    });

    socket.on('lobby_error', (err) => {
      setError(err);
      setConnecting(false);
    });

    socket.on('queue_status', ({ status, position, estimated }) => {
      setQueueStatus(status, position, estimated);
    });

    // Matchmaking found — join that lobby socket room
    socket.on('match_found', (lobbyCode) => {
      socket.emit('join_lobby', lobbyCode, nameRef.current);
    });

    return () => {
      socket.off('lobby_state');
      socket.off('lobby_error');
      socket.off('connect');
      socket.off('queue_status');
      socket.off('match_found');
    };
  }, []);

  const handleCreate = () => {
    if (!playerName.trim()) return setError('Enter a name first.');
    setConnecting(true);
    socket.emit('create_lobby', playerName.trim(), 'custom');
  };

  const handleJoin = () => {
    if (!playerName.trim()) return setError('Enter a name first.');
    if (joinCode.length < 6) return setError('Enter a valid 6-character lobby code.');
    setConnecting(true);
    socket.emit('join_lobby', joinCode.toUpperCase(), playerName.trim());
  };

  const handleQueueJoin = () => {
    if (!playerName.trim()) return setError('Enter a name first.');
    socket.emit('queue_join', playerName.trim(), teamName.trim() || 'TEAM');
    setScreen('online_queue');
  };

  const handleQueueLeave = () => {
    socket.emit('queue_leave');
    setQueueStatus('idle', 0, 0);
    setScreen('home');
  };

  const goBack = () => { setScreen('home'); setError(null); };

  // Background tokens positions (static-ish, slow drift)
  const tokens = [
    { x: 80, y: 120, team: 'atk' as const, baseAngle: 15 },
    { x: 300, y: 80, team: 'def' as const, baseAngle: -20 },
    { x: 180, y: 350, team: 'atk' as const, baseAngle: 30 },
    { x: 420, y: 200, team: 'def' as const, baseAngle: -10 },
    { x: 50, y: 400, team: 'def' as const, baseAngle: 45 },
    { x: 380, y: 380, team: 'atk' as const, baseAngle: -35 },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden" style={{ background: '#080808' }}>
      {/* Animated grid */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      {/* Red central glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.07) 0%, transparent 70%)' }} />

      {/* Animated SVG tokens background */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        {tokens.map((t, i) => (
          <GeoToken
            key={i}
            x={t.x + Math.sin(tick * 0.008 + i) * 8}
            y={t.y + Math.cos(tick * 0.006 + i) * 6}
            team={t.team}
            angle={t.baseAngle + Math.sin(tick * 0.01 + i) * 5}
          />
        ))}
      </svg>

      {/* Corner decorations */}
      <div className="absolute top-0 left-0 w-32 h-32 pointer-events-none">
        <svg viewBox="0 0 128 128"><polyline points="0,64 0,0 64,0" fill="none" stroke="rgba(239,68,68,0.15)" strokeWidth="1" /></svg>
      </div>
      <div className="absolute bottom-0 right-0 w-32 h-32 pointer-events-none">
        <svg viewBox="0 0 128 128"><polyline points="128,64 128,128 64,128" fill="none" stroke="rgba(59,130,246,0.15)" strokeWidth="1" /></svg>
      </div>

      {/* Main card */}
      <div className="relative z-10 w-full max-w-md px-6">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            {/* Miniature player icon */}
            <svg width="28" height="32" viewBox="0 0 28 32">
              <polygon points="14,0 24,20 4,20" fill="#ef4444" stroke="#dc2626" strokeWidth="1.5" />
              <polygon points="14,5 19,15 9,15" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
              <circle cx="14" cy="26" r="5" fill="#ef4444" />
              <circle cx="14" cy="26" r="3" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
            </svg>
            <h1 style={{ fontFamily: 'system-ui, sans-serif', fontWeight: 900, fontSize: '2.5rem', letterSpacing: '0.2em', color: 'white', textTransform: 'uppercase' }}>
              TACTIC<span style={{ color: '#ef4444' }}>FPS</span>
            </h1>
            <svg width="28" height="32" viewBox="0 0 28 32" style={{ transform: 'rotate(180deg)' }}>
              <polygon points="14,0 24,20 4,20" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5" />
              <polygon points="14,5 19,15 9,15" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
              <circle cx="14" cy="26" r="5" fill="#3b82f6" />
            </svg>
          </div>
          <p style={{ color: '#4b5563', fontSize: '0.65rem', letterSpacing: '0.3em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            No Agents · Pure Gunplay · Nuclear Stakes
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-2.5 animate-fade-in" style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#f87171', fontSize: '0.75rem', fontFamily: 'monospace',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* ─── HOME ─── */}
        {screen === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              className="input-tactical text-center"
              style={{ fontSize: '1.125rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              placeholder="ENTER YOUR NAME"
              value={playerName}
              maxLength={24}
              onChange={e => { setError(null); setPlayerName(e.target.value); }}
              onKeyDown={e => e.key === 'Enter' && setScreen('create_custom')}
              autoFocus
            />

            {/* Mode buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
              {/* Custom */}
              <button className="btn-primary" style={{ flexDirection: 'column', gap: '0.25rem', padding: '1rem', height: 'auto' }}
                onClick={() => setScreen('create_custom')}>
                <span style={{ fontSize: '0.6rem', opacity: 0.6, fontFamily: 'monospace', letterSpacing: '0.1em' }}>CUSTOM PLAY</span>
                <span style={{ fontSize: '0.85rem' }}>Create Lobby</span>
              </button>
              <button className="btn-ghost" style={{ flexDirection: 'column', gap: '0.25rem', padding: '1rem', height: 'auto' }}
                onClick={() => setScreen('join')}>
                <span style={{ fontSize: '0.6rem', opacity: 0.6, fontFamily: 'monospace', letterSpacing: '0.1em' }}>CUSTOM PLAY</span>
                <span style={{ fontSize: '0.85rem' }}>Join with Code</span>
              </button>
            </div>

            {/* Online divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.25rem 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
              <span style={{ color: '#374151', fontSize: '0.65rem', fontFamily: 'monospace', letterSpacing: '0.2em' }}>ONLINE</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            </div>

            <button className="btn-primary" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.2))', borderColor: 'rgba(59,130,246,0.4)', color: '#93c5fd' }}
              onClick={() => setScreen('online_lobby')}>
              ⚡ Online Matchmaking (5v5)
            </button>

            <div style={{ textAlign: 'center', color: '#1f2937', fontSize: '0.65rem', fontFamily: 'monospace', marginTop: '0.5rem' }}>
              1v1 → 5v5 · Tactical · Competitive
            </div>
          </div>
        )}

        {/* ─── CREATE CUSTOM ─── */}
        {screen === 'create_custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ color: '#6b7280', fontSize: '0.65rem', fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }}>
              CUSTOM LOBBY — You will be the host
            </div>
            <input
              className="input-tactical text-center"
              style={{ fontSize: '1.125rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              placeholder="YOUR NAME"
              value={playerName}
              maxLength={24}
              onChange={e => { setError(null); setPlayerName(e.target.value); }}
            />
            <button className="btn-primary" style={{ padding: '1rem', fontSize: '0.875rem' }}
              onClick={handleCreate} disabled={connecting}>
              {connecting ? 'Creating...' : '▶ Create Lobby'}
            </button>
            <button className="btn-ghost" onClick={goBack}>← Back</button>
          </div>
        )}

        {/* ─── JOIN ─── */}
        {screen === 'join' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ color: '#6b7280', fontSize: '0.65rem', fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }}>
              ENTER LOBBY CODE
            </div>
            <input
              className="input-tactical text-center"
              style={{ fontSize: '1.125rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              placeholder="YOUR NAME"
              value={playerName}
              maxLength={24}
              onChange={e => { setError(null); setPlayerName(e.target.value); }}
            />
            <input
              className="input-tactical text-center"
              style={{ fontSize: '1.75rem', letterSpacing: '0.5em', fontFamily: 'monospace' }}
              placeholder="XXXXXX"
              value={joinCode}
              maxLength={6}
              onChange={e => { setError(null); setJoinCode(e.target.value.toUpperCase()); }}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
            />
            <button className="btn-primary" style={{ padding: '1rem' }}
              onClick={handleJoin} disabled={connecting || joinCode.length < 6}>
              {connecting ? 'Joining...' : '▶ Join Lobby'}
            </button>
            <button className="btn-ghost" onClick={goBack}>← Back</button>
          </div>
        )}

        {/* ─── ONLINE LOBBY SETUP ─── */}
        {screen === 'online_lobby' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ color: '#6b7280', fontSize: '0.65rem', fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }}>
              ONLINE MATCHMAKING — 5v5 Queue
            </div>
            <input
              className="input-tactical text-center"
              style={{ fontSize: '1.125rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              placeholder="YOUR NAME"
              value={playerName}
              maxLength={24}
              onChange={e => { setError(null); setPlayerName(e.target.value); }}
            />
            <input
              className="input-tactical text-center"
              style={{ fontSize: '1rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}
              placeholder="TEAM NAME (optional)"
              value={teamName}
              maxLength={20}
              onChange={e => setTeamName(e.target.value)}
            />
            <button className="btn-primary" style={{
              padding: '1rem', background: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(99,102,241,0.3))',
              borderColor: 'rgba(59,130,246,0.5)', color: '#93c5fd',
            }} onClick={handleQueueJoin}>
              ⚡ Enter Queue
            </button>
            <button className="btn-ghost" onClick={goBack}>← Back</button>
          </div>
        )}

        {/* ─── ONLINE QUEUE WAITING ─── */}
        {screen === 'online_queue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '0.65rem', fontFamily: 'monospace', letterSpacing: '0.2em' }}>
              MATCHMAKING IN PROGRESS
            </div>

            {/* Animated queue indicator */}
            <div style={{ position: 'relative', padding: '2rem' }}>
              <svg width="100" height="100" viewBox="0 0 100 100" style={{ margin: '0 auto', display: 'block' }}>
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(59,130,246,0.1)" strokeWidth="2" />
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(59,130,246,0.5)" strokeWidth="2"
                  strokeDasharray={`${2 * Math.PI * 45 * 0.25} ${2 * Math.PI * 45 * 0.75}`}
                  style={{ transformOrigin: '50px 50px', animation: 'spin 2s linear infinite' }} />
                <polygon points="50,20 62,42 38,42" fill="#3b82f6" opacity="0.8" />
                <circle cx="50" cy="55" r="7" fill="#3b82f6" opacity="0.8" />
              </svg>
            </div>

            <div>
              <div style={{ color: 'white', fontSize: '1.5rem', fontWeight: 900, fontFamily: 'monospace' }}>
                #{queuePosition}
              </div>
              <div style={{ color: '#6b7280', fontSize: '0.7rem', fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                IN QUEUE
              </div>
            </div>

            {queueEstimated > 0 && (
              <div style={{ color: '#4b5563', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                Est. wait: ~{queueEstimated}s
              </div>
            )}

            <button className="btn-ghost" style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#f87171' }}
              onClick={handleQueueLeave}>
              Cancel
            </button>
          </div>
        )}

        {/* Version */}
        <div style={{ textAlign: 'center', color: '#111827', fontSize: '0.65rem', fontFamily: 'monospace', marginTop: '2rem' }}>
          v1.0.0 · Beta · Nuclear Edition
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-fade-in { animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
