import type { GameSnapshot, PlayerState, Vec2, WeaponId } from '@tactical-fps/shared';
import { GAME_CONSTANTS, MAPS, WEAPON_STATS } from '@tactical-fps/shared';

// ─────────────────────────────────────────
// GameRenderer — PixiJS-free, pure Canvas2D
// Optimized: object pooling, dirty rects, camera
// ─────────────────────────────────────────

interface InterpolatedPlayer {
  current: PlayerState;
  prev: PlayerState;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frameId = 0;
  private lastTime = 0;

  // State
  private snapshot: GameSnapshot | null = null;
  private prevSnapshot: GameSnapshot | null = null;
  private myId = '';
  private interpBuffer = new Map<string, InterpolatedPlayer>();

  // Camera
  private camX = 0;
  private camY = 0;
  private scale = 1;

  // Minimap
  private readonly MINIMAP_SIZE = 180;
  private readonly MINIMAP_MARGIN = 16;

  // Visual effects pool
  private effects: Array<{
    type: 'tracer' | 'hit' | 'muzzle' | 'impact' | 'knife_swing';
    x: number; y: number; tx?: number; ty?: number;
    life: number; maxLife: number;
    color: string;
    velocity?: Vec2;
    angle?: number;
  }> = [];

  // Recoil
  private recoilOffset = { x: 0, y: 0 };
  private recoilDecay = 0.85;
  private shake = { x: 0, y: 0 };
  private shakeTime = 0;
  private mousePos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  start(): void {
    this.frameId = requestAnimationFrame(this.render);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  getPlayerScreenPos(): { x: number; y: number } | null {
    if (!this.snapshot) return null;
    const me = this.snapshot.players.find(p => p.id === this.myId);
    if (!me) return null;
    return {
      x: (me.position.x - this.camX) * this.scale + this.canvas.width / 2,
      y: (me.position.y - this.camY) * this.scale + this.canvas.height / 2
    };
  }

  updateSnapshot(snapshot: GameSnapshot, myId: string): void {
    this.prevSnapshot = this.snapshot;
    this.snapshot = snapshot;
    this.myId = myId;

    // Update interp buffer
    for (const p of snapshot.players) {
      const prev = this.interpBuffer.get(p.id);
      this.interpBuffer.set(p.id, { current: p, prev: prev?.current ?? p });
    }

    // Spawn muzzle flash for alive players that just shot
    // (delta ammo detection handled by snapshot diff)
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.mousePos.x = e.clientX;
    this.mousePos.y = e.clientY;
  };

  // ─── Main render loop ────────────────────
  private render = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    if (!this.snapshot) {
      this.renderWaiting();
      this.frameId = requestAnimationFrame(this.render);
      return;
    }

    // Update camera — follow self if alive, follow nearest alive ally if dead
    const me = this.snapshot.players.find(p => p.id === this.myId);
    const isAlive = me?.status === 'alive';

    if (isAlive && me) {
      this.updateCamera(me.position);
    } else if (me) {
      // Spectate nearest alive teammate
      const aliveAlly = this.snapshot.players.find(
        p => p.id !== this.myId && p.team === me.team && p.status === 'alive' && p.position.x !== -9999
      );
      if (aliveAlly) {
        this.updateCamera(aliveAlly.position);
      }
      // If no ally alive, keep last camera position (don't call updateCamera)
    }

    // Clear
    this.ctx.fillStyle = '#0d0d0d';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // World transform
    this.ctx.save();
    
    // Apply Shake — guard against NaN from shake state
    const sx = isFinite(this.shake.x) ? (Math.random() - 0.5) * this.shake.x : 0;
    const sy = isFinite(this.shake.y) ? (Math.random() - 0.5) * this.shake.y : 0;
    
    this.ctx.translate(
      -this.camX * this.scale + this.canvas.width / 2 + sx,
      -this.camY * this.scale + this.canvas.height / 2 + sy
    );
    this.ctx.scale(this.scale, this.scale);

    this.renderMap();
    this.renderSpike();          // world entities drawn BEFORE fog
    this.renderPlayers(dt);
    this.renderEffects(dt);
    // Fog-of-war: only for alive players AND only when NOT in buy phase.
    // During buy phase (barriersUp=true), full map visibility is needed for positioning.
    const barriersUp = this.snapshot.round.barriersUp;
    if (me && isAlive && !barriersUp) this.renderDynamicShadows(me);
    this.renderAllyOutlines();   // ally rings drawn AFTER fog so they show through
    if (me && isAlive) this.renderNukeArrow(me);

    this.ctx.restore();

    // Shake decay
    this.shake.x *= 0.8;
    this.shake.y *= 0.8;

    // Screen-space renders (HUD canvas elements)
    this.renderMinimap();
    this.renderCrosshair(me);
    if (me && isAlive && me.activeWeapon === 'operator') {
      this.renderSniperScope();
    }

    this.frameId = requestAnimationFrame(this.render);
  };

