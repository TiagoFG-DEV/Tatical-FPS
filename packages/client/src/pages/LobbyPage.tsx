import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../network/socket';
import { useLobbyStore } from '../stores/gameStore';
import type { MapId, Team } from '@tactical-fps/shared';

const MAP_NAMES: Record<string, { name: string; desc: string }> = {
  omega:   { name: 'OMEGA',   desc: 'Massive Area · Three Sites' },
};

function TeamColumn({
  side, players, myId, isHost, lobbyTeamName, onRename, isTeamMode, onMovePlayer, otherTeamCount,
}: {
  side: 'attackers' | 'defenders';
  players: Array<{ id: string; name: string; isHost: boolean; isReady: boolean }>;
  myId: string;
  isHost: boolean;
  lobbyTeamName: string;
  onRename: (name: string) => void;
  isTeamMode: boolean;
  onMovePlayer?: (playerId: string, toTeam: 'attackers' | 'defenders') => void;
  otherTeamCount?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lobbyTeamName);
  const isAtk = side === 'attackers';
  const oppositeTeam = isAtk ? 'defenders' : 'attackers';

  const color = isTeamMode ? '#9ca3af' : (isAtk ? '#ef4444' : '#3b82f6');
  const bgColor = isTeamMode ? 'rgba(156,163,175,0.02)' : (isAtk ? 'rgba(239,68,68,0.03)' : 'rgba(59,130,246,0.03)');
  const borderColor = isTeamMode ? 'rgba(156,163,175,0.1)' : (isAtk ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)');

  useEffect(() => { setDraft(lobbyTeamName); }, [lobbyTeamName]);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim()) onRename(draft.trim());
  };

  const canMoveToOther = (otherTeamCount ?? 0) < 5;

  return (
    <div style={{ flex: 1, background: bgColor, borderRight: isAtk && !isTeamMode ? `1px solid ${borderColor}` : undefined, borderLeft: !isAtk && !isTeamMode ? `1px solid ${borderColor}` : undefined, padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: isTeamMode ? 'center' : 'space-between', marginBottom: '1rem' }}>
        {editing && isHost && isTeamMode ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value.toUpperCase())}
            onBlur={commitRename}
            onKeyDown={e => e.key === 'Enter' && commitRename()}
            maxLength={20}
            style={{ background: 'transparent', border: `1px solid ${color}`, color, fontWeight: 900, fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.1em', outline: 'none', padding: '0.5rem', width: '80%', fontFamily: 'monospace' }}
          />
        ) : (
          <h2
            onClick={() => isHost && isTeamMode && setEditing(true)}
            style={{ color, fontWeight: 900, fontSize: isTeamMode ? '1.5rem' : '1.1rem', letterSpacing: '0.2em', cursor: (isHost && isTeamMode) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: isTeamMode ? 'center' : 'left' }}
          >
            {lobbyTeamName}
            {isHost && isTeamMode && <span style={{ fontSize: '0.6rem', opacity: 0.4 }}>✎</span>}
          </h2>
        )}
        {!isTeamMode && <span style={{ color: '#374151', fontSize: '0.7rem', fontFamily: 'monospace' }}>{players.length}/5</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          const p = players[i];
          if (!p) {
            return (
              <div key={i} style={{ height: isTeamMode ? '4rem' : '3rem', border: `1px dashed rgba(255,255,255,0.03)`, display: 'flex', alignItems: 'center', justifyContent: isTeamMode ? 'center' : 'flex-start', padding: '0 1rem' }}>
                <span style={{ color: '#111', fontSize: '0.7rem', fontFamily: 'monospace', letterSpacing: '0.2em' }}>EMPTY</span>
              </div>
            );
          }
          const isMe = p.id === myId;
          return (
            <div key={p.id} style={{
              height: isTeamMode ? '5rem' : '3.5rem',
              border: `1px solid ${isMe ? color + '40' : 'rgba(255,255,255,0.04)'}`,
              background: isMe ? color + '08' : 'rgba(255,255,255,0.01)',
              display: 'flex', alignItems: 'center', justifyContent: isTeamMode ? 'center' : 'space-between', padding: '0 1.5rem',
              position: 'relative',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: isTeamMode ? '100%' : 'auto', justifyContent: isTeamMode ? 'center' : 'flex-start' }}>
                {!isTeamMode && (
                  <div style={{ width: '8px', height: '8px', background: color, borderRadius: '1px', opacity: isMe ? 1 : 0.4 }} />
                )}
                {p.isHost && (
                  <span style={{ color: '#f59e0b', fontSize: '0.8rem', position: 'absolute', left: '1rem' }}>★</span>
                )}
                <span style={{ color: isMe ? 'white' : '#6b7280', fontSize: isTeamMode ? '1.75rem' : '1rem', fontWeight: isTeamMode ? 900 : (isMe ? 700 : 400), letterSpacing: isTeamMode ? '0.15em' : 'normal', textTransform: isTeamMode ? 'uppercase' : 'none', textAlign: 'center' }}>
                  {p.name}
                </span>
                {isMe && !isTeamMode && <span style={{ color: '#374151', fontSize: '0.7rem', fontFamily: 'monospace' }}>(YOU)</span>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'absolute', right: '1rem' }}>
                {p.isReady && <span style={{ color: '#10b981', fontSize: '0.7rem', fontWeight: 900, fontFamily: 'monospace' }}>READY</span>}
                {/* Host: move player to opposite team */}
                {isHost && onMovePlayer && canMoveToOther && !isTeamMode && (
                  <button
                    onClick={() => onMovePlayer(p.id, oppositeTeam)}
                    title={`Move to ${oppositeTeam}`}
                    style={{ color: color, background: 'none', border: `1px solid ${color}40`, borderRadius: 3, cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.4rem', lineHeight: 1 }}
                  >
                    ⇄
                  </button>
                )}
                {isHost && p.id !== myId && (
                  <button onClick={() => socket.emit('kick_player', p.id)}
                    style={{ color: '#4b5563', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.5rem' }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LobbyPage() {
  const navigate = useNavigate();
  const { lobby, myId, setLobby, chatMessages, addChat } = useLobbyStore();
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const me = lobby?.players.find(p => p.id === myId);
  const isHost = me?.isHost ?? false;
  const isMatchmaking = lobby?.mode === 'matchmaking';
  const isTeamMode = lobby?.isTeamMode ?? false;

  useEffect(() => {
    if (!lobby) { navigate('/'); return; }
    socket.on('lobby_state', setLobby);
    socket.on('lobby_chat', addChat);
    socket.on('match_starting', () => {}); 
    socket.on('game_snapshot', () => navigate('/game'));
    return () => {
      socket.off('lobby_state');
      socket.off('lobby_chat');
      socket.off('match_starting');
      socket.off('game_snapshot');
    };
  }, [lobby]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  if (!lobby) return null;

  const atkPlayers = lobby.players.filter(p => p.team === 'attackers');
  const defPlayers = lobby.players.filter(p => p.team === 'defenders');

  const handleToggleTeamMode = () => socket.emit('toggle_team_mode', !isTeamMode);
  const handleRenameTeam = (side: 'attackers' | 'defenders', name: string) => socket.emit('set_team_name', side, name);
  const handleMovePlayer = (targetId: string, toTeam: 'attackers' | 'defenders') => socket.emit('move_player', targetId, toTeam);
  const handleReady = () => socket.emit('set_ready', !me?.isReady);
  const handleStart = () => socket.emit('start_match', lobby.mapId);
  const handleLeave = () => { socket.emit('leave_lobby'); navigate('/'); };
  const handleChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('lobby_chat', chatInput.trim(), 'all');
    setChatInput('');
  };

  const canStart = lobby.players.length >= 1;

  return (
    <div style={{ height: '100vh', minHeight: '100vh', background: '#080808', color: 'white', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      
      {/* Lobby Header */}
      <header style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: '0.2em' }}>TACTIC<span style={{ color: '#ef4444' }}>FPS</span></h1>
          <div style={{ height: '1rem', width: '1px', background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ color: '#4b5563', fontSize: '0.7rem', fontFamily: 'monospace', letterSpacing: '0.1em' }}>
            {isMatchmaking ? 'ONLINE MATCH' : 'CUSTOM LOBBY'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div onClick={() => { navigator.clipboard.writeText(lobby.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
               style={{ cursor: 'pointer', padding: '0.4rem 0.8rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ color: '#4b5563', fontSize: '0.65rem', fontFamily: 'monospace' }}>CODE:</span>
            <span style={{ fontWeight: 900, letterSpacing: '0.1em', fontSize: '0.8rem' }}>{lobby.code}</span>
            <span style={{ color: copied ? '#10b981' : '#374151' }}>{copied ? '✓' : '⎘'}</span>
          </div>
          <button onClick={handleLeave} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 900, cursor: 'pointer' }}>
            LEAVE
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main style={{ flex: 1, display: 'flex', padding: '1.5rem', gap: '1.5rem', overflow: 'hidden' }}>
        
        {/* Left Side: Teams */}
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Host Controls */}
          {isHost && !isMatchmaking && (
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: '#4b5563', fontSize: '0.6rem', fontWeight: 900, marginBottom: '0.4rem', letterSpacing: '0.1em' }}>MATCH MAP</label>
                <select value={lobby.mapId} onChange={e => socket.emit('set_map', e.target.value as MapId)}
                        style={{ width: '100%', background: '#111', border: '1px solid #333', color: 'white', padding: '0.5rem', borderRadius: '4px', fontSize: '0.8rem', outline: 'none' }}>
                  {Object.keys(MAP_NAMES).map(id => <option key={id} value={id}>{MAP_NAMES[id].name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: '#4b5563', fontSize: '0.6rem', fontWeight: 900, marginBottom: '0.4rem', letterSpacing: '0.1em' }}>QUEUE MODE</label>
                <div onClick={handleToggleTeamMode} 
                     style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', background: isTeamMode ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isTeamMode ? '#3b82f640' : '#333'}`, padding: '0.5rem', borderRadius: '4px' }}>
                  <div style={{ width: '0.8rem', height: '0.8rem', borderRadius: '2px', border: '1px solid #3b82f6', background: isTeamMode ? '#3b82f6' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isTeamMode && <span style={{ color: 'white', fontSize: '0.5rem' }}>✓</span>}
                  </div>
                  <span style={{ color: isTeamMode ? '#93c5fd' : '#9ca3af', fontSize: '0.75rem', fontWeight: 700 }}>TEAM QUEUE</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                {/* Switch sides for everyone if not team mode */}
                {!isTeamMode && (
                   <button onClick={() => { /* toggle sides for all? maybe not needed now */ }} 
                           style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', padding: '0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 900, cursor: 'pointer' }}>
                     SHUFFLE
                   </button>
                )}
              </div>
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
            {isTeamMode ? (
              <TeamColumn side="attackers" players={lobby.players} myId={myId} isHost={isHost} lobbyTeamName={lobby.teamName?.attackers || 'YOUR SQUAD'} onRename={n => handleRenameTeam('attackers', n)} isTeamMode={isTeamMode} />
            ) : (
              <>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <button onClick={() => socket.emit('set_team', 'attackers')} style={{ background: '#ef444420', border: 'none', borderBottom: '1px solid #ef444440', color: '#ef4444', padding: '0.5rem', fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer' }}>JOIN ATTACKERS</button>
                  <TeamColumn side="attackers" players={atkPlayers} myId={myId} isHost={isHost} lobbyTeamName={lobby.teamName?.attackers || 'ATTACKERS'} onRename={n => handleRenameTeam('attackers', n)} isTeamMode={isTeamMode} onMovePlayer={isHost ? handleMovePlayer : undefined} otherTeamCount={defPlayers.length} />
                </div>
                <div style={{ width: '1px', background: 'rgba(255,255,255,0.04)' }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <button onClick={() => socket.emit('set_team', 'defenders')} style={{ background: '#3b82f620', border: 'none', borderBottom: '1px solid #3b82f640', color: '#3b82f6', padding: '0.5rem', fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer' }}>JOIN DEFENDERS</button>
                  <TeamColumn side="defenders" players={defPlayers} myId={myId} isHost={isHost} lobbyTeamName={lobby.teamName?.defenders || 'DEFENDERS'} onRename={n => handleRenameTeam('defenders', n)} isTeamMode={isTeamMode} onMovePlayer={isHost ? handleMovePlayer : undefined} otherTeamCount={atkPlayers.length} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Side: Chat & Start */}
        <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Action Area */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button onClick={handleReady} 
                    style={{ width: '100%', padding: '1rem', background: me?.isReady ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${me?.isReady ? '#10b981' : '#333'}`, color: me?.isReady ? '#10b981' : 'white', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '0.1em', cursor: 'pointer', borderRadius: '4px' }}>
              {me?.isReady ? '✓ READY' : 'READY UP'}
            </button>
            
            {isHost && !isMatchmaking && (
              <button onClick={handleStart} disabled={!canStart}
                      style={{ width: '100%', padding: '1rem', background: canStart ? '#ef4444' : 'rgba(239,68,68,0.1)', border: 'none', color: canStart ? 'white' : '#7f1d1d', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '0.1em', cursor: canStart ? 'pointer' : 'not-allowed', borderRadius: '4px' }}>
                START MATCH
              </button>
            )}
            
            {isTeamMode && isHost && !isMatchmaking && (
              <button onClick={() => socket.emit('queue_join', me?.name || 'Player', lobby.teamName?.attackers || 'TEAM')}
                      style={{ width: '100%', padding: '1rem', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', border: 'none', color: 'white', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '0.1em', cursor: 'pointer', borderRadius: '4px' }}>
                ENTER PARTY QUEUE
              </button>
            )}

            {!canStart && isHost && !isTeamMode && (
              <p style={{ color: '#7f1d1d', fontSize: '0.6rem', textAlign: 'center', fontWeight: 700 }}>NEED ≥1 PLAYER PER SIDE</p>
            )}
          </div>

          {/* Chat Area */}
          <div style={{ height: '350px', flexShrink: 0, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '4px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
               {chatMessages.map(m => (
                 <div key={m.id} style={{ fontSize: '0.75rem', lineHeight: '1.4' }}>
                   <span style={{ color: m.team === 'attackers' ? '#ef4444' : (m.team === 'defenders' ? '#3b82f6' : '#6b7280'), fontWeight: 900, marginRight: '0.5rem' }}>
                     {m.senderName}:
                   </span>
                   <span style={{ color: '#d1d5db' }}>{m.message}</span>
                 </div>
               ))}
               <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleChat} style={{ padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} 
                     placeholder="Type message..." 
                     style={{ width: '100%', background: '#111', border: '1px solid #333', color: 'white', padding: '0.6rem', borderRadius: '4px', fontSize: '0.8rem', outline: 'none' }} />
            </form>
          </div>

        </div>
      </main>

      {/* Countdown overlay */}
      {lobby.countdownSeconds > 0 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '8rem', fontWeight: 900, color: '#ef4444', fontFamily: 'monospace' }}>{lobby.countdownSeconds}</div>
            <div style={{ color: '#4b5563', fontSize: '0.8rem', letterSpacing: '0.4em', fontWeight: 900 }}>MATCH STARTING</div>
          </div>
        </div>
      )}

    </div>
  );
}
