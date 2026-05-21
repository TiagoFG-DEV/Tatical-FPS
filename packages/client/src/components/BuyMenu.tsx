import React, { useState } from 'react';
import { socket } from '../network/socket';
import { useGameStore } from '../stores/gameStore';
import { WEAPON_STATS, ARMOR_STATS } from '@tactical-fps/shared';
import type { WeaponId, ArmorType } from '@tactical-fps/shared';

const WEAPON_CATEGORIES: { label: string; weapons: WeaponId[] }[] = [
  { label: 'Pistols', weapons: ['classic', 'ghost', 'sheriff'] },
  { label: 'SMGs', weapons: ['spectre'] },
  { label: 'Rifles', weapons: ['phantom', 'vandal'] },
  { label: 'Snipers', weapons: ['operator'] },
  { label: 'Shotguns', weapons: ['judge'] },
  { label: 'Machine Guns', weapons: ['ares', 'odin'] },
];

export function BuyMenu() {
  const { myPlayer, setBuyMenuOpen, snapshot } = useGameStore();
  const [selectedCat, setSelectedCat] = useState(0);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Auto-close if phase changes
  React.useEffect(() => {
    if (snapshot?.round.phase !== 'buy') {
      setBuyMenuOpen(false);
    }
  }, [snapshot?.round.phase]);

  if (!myPlayer) return null;

  const handleBuy = (item: WeaponId | ArmorType) => {
    socket.emit('buy_item', item);
    socket.once('buy_result', (result) => {
      setLastResult(result.success ? `Updated ${item}` : result.error ?? 'Error');
      setTimeout(() => setLastResult(null), 2000);
    });
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="panel w-[750px] h-[550px] flex flex-col overflow-hidden border-white/20 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex flex-col">
            <span className="font-display font-black text-2xl tracking-[0.3em] italic text-white">ARMORY</span>
            <span className="text-[10px] font-mono text-neutral-500 tracking-widest mt-0.5">PRESS [B] TO EXIT SHOP</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-hud-credits font-display font-black text-3xl tabular shadow-glow">${myPlayer.credits}</span>
            <span className="text-neutral-500 text-[10px] font-mono tracking-widest">AVAILABLE FUNDS</span>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Category sidebar */}
          <div className="w-40 border-r border-white/10 flex flex-col py-4 bg-black/20">
            {WEAPON_CATEGORIES.map((cat, i) => (
              <button key={cat.label}
                className={`text-left px-6 py-3 text-xs font-mono tracking-widest transition-all ${
                  selectedCat === i
                    ? 'text-white bg-white/10 border-r-2 border-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
                onClick={() => setSelectedCat(i)}
              >
                {cat.label.toUpperCase()}
              </button>
            ))}

            <div className="mt-auto border-t border-white/10 pt-4">
              <div className="px-6 py-2 text-[10px] font-mono text-neutral-600 tracking-[0.2em]">PROTECTION</div>
              <button
                className={`w-full text-left px-6 py-3 text-xs font-mono transition-all ${
                  myPlayer.armorType === 'light' ? 'text-brand-500 bg-brand-500/5' : 
                  (myPlayer.credits >= 400 ? 'text-white hover:bg-white/5' : 'text-neutral-600')
                }`}
                onClick={() => handleBuy('light')}
              >
                LIGHT ARMOR <span className="float-right">$400</span>
              </button>
              <button
                className={`w-full text-left px-6 py-3 text-xs font-mono transition-all ${
                  myPlayer.armorType === 'heavy' ? 'text-brand-500 bg-brand-500/5' : 
                  (myPlayer.credits >= 1000 ? 'text-white hover:bg-white/5' : 'text-neutral-600')
                }`}
                onClick={() => handleBuy('heavy')}
              >
                HEAVY ARMOR <span className="float-right">$1000</span>
              </button>
            </div>
          </div>

          {/* Weapon grid */}
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4 content-start bg-black/10">
            {WEAPON_CATEGORIES[selectedCat].weapons.map((wId) => {
              const w = WEAPON_STATS[wId];
              const owned = myPlayer.weapons.includes(wId);
              const canAfford = myPlayer.credits >= w.cost;

              return (
                <button
                  key={wId}
                  className={`group relative p-4 text-left border transition-all duration-200 ${
                    owned ? 'border-brand-500 bg-brand-500/5' :
                    canAfford ? 'border-white/20 hover:border-white hover:bg-white/5' :
                    'border-white/5 opacity-40 grayscale'
                  }`}
                  onClick={() => handleBuy(wId)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className={`font-display font-black text-base tracking-widest italic transition-colors ${
                      owned ? 'text-brand-500' : (canAfford ? 'text-white' : 'text-neutral-600')
                    }`}>
                      {w.name.toUpperCase()}
                    </span>
                    <span className={`text-xs font-mono font-bold tabular ${
                      owned ? 'text-brand-500' : (canAfford ? 'text-white' : 'text-neutral-600')
                    }`}>
                      ${w.cost}
                    </span>
                  </div>
                  
                  <div className="flex gap-4 text-[10px] font-mono text-neutral-500">
                    <div className="flex flex-col">
                      <span>DMG</span>
                      <span className="text-neutral-300">{w.damage.body}</span>
                    </div>
                    <div className="flex flex-col">
                      <span>RATE</span>
                      <span className="text-neutral-300">{w.fireRate}/S</span>
                    </div>
                    <div className="flex flex-col">
                      <span>MAG</span>
                      <span className="text-neutral-300">{w.magSize}</span>
                    </div>
                  </div>

                  {owned && (
                    <div className="absolute top-0 right-0 p-1 bg-brand-500 text-black font-black text-[8px] tracking-tighter">
                      OWNED / SELL
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Toast */}
        {lastResult && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-white text-black font-mono text-[10px] font-bold tracking-widest animate-slide-up">
            {lastResult.toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}