  private renderSniperScope(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    // Use mouse position for the center of the scope
    const cx = this.mousePos.x;
    const cy = this.mousePos.y;
    const radius = Math.min(w, h) * 0.45;

    ctx.save();
    
    // Black vignette outside scope circle
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fill();

    // Scope border
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 12;
    ctx.stroke();

    // Crosshair lines inside scope
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.stroke();
    
    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.fill();

    ctx.restore();
  }

  // ─── Map rendering ────────────────────────
  private renderMap(): void {
    if (!this.snapshot) return;
    const map = MAPS[this.snapshot.mapId];
    if (!map) return;

    // Floor — use dynamic map dimensions, not hardcoded globals
    this.ctx.fillStyle = '#141414';
    this.ctx.fillRect(0, 0, map.width, map.height);

    // Zone fills + site perimeter
    const me = this.snapshot.players.find(p => p.id === this.myId);
    const iNukeCarrier = me?.hasSpike === true;

    // Collect per-site polygons
    const sitePolys = new Map<string, typeof map.zones>();

    for (const zone of map.zones) {
      const isSite = zone.type === 'site_a' || zone.type === 'site_b' || zone.type === 'site_c';

      if (isSite) {
        if (!iNukeCarrier) continue; // sites invisible unless carrying nuke
        if (!sitePolys.has(zone.type)) sitePolys.set(zone.type, []);
        sitePolys.get(zone.type)!.push(zone);
        continue;
      }

      // Non-site zone fills
      let fillColor: string | null = null;
      if (zone.type === 'attacker_spawn') fillColor = 'rgba(239,68,68,0.04)';
      else if (zone.type === 'defender_spawn') fillColor = 'rgba(59,130,246,0.04)';
      else if (zone.type === 'buy_zone') fillColor = 'rgba(255,255,255,0.02)';
      else if (zone.type === 'mid') fillColor = 'rgba(255,200,0,0.02)';
      else continue;

      this.ctx.beginPath();
      this.ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y);
      for (let i = 1; i < zone.polygon.length; i++) this.ctx.lineTo(zone.polygon[i].x, zone.polygon[i].y);
      this.ctx.closePath();
      this.ctx.fillStyle = fillColor;
      this.ctx.fill();
    }

    // Draw exact bomb site perimeters (nuke carrier only)
    if (iNukeCarrier) {
      for (const [siteType, zones] of sitePolys) {
        const strokeColor = siteType === 'site_a' ? '#ef4444' : '#3b82f6';
        const fillColor   = siteType === 'site_a' ? 'rgba(239,68,68,0.05)' : 'rgba(59,130,246,0.05)';
        
        // Save ONCE for this entire site — restored at end of block (including label)
        this.ctx.save();

        this.ctx.beginPath();
        for (const zone of zones) {
          if (!zone.polygon || zone.polygon.length === 0) continue;
          this.ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y);
          for (let i = 1; i < zone.polygon.length; i++) this.ctx.lineTo(zone.polygon[i].x, zone.polygon[i].y);
          this.ctx.closePath();
        }
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();
        
        this.ctx.shadowColor = strokeColor;
        this.ctx.shadowBlur = 15;
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();
        // Reset shadow BEFORE restore so the restore has clean shadow state
        this.ctx.shadowBlur = 0;
        this.ctx.shadowColor = 'transparent';

        // Label (calculate center from polygons)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasValidPoints = false;
        for (const zone of zones) {
          if (!zone.polygon) continue;
          for (const p of zone.polygon) {
            hasValidPoints = true;
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
        
        if (hasValidPoints) {
          const label = siteType === 'site_a' ? 'SITE A' : siteType === 'site_b' ? 'SITE B' : 'SITE C';
          const alpha = 0.25;
          const labelColor = siteType === 'site_a'
            ? `rgba(239,68,68,${alpha})`
            : `rgba(59,130,246,${alpha})`;
          this.ctx.font = 'bold 32px Rajdhani, sans-serif';
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillStyle = labelColor;
          this.ctx.fillText(label, (minX + maxX) / 2, (minY + maxY) / 2);
        }

        // CRITICAL: restore canvas state after each site (fixes black screen bug)
        this.ctx.restore();
      }
    }

    // Walls
    this.ctx.strokeStyle = '#2a2a2a';
    this.ctx.lineWidth = 5;
    this.ctx.lineCap = 'round';

    for (const wall of map.walls) {
      this.ctx.beginPath();
      this.ctx.moveTo(wall.x1, wall.y1);
      this.ctx.lineTo(wall.x2, wall.y2);
      this.ctx.stroke();
    }

    // Barriers
    if (this.snapshot.round.barriersUp) {
      this.renderBarriers(map);
    }
  }

