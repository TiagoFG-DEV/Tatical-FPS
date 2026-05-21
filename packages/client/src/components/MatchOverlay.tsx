import React, { useEffect, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useLobbyStore } from '../stores/gameStore';

export function MatchOverlay() {
  const { snapshot } = useGameStore();
  const { myId } = useLobbyStore();
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState('');
  const [subMessage, setSubMessage] = useState('');
  const [type, setType] = useState<'victory' | 'defeat' | 'neutral'>('neutral');

  useEffect(() => {
    if (!snapshot) return;

    const round = snapshot.round;
    const me = snapshot.players.find(p => p.id === myId);
    
    if (round.phase === 'round_end') {
      setShow(true);
      const won = me?.team === round.roundWinner;
      setType(won ? 'victory' : 'defeat');
      setMessage(won ? 'ROUND WON' : 'ROUND LOST');
      setSubMessage(round.roundEndReason?.replace('_', ' ').toUpperCase() || '');
      
      const timer = setTimeout(() => setShow(false), 4000);
      return () => clearTimeout(timer);
    }

    if (round.phase === 'match_end') {
      setShow(true);
      const myTeam = me?.team;
      const atkScore = round.attackerScore;
      const defScore = round.defenderScore;
      const winnerTeam = atkScore > defScore ? 'attackers' : 'defenders';
      
      const won = myTeam === winnerTeam;
      setType(won ? 'victory' : 'defeat');
      setMessage(won ? 'MATCH VICTORY' : 'MATCH DEFEAT');
      const scoreMsg = `${atkScore} - ${defScore}`;
      setSubMessage(scoreMsg);
    }
  }, [snapshot?.round.phase, snapshot?.round.roundWinner]);

  if (!show) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none overflow-hidden">
      {/* Background Glitch / Flash */}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${
        type === 'victory' ? 'bg-brand-500/10' : 'bg-red-500/10'
      }`} />

      {/* Main Text Container — positioned lower so it doesn't overlap RoundAnnouncer */}
      <div className="relative flex flex-col items-center animate-in zoom-in duration-500" style={{ marginTop: '15vh' }}>
        {/* Only show submessage on match_end to avoid duplicating RoundAnnouncer */}
        {snapshot?.round.phase === 'match_end' && (
          <div className={`text-sm font-mono tracking-[0.4em] uppercase mb-3 ${
            type === 'victory' ? 'text-brand-500' : 'text-red-500'
          }`}>
            {subMessage}
          </div>
        )}

        <div className={`text-5xl font-display font-black tracking-[0.2em] italic mb-3 ${
          type === 'victory' ? 'text-white shadow-[0_0_30px_rgba(255,255,255,0.5)]' : 'text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)]'
        }`}>
          {message}
        </div>

        <div className="h-px w-48 bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        {/* Decorative elements */}
        <div className="absolute -inset-x-20 -inset-y-10 border-y border-white/10 animate-pulse" />
      </div>
    </div>
  );
}
