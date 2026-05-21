import React from 'react';
import type { MatchResult } from '@tactical-fps/shared';

export function MatchEndScreen({ result, onReturn }: { result: MatchResult; onReturn: () => void }) {
  const isDraw = result.attackerScore === result.defenderScore;

  let title = 'MATCH FINISHED';
  let color = 'text-white';

  if (!isDraw) {
    title = `${result.winner} WIN`;
    color = result.winner === 'attackers' ? 'text-atk' : 'text-def';
  }

  // Sort players by kills
  const sortedPlayers = [...result.players].sort((a, b) => b.kills - a.kills);

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in">
      <div className="text-center mb-10">
        <h1 className={`font-display font-bold text-7xl tracking-widest uppercase ${color}`}>
          {title}
        </h1>
        <div className="text-3xl font-mono text-neutral-300 mt-4 tabular">
          <span className="text-atk">{result.attackerScore}</span>
          <span className="mx-4">-</span>
          <span className="text-def">{result.defenderScore}</span>
        </div>
      </div>

      <div className="panel w-[800px] max-h-[50vh] overflow-auto border-surface-border">
        <div className="px-6 py-4 border-b border-surface-border bg-surface-elevated">
          <div className="score-row text-neutral-400 font-bold uppercase tracking-wider text-sm">
            <span>Player</span>
            <span className="text-center">Kills</span>
            <span className="text-center">Deaths</span>
            <span className="text-center">Assists</span>
            <span className="text-right">MVP</span>
          </div>
        </div>

        <div className="p-2">
          {sortedPlayers.map((p, i) => (
            <div key={p.id} className="score-row px-4 py-3 text-sm hover:bg-surface-elevated/50 transition-colors">
              <span className="font-medium text-white flex items-center gap-2">
                {i === 0 && <span className="text-brand-500 text-xs">★</span>}
                {p.name}
              </span>
              <span className="tabular text-center text-green-400">{p.kills}</span>
              <span className="tabular text-center text-red-400">{p.deaths}</span>
              <span className="tabular text-center text-neutral-400">{p.assists}</span>
              <span className="tabular text-right text-brand-500 font-bold">
                {p.id === result.mvpId ? 'MVP' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      <button className="btn-ghost mt-8 py-3 px-12 text-lg border-surface-border hover:border-white text-white" onClick={onReturn}>
        RETURN TO LOBBY
      </button>
    </div>
  );
}