  private renderBarriers(map: any): void {
    const t = Date.now() / 1000;
    const offset = (t * 50) % 40; // stripes movement

    for (const zone of map.zones) {
      if (zone.type !== 'barrier') continue;

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y);
      for (let i = 1; i < zone.polygon.length; i++) {
        this.ctx.lineTo(zone.polygon[i].x, zone.polygon[i].y);
      }
      this.ctx.closePath();
      this.ctx.clip();

      // Cyan background
      this.ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
      this.ctx.fill();

      // Moving stripes
      this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      this.ctx.lineWidth = 15;
      for (let y = -map.height; y < map.height * 2; y += 40) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y + offset);
        this.ctx.lineTo(map.width, y + offset + map.width * 0.5); // slanted
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }

  private renderDynamicShadows(me: PlayerState): void {
    if (!this.snapshot) return;
    // Guard: if player position is invalid, skip shadow rendering
    if (!me.position || isNaN(me.position.x) || isNaN(me.position.y)) return;

    const map = MAPS[this.snapshot.mapId];
    if (!map) return;

    const ctx = this.ctx;
    // Build segments: map walls + a large boundary box so rays always terminate.
    // Note: barriers are NOT included here — during buy phase fog is disabled entirely,
    // and post-buy barriers are gone. Barriers have their own cyan visual rendering.
    const BOUND = 8000;
    const segments = [
      ...map.walls.map(w => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
    ];

    // Bounding box to terminate rays
    segments.push(
      { x1: -BOUND, y1: -BOUND, x2: BOUND,  y2: -BOUND },
      { x1: BOUND,  y1: -BOUND, x2: BOUND,  y2: BOUND  },
      { x1: BOUND,  y1:  BOUND, x2: -BOUND, y2: BOUND  },
      { x1: -BOUND, y1:  BOUND, x2: -BOUND, y2: -BOUND },
    );

    // Collect unique angles to all segment endpoints (cast 3 rays per endpoint)
    const angles: number[] = [];
    for (const seg of segments) {
      for (const [px, py] of [[seg.x1, seg.y1], [seg.x2, seg.y2]] as [number, number][]) {
        const a = Math.atan2(py - me.position.y, px - me.position.x);
        if (!isNaN(a)) angles.push(a - 0.00001, a, a + 0.00001);
      }
    }

    // For each angle, cast a ray and record the closest hit point
    const hits: Array<{ angle: number; x: number; y: number }> = [];
    for (const angle of angles) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let minT = Infinity;
      for (const seg of segments) {
        const t = this.raySegIntersect(me.position.x, me.position.y, dx, dy, seg);
        if (t !== null && t < minT) minT = t;
      }
      if (minT < Infinity && isFinite(minT)) {
        const hx = me.position.x + dx * minT;
        const hy = me.position.y + dy * minT;
        if (!isNaN(hx) && !isNaN(hy)) {
          hits.push({ angle, x: hx, y: hy });
        }
      }
    }
    hits.sort((a, b) => a.angle - b.angle);

    if (hits.length < 3) return;

    // Draw fog everywhere EXCEPT the visible polygon using evenodd fill rule
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.beginPath();
    // Outer bounding rectangle (fills everything)
    ctx.rect(-BOUND, -BOUND, BOUND * 2, BOUND * 2);
    // Inner visible polygon (reverse winding creates a hole via evenodd)
    ctx.moveTo(hits[0].x, hits[0].y);
    for (let i = 1; i < hits.length; i++) ctx.lineTo(hits[i].x, hits[i].y);
    ctx.closePath();
    ctx.fill('evenodd');
    
    // Stroke the hole boundary to eliminate 1px anti-aliasing light leaks
    ctx.beginPath();
    ctx.moveTo(hits[0].x, hits[0].y);
    for (let i = 1; i < hits.length; i++) ctx.lineTo(hits[i].x, hits[i].y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    ctx.restore();
  }

  // Ray-segment intersection: returns t (distance along ray) or null
  private raySegIntersect(
    rx: number, ry: number, rdx: number, rdy: number,
    seg: { x1: number; y1: number; x2: number; y2: number },
  ): number | null {
    const sdx = seg.x2 - seg.x1;
    const sdy = seg.y2 - seg.y1;
    const denom = rdx * sdy - rdy * sdx;
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((seg.x1 - rx) * sdy - (seg.y1 - ry) * sdx) / denom;
    const u = ((seg.x1 - rx) * rdy - (seg.y1 - ry) * rdx) / denom;
    if (t >= 0 && u >= 0 && u <= 1) return t;
    return null;
  }

  private renderFogOfWar(_me: PlayerState): void {
    // Legacy - replaced by Dynamic Shadows
  }

  // Draw ally outlines through shadows (team-colored ring only, no fill)
  private renderAllyOutlines(): void {
    if (!this.snapshot) return;
    const alpha = Math.min(1, (Date.now() - (this.snapshot.timestamp - 33)) / 33);
    for (const player of this.snapshot.players) {
      if (player.id === this.myId) continue; // skip self
      if (player.position.x === -9999) continue; // hidden by server
      if (player.status === 'dead') continue;

      // Find local player's team to determine if this is ally
      const me = this.snapshot.players.find(p => p.id === this.myId);
      if (!me || player.team !== me.team) continue; // enemies stay hidden under shadow

      const interp = this.interpBuffer.get(player.id);
      const pos = interp ? this.lerp2D(interp.prev.position, player.position, alpha) : player.position;

      const color = player.team === 'attackers' ? '#ef4444' : '#3b82f6';
      const r = GAME_CONSTANTS.PLAYER_RADIUS * 1.4;

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = 0.65;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
      this.ctx.restore();
    }
  }

  // Draw yellow directional arrow pointing at dropped nuke
  private renderNukeArrow(me: PlayerState): void {
    if (!this.snapshot) return;
    const spike = this.snapshot.spike;
    if (spike.status !== 'dropped') return;

    const angle = Math.atan2(
      spike.position.y - me.position.y,
      spike.position.x - me.position.x,
    );
    const orbitRadius = GAME_CONSTANTS.PLAYER_RADIUS * 2.5;
    const ax = me.position.x + Math.cos(angle) * orbitRadius;
    const ay = me.position.y + Math.sin(angle) * orbitRadius;

    this.ctx.save();
    this.ctx.translate(ax, ay);
    this.ctx.rotate(angle);

    // Arrow head
    this.ctx.beginPath();
    this.ctx.moveTo(8, 0);
    this.ctx.lineTo(-5, -5);
    this.ctx.lineTo(-5, 5);
    this.ctx.closePath();
    this.ctx.fillStyle = '#fbbf24';
    this.ctx.shadowColor = '#fbbf24';
    this.ctx.shadowBlur = 10;
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    this.ctx.restore();
  }

  // ─── Player rendering ─────────────────────
  private renderPlayers(dt: number): void {
    if (!this.snapshot) return;
    const alpha = Math.min(1, (Date.now() - (this.snapshot.timestamp - 33)) / 33);

    for (const player of this.snapshot.players) {
      if (player.position.x === -9999) continue; // hidden by fog

      const interp = this.interpBuffer.get(player.id);
      const pos = interp ? this.lerp2D(interp.prev.position, player.position, alpha) : player.position;

      if (player.status === 'dead') {
        this.renderDeadPlayer(pos, player.team, player.name);
        continue;
      }

      const isMe = player.id === this.myId;
      this.renderPlayer(player, pos, isMe);
    }
  }

  private renderPlayer(player: PlayerState, pos: Vec2, isMe: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(player.angle + Math.PI / 2);

    // Team colors
    const color = player.team === 'attackers' ? '#ef4444' : '#3b82f6';
    const borderColor = player.team === 'attackers' ? '#dc2626' : '#2563eb';
    const size = GAME_CONSTANTS.PLAYER_RADIUS * 1.3;

    // --- GEOMETRIC STACKED BODY ---
    // Layer 1: Base inverted triangle
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.7, size * 0.6);
    ctx.lineTo(-size * 0.7, size * 0.6);
    ctx.closePath();
    ctx.fillStyle = isMe ? color + 'ff' : color + 'cc';
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isMe ? 2.5 : 1.5;
    ctx.stroke();

    // Layer 2: Inner cyber-diamond detail
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.4);
    ctx.lineTo(size * 0.3, size * 0.1);
    ctx.lineTo(0, size * 0.6);
    ctx.lineTo(-size * 0.3, size * 0.1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Layer 3: Lateral thrusters / shoulders
    ctx.fillStyle = color;
    ctx.fillRect(size * 0.5, size * 0.1, size * 0.3, size * 0.4);
    ctx.fillRect(-size * 0.8, size * 0.1, size * 0.3, size * 0.4);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(size * 0.5, size * 0.1, size * 0.3, size * 0.4);
    ctx.strokeRect(-size * 0.8, size * 0.1, size * 0.3, size * 0.4);

    // Layer 4: Central Power Core
    ctx.beginPath();
    ctx.arc(0, size * 0.2, size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.shadowColor = isMe ? '#fff' : color;
    ctx.shadowBlur = isMe ? 10 : 5;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Direction indicator line
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.8);
    ctx.lineTo(0, -size - 12);
    ctx.stroke();

    // --- WEAPON VISUAL ---
    this.renderWeaponVisual(ctx, player, size, isMe);

    ctx.restore();

    // --- GEOMETRIC HEAD ---
    ctx.save();
    ctx.translate(pos.x, pos.y);
    const headOffset = { x: Math.cos(player.angle) * -2, y: Math.sin(player.angle) * -2 };
    
    // Head base
    ctx.beginPath();
    ctx.arc(headOffset.x, headOffset.y, GAME_CONSTANTS.HEAD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? color : color + 'aa';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Visor detail
    ctx.beginPath();
    ctx.arc(headOffset.x + Math.cos(player.angle) * 2, headOffset.y + Math.sin(player.angle) * 2, GAME_CONSTANTS.HEAD_RADIUS * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();

    // --- NUCLEAR EXPLOSIVE (CARRIER) ---
    if (player.hasSpike) {
      ctx.save();
      ctx.translate(pos.x, pos.y + GAME_CONSTANTS.PLAYER_RADIUS + 8);
      this.drawRadioactiveSymbol(ctx, 8, false); // Reduced size for carrier
      ctx.restore();
    }

    // --- NAME TAG & LOADOUT ---
    ctx.save();
    ctx.translate(pos.x, pos.y - GAME_CONSTANTS.PLAYER_RADIUS - 18);
    ctx.fillStyle = isMe ? 'rgba(255,255,255,0.9)' : 'rgba(200,200,200,0.7)';
    ctx.font = `${isMe ? 'bold ' : ''}10px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name, 0, 0);

    // Indicators
    let indicator = WEAPON_STATS[player.activeWeapon as WeaponId]?.name?.substring(0,3).toUpperCase() || 'WPN';
    if (player.armor > 0) indicator += player.armorType === 'heavy' ? ' | HVY' : ' | LGT';
    
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `8px 'JetBrains Mono', monospace`;
    ctx.fillText(indicator, 0, 10);

    // Interaction Progress Bar
    const spike = this.snapshot?.spike;
    if (spike) {
      const isPlanting = spike.carrierId === player.id && spike.plantProgress > 0 && spike.plantProgress < 1;
      const isDefusing = spike.defuserId === player.id && spike.defuseProgress > 0 && spike.defuseProgress < 1;
      
      if (isPlanting || isDefusing) {
        const progress = isPlanting ? spike.plantProgress : spike.defuseProgress;
        const barW = 40;
        const barH = 4;
        const bx = -barW / 2;
        const by = -GAME_CONSTANTS.PLAYER_RADIUS - 30;
        
        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, barW, barH);
        
        // Fill - Bright white with light blue glow
        ctx.shadowColor = '#00f2ff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, barW * progress, barH);
        ctx.shadowBlur = 0;
      }
    }
    
    ctx.restore();
  }

  private renderWeaponVisual(ctx: CanvasRenderingContext2D, player: PlayerState, size: number, isMe: boolean): void {
    const weapon = WEAPON_STATS[player.activeWeapon as WeaponId];
    if (!weapon) return;

    ctx.save();
    if (player.activeWeapon === 'knife') {
      // Find if this player swung recently (within 2 seconds) to animate
      const swingEffect = this.effects.find(e => e.type === 'knife_swing' && Math.hypot(e.x - player.position.x, e.y - player.position.y) < 10);
      
      if (swingEffect) {
        const progress = 1 - (swingEffect.life / swingEffect.maxLife); // 0 to 1
        
        if (progress < 0.15) {
          // Wind up: pull back and outward
          ctx.translate(size * 0.8, size * 0.2);
          ctx.rotate(-Math.PI / 4 - 0.5);
        } else if (progress < 0.3) {
          // Fast swing forward
          ctx.translate(size * 0.7, -size * 0.5);
          ctx.rotate(-Math.PI / 4 + 1.5);
        } else {
          // Slow 2-second cooldown return
          const returnProgress = (progress - 0.3) / 0.7; // 0 to 1 over the rest of the life
          const lerpOffset = size * 0.7 + (size * 0.1) * (1 - returnProgress);
          const lerpRot = -Math.PI / 4 + 1.5 * (1 - returnProgress);
          ctx.translate(lerpOffset, -size * 0.5 * (1 - returnProgress));
          ctx.rotate(lerpRot);
        }
      } else {
        // Idle
        ctx.translate(size * 0.7, 0);
        ctx.rotate(-Math.PI / 4);
      }
      
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(4, -22);
      ctx.lineTo(8, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      // Generic gun barrel
      const color = player.activeWeapon === 'operator' ? '#f59e0b' : '#333';
      ctx.fillStyle = color;
      const barrelLen = player.activeWeapon === 'operator' ? 25 : 12;
      ctx.fillRect(-2, -size - 5, 4, -barrelLen);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.strokeRect(-2, -size - 5, 4, -barrelLen);
    }
    ctx.restore();
  }

  private renderDeadPlayer(pos: Vec2, team: string, name: string): void {
    const color = team === 'attackers' ? 'rgba(239,68,68,0.7)' : 'rgba(59,130,246,0.7)';
    
    this.ctx.save();
    this.ctx.translate(pos.x, pos.y);
    
    // Red/White X marker
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(-8, -8); this.ctx.lineTo(8, 8);
    this.ctx.moveTo(8, -8); this.ctx.lineTo(-8, 8);
    this.ctx.stroke();

    // Inner white highlight
    this.ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(-6, -6); this.ctx.lineTo(6, 6);
    this.ctx.moveTo(6, -6); this.ctx.lineTo(-6, 6);
    this.ctx.stroke();

    // Outer circle ring for death
    this.ctx.beginPath();
    this.ctx.arc(0, 0, 12, 0, Math.PI * 2);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 4]);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Nickname
    this.ctx.fillStyle = 'rgba(255,255,255,0.6)';
    this.ctx.font = `10px 'JetBrains Mono', monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(name, 0, 10);
    
    this.ctx.restore();
  }

  // ─── Nuclear Explosive (Nuke) ─────────────
  private renderSpike(): void {
    if (!this.snapshot) return;
    const spike = this.snapshot.spike;
    if (spike.status === 'carried') return;

    const pos = spike.position;
    const t = Date.now();

    this.ctx.save();
    this.ctx.translate(pos.x, pos.y);

    if (spike.status === 'planted') {
      this.renderPlantedTotem(t, spike);
    } else if (spike.status === 'dropped') {
      this.drawRadioactiveSymbol(this.ctx, 16, true);
    } else if (spike.status === 'exploded') {
      // Massive lethal explosion ring expanding
      const elapsed = (t - (spike.explodeTime || 0)) / 1000;
      if (elapsed > 0 && elapsed < 3) {
         const radius = 600 * (elapsed / 3);
         this.ctx.beginPath();
         this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
         this.ctx.fillStyle = `rgba(255, 255, 255, ${1 - elapsed / 3})`;
         this.ctx.fill();
         this.ctx.strokeStyle = `rgba(239, 120, 30, ${0.8 * (1 - elapsed / 3)})`;
         this.ctx.lineWidth = 15;
         this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  private drawRadioactiveSymbol(ctx: CanvasRenderingContext2D, size: number, glow: boolean): void {
    ctx.save();
    if (glow) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 15;
    }
    
    // Yellow square base
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-size/2, -size/2, size, size);
    
    // 3 Black triangles
    ctx.fillStyle = '#000';
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, size * 0.45, -Math.PI/6, Math.PI/6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    
    // Small black center circle
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  private renderPlantedTotem(t: number, spike: any): void {
    const ctx = this.ctx;
    
    // Explosion progress for pulsing
    const progress = spike.explodeTime
      ? 1 - (spike.explodeTime - t) / GAME_CONSTANTS.SPIKE_EXPLODE_COUNTDOWN
      : 0;
    
    // Frequency increases: 30s -> slow, 1s -> very fast
    const frequency = 0.5 + progress * 4.5; // pulses per second
    const pulse = (Math.sin(t / 1000 * frequency * Math.PI * 2) + 1) / 2;
    
    const size = 32; // Totem is double player size (~14 * 2)
    
    // 1. Base (flat rectangle)
    ctx.fillStyle = '#222';
    ctx.fillRect(-size/2, size/4, size, size/4);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(-size/2, size/4, size, size/4);
    
    // 2. Column (smaller rectangle)
    ctx.fillRect(-size/8, -size/2, size/4, size * 0.75);
    ctx.strokeRect(-size/8, -size/2, size/4, size * 0.75);
    
    // 3. Top Square (pulses red)
    const topSize = size/3;
    ctx.save();
    ctx.translate(0, -size/2);
    
    ctx.fillStyle = '#111';
    ctx.fillRect(-topSize/2, -topSize/2, topSize, topSize);
    
    // Pulsing light
    ctx.fillStyle = `rgba(255, 0, 0, ${0.3 + pulse * 0.7})`;
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = pulse * 20;
    ctx.fillRect(-topSize/2 + 2, -topSize/2 + 2, topSize - 4, topSize - 4);
    
    ctx.restore();
  }

  // ─── Effects ──────────────────────────────
  private renderEffects(dt: number): void {
    this.effects = this.effects.filter(e => e.life > 0);

    for (const e of this.effects) {
      e.life -= dt;
      const alpha = e.life / e.maxLife;

      if (e.type === 'tracer' && e.tx !== undefined && e.ty !== undefined) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(e.x, e.y);
        this.ctx.lineTo(e.tx, e.ty);
        
        // NEON YELLOW TRACER (#CCFF00)
        this.ctx.strokeStyle = `rgba(204, 255, 0, ${alpha})`;
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowColor = '#ccff00';
        this.ctx.shadowBlur = 12 * alpha;
        this.ctx.stroke();
        
        // Inner core (white-ish)
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        this.ctx.lineWidth = 0.8;
        this.ctx.stroke();
        this.ctx.restore();
      } else if (e.type === 'hit') {
        const hitR = Math.max(0.001, (1 - alpha) * 8 + 2);
        this.ctx.beginPath();
        this.ctx.arc(e.x, e.y, hitR, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(255,80,80,${alpha})`;
        this.ctx.fill();
      } else if (e.type === 'muzzle') {
        this.ctx.save();
        this.ctx.beginPath();
        const r = Math.max(0.001, (1 - alpha) * 15 + 8);
        this.ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        const grad = this.ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        grad.addColorStop(0, `rgba(255, 255, 200, ${alpha})`);
        grad.addColorStop(0.3, `rgba(255, 150, 0, ${alpha * 0.8})`);
        grad.addColorStop(1, 'rgba(255, 50, 0, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fill();
        this.ctx.restore();
      } else if (e.type === 'impact') {
        if (e.velocity) {
          e.x += e.velocity.x * dt;
          e.y += e.velocity.y * dt;
        }
        const impactR = Math.max(0.001, 2 * alpha);
        this.ctx.beginPath();
        this.ctx.arc(e.x, e.y, impactR, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(204, 255, 0, ${alpha})`;
        this.ctx.fill();
      } else if (e.type === 'knife_swing') {
        // Rapid arc sweep — white neon arc 120° around player
        const sweepAngle = e.angle ?? 0;
        const arcRadius = 32;
        // The effect lasts 2 seconds, but the sweep itself is fast (first 15% of the time)
        const progress = 1 - alpha; // 0 = start, 1 = end of 2s
        
        if (progress < 0.15) {
          const sweepProgress = progress / 0.15;
          const startAngle = sweepAngle - Math.PI / 3 + sweepProgress * (Math.PI / 3);
          const endAngle   = sweepAngle + Math.PI / 3 - sweepProgress * (Math.PI / 3) * 0.5;
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.arc(e.x, e.y, arcRadius, startAngle, endAngle);
          this.ctx.strokeStyle = `rgba(255, 255, 255, 0.9)`;
          this.ctx.lineWidth = 4;
          this.ctx.shadowColor = '#ffffff';
          this.ctx.shadowBlur = 12;
          this.ctx.stroke();
          this.ctx.shadowBlur = 0;
          this.ctx.restore();
        }
      }
    }
  }

  addEffect(type: 'tracer' | 'hit' | 'muzzle' | 'impact' | 'knife_swing', x: number, y: number, tx?: number, ty?: number, color = '#fff', angle?: number): void {
    if (isNaN(x) || isNaN(y)) return;
    if (tx !== undefined && isNaN(tx)) return;
    if (ty !== undefined && isNaN(ty)) return;

    const life = type === 'knife_swing' ? 2.0 : (type === 'tracer' ? 0.4 : (type === 'impact' ? 0.6 : 0.15));
    
    if (type === 'impact') {
      // Spawn 6-8 particles as per spec
      const count = 6 + Math.floor(Math.random() * 3); // 6, 7, or 8
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 150;
        const particleLife = 0.4 + Math.random() * 0.3; // 0.4-0.7s
        this.effects.push({
          type: 'impact', x, y, life: particleLife, maxLife: particleLife, color,
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
        });
      }
      return;
    }

    if (type === 'knife_swing') {
      this.effects.push({ type: 'knife_swing', x, y, life: 0.25, maxLife: 0.25, color: '#00f2ff', angle });
      return;
    }

    this.effects.push({ type, x, y, tx, ty, life, maxLife: life, color });

    // Handle screen shake if it's a muzzle from a rifle
    if (type === 'muzzle') {
      const me = this.snapshot?.players.find(p => p.id === this.myId);
      if (me) {
        const weapon = WEAPON_STATS[me.activeWeapon as WeaponId];
        const shakeVal = weapon?.screenShake || 0;
        if (shakeVal > 0) {
          this.shake.x += (Math.random() - 0.5) * shakeVal * 10;
          this.shake.y += (Math.random() - 0.5) * shakeVal * 10;
        }
      }
    }
  }

  // ─── Minimap ──────────────────────────────
  private renderMinimap(): void {
    if (!this.snapshot) return;
    const map = MAPS[this.snapshot.mapId];
    if (!map) return;

    const mSize = this.MINIMAP_SIZE;
    const mx = this.canvas.width - mSize - this.MINIMAP_MARGIN;
    const my = this.MINIMAP_MARGIN;
    const scaleX = mSize / map.width;
    const scaleY = mSize / map.height;

    // Background
    this.ctx.fillStyle = 'rgba(0,0,0,0.75)';
    this.ctx.fillRect(mx, my, mSize, mSize);
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(mx, my, mSize, mSize);

    // Walls
    this.ctx.strokeStyle = '#444';
    this.ctx.lineWidth = 0.5;
    for (const wall of map.walls) {
      this.ctx.beginPath();
      this.ctx.moveTo(mx + wall.x1 * scaleX, my + wall.y1 * scaleY);
      this.ctx.lineTo(mx + wall.x2 * scaleX, my + wall.y2 * scaleY);
      this.ctx.stroke();
    }

    // Site labels
    this.ctx.font = 'bold 8px Inter, sans-serif';
    this.ctx.textAlign = 'center';
    for (const zone of map.zones) {
      if (zone.type !== 'site_a' && zone.type !== 'site_b' && zone.type !== 'site_c') continue;
      const cx = mx + zone.polygon.reduce((s, p) => s + p.x, 0) / zone.polygon.length * scaleX;
      const cy = my + zone.polygon.reduce((s, p) => s + p.y, 0) / zone.polygon.length * scaleY;
      this.ctx.fillStyle = zone.type === 'site_a' ? 'rgba(239,68,68,0.6)' : 'rgba(59,130,246,0.6)';
      this.ctx.fillText(zone.label, cx, cy);
    }

    // Spike
    const spike = this.snapshot.spike;
    if (spike.status !== 'carried' && spike.status !== 'defused') {
      const sx = mx + spike.position.x * scaleX;
      const sy = my + spike.position.y * scaleY;
      const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(239,68,68,${pulse})`;
      this.ctx.fill();
    }

    // Players
    for (const p of this.snapshot.players) {
      if (p.position.x === -9999) continue;
      const px = mx + p.position.x * scaleX;
      const py = my + p.position.y * scaleY;
      const isMe = p.id === this.myId;

      this.ctx.beginPath();
      this.ctx.arc(px, py, isMe ? 3.5 : 2.5, 0, Math.PI * 2);
      this.ctx.fillStyle = p.status === 'dead' ? '#444' : p.team === 'attackers' ? '#ef4444' : '#3b82f6';
      this.ctx.fill();

      if (isMe) {
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
      }
    }
  }

  // ─── Crosshair ────────────────────────────
  private renderCrosshair(me: PlayerState | undefined): void {
    // We use the real mouse position for the crosshair since we are not using pointer lock
    const mx = this.mousePos.x;
    const my = this.mousePos.y;

    // Expand if moving/shooting
    const isMoving = me ? Math.hypot(me.velocity.x, me.velocity.y) > 20 : false;
    const gap = isMoving ? 14 : 5;
    const len = 8;

    this.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    this.ctx.lineWidth = 1.5;
    this.ctx.lineCap = 'butt';

    // Top
    this.ctx.beginPath();
    this.ctx.moveTo(mx, my - gap);
    this.ctx.lineTo(mx, my - gap - len);
    this.ctx.stroke();
    // Bottom
    this.ctx.beginPath();
    this.ctx.moveTo(mx, my + gap);
    this.ctx.lineTo(mx, my + gap + len);
    this.ctx.stroke();
    // Left
    this.ctx.beginPath();
    this.ctx.moveTo(mx - gap, my);
    this.ctx.lineTo(mx - gap - len, my);
    this.ctx.stroke();
    // Right
    this.ctx.beginPath();
    this.ctx.moveTo(mx + gap, my);
    this.ctx.lineTo(mx + gap + len, my);
    this.ctx.stroke();
    
    // Dot in center
    this.ctx.beginPath();
    this.ctx.arc(mx, my, 1, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(255,255,255,1)';
    this.ctx.fill();
  }

  // ─── Camera ───────────────────────────────
  private updateCamera(target: Vec2): void {
    const me = this.snapshot?.players.find(p => p.id === this.myId);
    let targetScale = Math.min(window.innerWidth / 1280, window.innerHeight / 720) * 0.85;

    // Calculate mouse position in world space
    const worldMouseX = (this.mousePos.x - this.canvas.width / 2) / this.scale + this.camX;
    const worldMouseY = (this.mousePos.y - this.canvas.height / 2) / this.scale + this.camY;

    // Default pan factor is 20% towards mouse. If using Operator, pan 40% towards mouse to see much further.
    const panFactor = me && me.activeWeapon === 'operator' ? 0.4 : 0.20;

    const finalTargetX = target.x + (worldMouseX - target.x) * panFactor;
    const finalTargetY = target.y + (worldMouseY - target.y) * panFactor;

    if (me && me.activeWeapon === 'operator') {
       targetScale *= 1.3; // Zoom in for sniper
    }

    const lerp = 0.15;
    this.camX += (finalTargetX - this.camX) * lerp;
    this.camY += (finalTargetY - this.camY) * lerp;
    this.scale += (targetScale - this.scale) * 0.1;
  }

  // ─── Helpers ──────────────────────────────
  private lerp2D(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  private renderWaiting(): void {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#333';
    this.ctx.font = 'bold 14px Inter, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('Waiting for game...', this.canvas.width / 2, this.canvas.height / 2);
  }

  private resize = (): void => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.scale = Math.min(
      window.innerWidth / 1280,
      window.innerHeight / 720,
    ) * 0.85;
  };
}
