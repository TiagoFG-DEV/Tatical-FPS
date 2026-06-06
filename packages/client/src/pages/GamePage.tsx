import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../network/socket';
import { useLobbyStore, useGameStore } from '../stores/gameStore';
import { GameRenderer } from '../game/GameRenderer';
import { InputSystem } from '../game/InputSystem';
import { HUD } from '../components/HUD';
import { BuyMenu } from '../components/BuyMenu';
import { Scoreboard } from '../components/Scoreboard';
import { KillFeed } from '../components/KillFeed';
import { MatchOverlay } from '../components/MatchOverlay';
import { RoundAnnouncer } from '../components/RoundAnnouncer';
import { MatchEndScreen } from '../components/MatchEndScreen';
import { soundSystem } from '../game/SoundSystem';

export function GamePage() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const inputRef = useRef<InputSystem | null>(null);

  const { myId } = useLobbyStore();
  const { setSnapshot, addKill, addChat, setMatchResult, setPing,
    setBuyMenuOpen, setScoreboardOpen, buyMenuOpen, scoreboardOpen, matchResult } = useGameStore();

  // Screen flashes
  const [damageFlash, setDamageFlash] = useState(0);
  const [killFlash, setKillFlash] = useState(0);
  const [winFlash, setWinFlash] = useState(false);
  const [showVictory, setShowVictory] = useState<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Prevent accidental page reloads
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Trigger browser confirmation dialog
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Init renderer
    rendererRef.current = new GameRenderer(canvasRef.current);
    rendererRef.current.start();

    // Init input system
    inputRef.current = new InputSystem(canvasRef.current, socket, myId, {
      onBuyMenu: (open) => setBuyMenuOpen(open),
      onScoreboard: (open) => setScoreboardOpen(open),
    }, rendererRef.current);
    inputRef.current.attach();

    // Socket events
    socket.on('game_snapshot', (snapshot) => {
      setSnapshot(snapshot, myId);
      rendererRef.current?.updateSnapshot(snapshot, myId);
      soundSystem.update(snapshot, myId);
    });

    socket.on('kill_event', (event) => {
      addKill(event);
      if (event.killerId === myId && event.victimId !== myId) {
        setKillFlash(1);
        setTimeout(() => setKillFlash(0), 100);
      }
    });
    
    socket.on('damage_event', (event: any) => {
      if (event.targetId === myId) {
        setDamageFlash(1);
        setTimeout(() => setDamageFlash(0), 300);
      }
    });

    socket.on('round_end', (round: any) => {
      const p = useGameStore.getState().myPlayer;
      if (p && round.roundWinner === p.team) {
        setWinFlash(true);
      }
    });

    socket.on('round_start', () => {
      setWinFlash(false);
      soundSystem.play('round_start', 1);
    });

    socket.on('lobby_chat', addChat);
    socket.on('match_end', (result) => {
      setMatchResult(result);
      setShowVictory(result);
      setTimeout(() => {
        navigate('/lobby');
      }, 7000); // 7s cinematic then return
    });
    socket.on('server_correction', (correction) => {
      inputRef.current?.applyCorrection(correction);
    });

    socket.on('audio_event', (event: any) => {
       const me = useGameStore.getState().myPlayer;
       if (!me) return;
       // Spatial audio: distance factor 0..1
       const dx = event.position.x - me.position.x;
       const dy = event.position.y - me.position.y;
       const dist = Math.hypot(dx, dy);
       const factor = Math.max(0, 1 - dist / event.range);
       soundSystem.play(event.type, factor, {
         surface: event.surface,
         weaponId: event.weaponId,
       });

       // Knife swing visual arc
       if (event.type === 'knife_swing') {
         // 'event' now includes 'angle' directly from the server, but TS might not know it, so cast to any
         const eventAngle = (event as any).angle;
         rendererRef.current?.addEffect('knife_swing', event.position.x, event.position.y, undefined, undefined, '#ffffff', eventAngle);
       }
    });

    (socket as any).on('bullet_hit', (data: any) => {
       // Visual tracer + impact particles
       rendererRef.current?.addEffect('tracer', data.origin.x, data.origin.y, data.target.x, data.target.y);
       rendererRef.current?.addEffect('impact', data.target.x, data.target.y);
       // Muzzle flash at shooter origin
       rendererRef.current?.addEffect('muzzle', data.origin.x, data.origin.y);
       // Impact sound (spatial)
       const me = useGameStore.getState().myPlayer;
       if (me) {
         const dx = data.target.x - me.position.x;
         const dy = data.target.y - me.position.y;
         const dist = Math.hypot(dx, dy);
         const factor = Math.max(0, 1 - dist / 800);
         const sndType = data.hitType === 'player' ? 'bullet_impact_player' : 'bullet_impact_wall';
         soundSystem.play(sndType, factor);
       }
    });

    // round_start: combined above


    // Ping tracking
    let lastPing = Date.now();
    const pingInterval = setInterval(() => {
      lastPing = Date.now();
      socket.emit('ping', lastPing);
    }, 2000);
    socket.on('lobby_state', () => setPing(Date.now() - lastPing));

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      rendererRef.current?.destroy();
      inputRef.current?.detach();
      socket.off('game_snapshot');
      socket.off('kill_event');
      socket.off('lobby_chat');
      socket.off('match_end');
      socket.off('server_correction');
      socket.off('lobby_state');
      socket.off('audio_event');
      socket.off('damage_event');
      socket.off('round_end');
      socket.off('round_start');
      (socket as any).off('bullet_hit');
      clearInterval(pingInterval);
    };
  }, [myId]);

  return (
    <div className="w-screen h-screen bg-neutral-950 relative overflow-hidden">
      {/* Game canvas — full screen, imperative rendering */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: 'crosshair' }} // Allow aiming with crosshair cursor
      />

      {/* Screen Flashes */}
      <div 
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          boxShadow: `inset 0 0 100px rgba(255, 0, 0, ${damageFlash})`,
          opacity: damageFlash > 0 ? 1 : 0
        }}
      />
      <div 
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-150"
        style={{
          boxShadow: `inset 0 0 50px rgba(255, 215, 0, ${killFlash * 0.5})`,
          opacity: killFlash > 0 ? 1 : 0
        }}
      />
      <div 
        className="pointer-events-none absolute inset-0 z-10 transition-all duration-1000"
        style={{
          boxShadow: winFlash ? `inset 0 0 150px rgba(0, 255, 255, 0.4)` : 'none',
          animation: winFlash ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none'
        }}
      />

      {/* Round/Match HUD */}
      <HUD />
      <KillFeed />
      <MatchOverlay />
      <RoundAnnouncer />
      
      {/* Match End Stats */}
      {matchResult && <MatchEndScreen result={matchResult} onReturn={() => navigate('/lobby')} />}

      {/* Menus */}
      {buyMenuOpen && <BuyMenu />}
      {scoreboardOpen && <Scoreboard />}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        .animate-fade-in { animation: fadeIn 1s ease-out; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
