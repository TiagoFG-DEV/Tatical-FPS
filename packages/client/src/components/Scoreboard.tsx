import React from 'react';
import { useGameStore } from '../stores/gameStore';
import { useLobbyStore } from '../stores/gameStore';

export function Scoreboard() {
  const { snapshot } = useGameStore();
  const { myId } = useLobbyStore();
  if (!snapshot) return null;

  const attackers = snapshot.players.filter(p => p.team === 'attackers');
  const defenders = snapshot.players.filter(p => p.team === 'defenders');

  const PlayerRow = ({ p }: { p: typeof snapshot.players[0] }) => (
    <div className={`score-row gap-2 ${p.id === myId ? 'text-white' : 'text-neutral-400'}`}>
      <span className="truncate font-medium">
        {p.id === myId && '▶ '}{p.name}
        {p.status === 'dead' && <span className="text-neutral-700 ml-1">†</span>}
      </span>
      <span className="tabular text-center text-green-400">{p.kills}</span>
      <span className="tabular text-center text-red-400">{p.deaths}</span>
      <span className="tabular text-center text-neutral-500">{p.assists}</span>
      <span className="tabular text-right text-hud-credits">${p.credits}</span>
    </div>
  );

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="panel w-[600px] max-h-[70vh] overflow-auto">
        {/* Header */}
        <div className="px-5 py-3 border-b border-surface-border">
          <div className="score-row text-neutral-600 gap-2">
            <span>Player</span>
            <span className="text-center">K</span>
            <span className="text-center">D</span>
            <span className="text-center">A</span>
            <span className="text-right">$</span>
          </div>
        </div>

        {/* Attackers */}
        <div className="px-5 py-2">
          <div className="text-xs font-mono text-atk tracking-widest mb-2">ATTACKERS</div>
          {attackers.map(p => <PlayerRow key={p.id} p={p} />)}
        </div>

        <div className="border-t border-surface-border" />

        {/* Defenders */}
        <div className="px-5 py-2">
          <div className="text-xs font-mono text-def tracking-widest mb-2">DEFENDERS</div>
          {defenders.map(p => <PlayerRow key={p.id} p={p} />)}
        </div>

        <div className="px-5 py-2 border-t border-surface-border text-xs font-mono text-neutral-700 text-center">
          [TAB] Hold to view scoreboard
        </div>
      </div>
    </div>
  );
}
