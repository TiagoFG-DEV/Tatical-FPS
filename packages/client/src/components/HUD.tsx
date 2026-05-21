import React from 'react';
import { useGameStore } from '../stores/gameStore';
import { WEAPON_STATS, GAME_CONSTANTS } from '@tactical-fps/shared';
import type { WeaponId } from '@tactical-fps/shared';

export function HUD() {
  const { myPlayer, round, spike, ping, isInPlantZone, snapshot } = useGameStore();

  if (!myPlayer || !round) return null;

  const weapon = WEAPON_STATS[myPlayer.activeWeapon as WeaponId];
  const healthPct = myPlayer.health;
  const armorPct = myPlayer.armor;
  const isPlanted = spike?.status === 'planted';

  const phaseLabel: Record<string, string> = {
    buy: 'BUY PHASE',
    combat: 'LIVE',
    post_plant: 'NUKE ARMED',
    round_end: 'ROUND END',
    halftime: 'HALFTIME',
    overtime: 'OVERTIME',
    match_end: 'MATCH OVER',
    waiting: 'WAITING...',
  };

  const timeLeft = Math.max(0, Math.ceil((round.phaseEndTime - (snapshot?.serverTime || Date.now())) / 1000));
  const timeColor = timeLeft <= 10 ? 'text-brand-500' : 'text-white';

  // ── Interaction text: mutually exclusive, priority-based ──
  // Only ONE text can show at a time to avoid visual pollution
  let interactText: { text: string; color: string; border: string } | null = null;

  if (myPlayer.status === 'alive') {
    // Priority 1: Defuse (defender touching planted nuke)
    const nearNuke = spike?.status === 'planted' &&
      myPlayer.team === 'defenders' &&
      spike?.position &&
      Math.hypot(
        (myPlayer.position?.x ?? 0) - spike.position.x,
        (myPlayer.position?.y ?? 0) - spike.position.y,
      ) <= GAME_CONSTANTS.SPIKE_PICKUP_RANGE;

    // Priority 2: Plant (attacker with nuke, in zone)
    const canPlant = myPlayer.hasSpike &&
      myPlayer.team === 'attackers' &&
      (round.phase === 'combat' || round.phase === 'post_plant') &&
      isInPlantZone;

    if (nearNuke) {
      interactText = {
        text: 'Segure Q — Desarmar Nuke',
        color: '#60a5fa',
        border: 'rgba(59,130,246,0.3)',
      };
    } else if (canPlant) {
      interactText = {
        text: 'Segure Q — Plantar Nuke',
        color: '#f97316',
        border: 'rgba(249,115,22,0.3)',
      };
    }
  }

  // ── Inventory slots ──
  const hasPrimary = myPlayer.weapons.some(w => w !== 'knife' && WEAPON_STATS[w as WeaponId]?.slot === 'primary');
  const hasSecondary = myPlayer.weapons.some(w => w !== 'knife' && WEAPON_STATS[w as WeaponId]?.slot === 'secondary');
  const hasNuke = myPlayer.hasSpike && myPlayer.team === 'attackers';

  const slots: { key: string; label: string; active: boolean; hint: string }[] = [
    { key: 'melee', label: '⚔', active: myPlayer.activeWeapon === 'knife', hint: '1' },
    ...(hasSecondary ? [{ key: 'secondary', label: '🔫', active: WEAPON_STATS[myPlayer.activeWeapon as WeaponId]?.slot === 'secondary', hint: '2' }] : []),
    ...(hasPrimary ? [{ key: 'primary', label: '🔧', active: WEAPON_STATS[myPlayer.activeWeapon as WeaponId]?.slot === 'primary', hint: '3' }] : []),
    ...(hasNuke ? [{ key: 'nuke', label: '☢', active: false, hint: 'G' }] : []),
  ];

  return (
    <>
      {/* ─── Top Bar — unified minimalist score header ─── */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none flex justify-center pt-2 px-4">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          background: 'rgba(0,0,0,0.65)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 6,
          overflow: 'hidden',
          backdropFilter: 'blur(6px)',
        }}>
          {/* Attacker side */}
          <div style={{
            padding: '6px 20px',
            background: 'rgba(239,68,68,0.12)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ fontWeight: 900, fontSize: '1.4rem', fontVariantNumeric: 'tabular-nums', color: '#ef4444', fontFamily: 'monospace' }}>{round.attackerScore}</span>
          </div>

          {/* Center: timer + phase + round */}
          <div style={{ padding: '4px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
            {!isPlanted ? (
              <>
                <div className={`font-display font-bold text-3xl tabular ${timeColor}`} style={{ fontFamily: 'monospace', lineHeight: 1 }}>
                  {String(Math.floor(timeLeft / 60)).padStart(1, '0')}:{String(timeLeft % 60).padStart(2, '0')}
                </div>
                <div style={{ fontSize: '0.55rem', letterSpacing: '0.2em', color: '#6b7280', marginTop: 1 }}>{phaseLabel[round.phase] ?? ''} · RND {round.round}</div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <svg viewBox="-50 -50 100 100" style={{ width: 28, height: 28, color: '#ef4444' }}>
                  <rect x="-50" y="-50" width="100" height="100" fill="currentColor" />
                  <g fill="black">
                    <circle cx="0" cy="0" r="10" />
                    {[0, 120, 240].map(rot => (
                      <path key={rot} d="M 0 0 L -15 -45 A 45 45 0 0 1 15 -45 Z" transform={`rotate(${rot})`} />
                    ))}
                  </g>
                </svg>
                <div style={{ fontSize: '0.5rem', letterSpacing: '0.25em', color: '#ef4444' }}>NUKE ARMED</div>
              </div>
            )}
          </div>

          {/* Defender side */}
          <div style={{
            padding: '6px 20px',
            background: 'rgba(59,130,246,0.12)',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontWeight: 900, fontSize: '1.4rem', fontVariantNumeric: 'tabular-nums', color: '#3b82f6', fontFamily: 'monospace' }}>{round.defenderScore}</span>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6' }} />
          </div>
        </div>
      </div>


      {/* ─── Spike timer bar ─── */}
      {isPlanted && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-48 z-20 pointer-events-none">
          <div className="h-0.5 w-full bg-brand-900 overflow-hidden">
             <div className="h-full bg-brand-500 animate-pulse-fast" style={{ width: '100%' }} />
          </div>
        </div>
      )}

      {/* ─── Single interaction text (anti-overlap) ─── */}
      {interactText && (
        <div
          className="absolute bottom-[35%] left-1/2 -translate-x-1/2 text-center z-20 pointer-events-none"
          style={{ whiteSpace: 'nowrap' }}
        >
          <div
            className="text-sm font-mono tracking-widest px-6 py-2 rounded"
            style={{
              color: interactText.color,
              background: 'rgba(0,0,0,0.82)',
              border: `1px solid ${interactText.border}`,
            }}
          >
            {interactText.text}
          </div>
        </div>
      )}

      {/* ─── Bottom HUD ─── */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 z-20 pointer-events-none" style={{ paddingBottom: round.phase === 'buy' ? '4.5rem' : '1rem' }}>
        <div className="flex items-end justify-between">
          {/* Left: Health + Armor */}
          <div className="space-y-1.5 w-48">
            {/* Health */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-hud-health w-6 tabular">{myPlayer.health}</span>
              <div className="hud-bar flex-1">
                <div className="hud-bar-fill bg-hud-health" style={{ width: `${healthPct}%` }} />
              </div>
              <span className="text-xs text-neutral-600 font-mono">HP</span>
            </div>

            {/* Armor */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-hud-armor w-6 tabular">{myPlayer.armor}</span>
              <div className="hud-bar flex-1">
                <div className="hud-bar-fill bg-hud-armor" style={{ width: `${armorPct}%` }} />
              </div>
              <span className="text-xs text-neutral-600 font-mono">
                {myPlayer.armorType === 'heavy' ? 'HVY' : myPlayer.armorType === 'light' ? 'LGT' : '—'}
              </span>
            </div>
          </div>

          {/* Center: Weapon + Inventory Slots */}
          <div className="flex flex-col items-center gap-2">
            {/* Inventory slots */}
            <div className="flex gap-1">
              {slots.map(slot => (
                <div
                  key={slot.key}
                  className="flex flex-col items-center"
                  style={{
                    width: 36,
                    height: 36,
                    border: `1px solid ${slot.active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)'}`,
                    background: slot.active ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.4)',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{slot.label}</span>
                  <span style={{
                    position: 'absolute',
                    bottom: 1,
                    right: 3,
                    fontSize: 8,
                    color: 'rgba(255,255,255,0.4)',
                    fontFamily: 'monospace',
                  }}>{slot.hint}</span>
                </div>
              ))}
            </div>

            {/* Ammo */}
            <div className="flex items-baseline gap-2">
              <span className="font-display font-bold text-3xl tabular text-white">
                {myPlayer.isReloading ? 'RELOADING' : myPlayer.ammo[myPlayer.activeWeapon as WeaponId]}
              </span>
              <span className="text-neutral-500 text-sm font-mono">/ {myPlayer.reserveAmmo[myPlayer.activeWeapon as WeaponId]}</span>
            </div>
            <span className="text-xs font-mono text-neutral-400 tracking-widest uppercase">{weapon?.name ?? ''}</span>
          </div>

          {/* Right: Credits + ping */}
          <div className="text-right space-y-1 w-48">
            <div className="flex items-center justify-end gap-2">
              <span className="font-display font-bold text-xl text-hud-credits tabular">${myPlayer.credits}</span>
            </div>
            <div className="text-xs font-mono text-neutral-600">{ping}ms</div>
            {myPlayer.hasSpike && (
              <div className="text-xs font-mono text-brand-500 animate-pulse">☢ CARRYING NUKE</div>
            )}
          </div>
        </div>
      </div>

      {/* Dead overlay */}
      {myPlayer.status === 'dead' && (
        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
          <div className="text-center">
            <div className="font-display font-bold text-2xl text-neutral-500 tracking-widest">ELIMINATED</div>
            <div className="text-xs font-mono text-neutral-700 mt-1">Spectating...</div>
          </div>
        </div>
      )}

      {/* Buy hint */}
      {round.phase === 'buy' && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-mono text-neutral-600 tracking-widest pointer-events-none whitespace-nowrap">
          [B] BUY MENU &nbsp;·&nbsp; [TAB] SCOREBOARD &nbsp;·&nbsp; [G] DROP WEAPON
        </div>
      )}
    </>
  );
}
