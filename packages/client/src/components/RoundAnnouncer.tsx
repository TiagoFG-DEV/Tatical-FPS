import React, { useEffect, useState } from 'react';
import { useGameStore } from '../stores/gameStore';

export function RoundAnnouncer() {
  const { round } = useGameStore();
  const [announcement, setAnnouncement] = useState<{ title: string; subtitle?: string; color: string } | null>(null);

  useEffect(() => {
    if (!round) return;

    let text = null;
    let sub = null;
    let color = 'text-white';

    if (round.phase === 'buy') {
      text = `ROUND ${round.round}`;
      sub = 'BUY PHASE';
    } else if (round.phase === 'combat' && round.phaseEndTime - Date.now() > 95000) {
      text = 'FIGHT';
      color = 'text-brand-500';
    } else if (round.phase === 'round_end') {
      if (round.roundWinner === 'attackers') {
        text = 'ATTACKERS WIN';
        color = 'text-atk';
      } else if (round.roundWinner === 'defenders') {
        text = 'DEFENDERS WIN';
        color = 'text-def';
      }
      if (round.roundEndReason === 'spike_exploded') sub = 'Spike Detonated';
      else if (round.roundEndReason === 'spike_defused') sub = 'Spike Defused';
      else if (round.roundEndReason === 'time_expired') sub = 'Time Expired';
      else sub = 'Team Eliminated';
    } else if (round.phase === 'halftime') {
      text = 'HALFTIME';
      sub = 'Switching Sides';
    }

    if (text) {
      setAnnouncement({ title: text, subtitle: sub ?? undefined, color });
      // Hide after 3s
      const timer = setTimeout(() => setAnnouncement(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [round?.phase, round?.round]);

  if (!announcement) return null;

  return (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-start justify-center pt-32 animate-slide-up">
      <div className="text-center bg-black/40 px-12 py-6 backdrop-blur-md border border-surface-border rounded-sm">
        <h1 className={`font-display font-bold text-6xl tracking-widest uppercase glow-red ${announcement.color}`}>
          {announcement.title}
        </h1>
        {announcement.subtitle && (
          <p className="text-xl font-mono text-neutral-400 mt-2 tracking-[0.2em] uppercase">
            {announcement.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
