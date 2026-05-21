import React, { useEffect, useState } from 'react';
import { socket } from '../network/socket';
import { WEAPON_STATS } from '@tactical-fps/shared';
import type { KillEvent } from '@tactical-fps/shared';

export function KillFeed() {
  const [kills, setKills] = useState<KillEvent[]>([]);

  useEffect(() => {
    const handleKill = (event: KillEvent) => {
      setKills(prev => [...prev.slice(-4), event]); // Keep last 5
      setTimeout(() => {
        setKills(prev => prev.filter(k => k.id !== event.id));
      }, 5000);
    };

    socket.on('kill_event', handleKill);
    return () => {
      socket.off('kill_event', handleKill);
    };
  }, []);

  return (
    <div className="absolute top-[220px] right-4 z-20 flex flex-col items-end gap-2 pointer-events-none">
      {kills.map((kill) => (
        <div key={kill.id} className="flex items-center gap-3 bg-black/60 px-3 py-1.5 border-r-4 border-brand-500 animate-slide-in-right">
          <span className="font-display font-bold text-sm text-neutral-200">{kill.killerName}</span>
          
          <div className="flex items-center gap-2 px-2 py-0.5 bg-neutral-800/50 rounded">
            <span className="font-mono text-[10px] text-neutral-400">
              {WEAPON_STATS[kill.weaponId]?.name.toUpperCase() || 'KILL'}
            </span>
            {kill.isHeadshot && (
              <svg className="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12zM10 5a1 1 0 100 2 1 1 0 000-2z" />
              </svg>
            )}
          </div>

          <span className="font-display font-bold text-sm text-brand-400">{kill.victimName}</span>
        </div>
      ))}
    </div>
  );
}
