import { v4 as uuidv4 } from 'uuid';
import type { PlayerState, Vec2, WeaponId, MapDefinition, AudioEvent } from '@tactical-fps/shared';
import { WEAPON_STATS, GAME_CONSTANTS } from '@tactical-fps/shared';
import { PhysicsSystem } from './PhysicsSystem';

interface SnapshotEntry {
  tick: number;
  timestamp: number;
  players: Map<string, { position: Vec2; angle: number }>;
}

type HitCallback = (event: {
  attackerId: string; targetId: string; damage: number;
  isHeadshot: boolean; weaponId: WeaponId;
} | AudioEvent) => void;

// Per-player fire rate limiter (key: playerId)
const lastShotTick = new Map<string, number>();
// Reload tracking (key: playerId)
const reloadEndTick = new Map<string, number>();

const TICK_RATE = GAME_CONSTANTS.TICK_RATE;
// Operator scope charge tracking
const operatorChargeStart = new Map<string, number>();
// Knife last swing tracking (ms)
const knifeLastSwing = new Map<string, number>();
// Semi-auto fire lock: prevents holding trigger
const wasShootingMap = new Map<string, boolean>();

export class ShootingSystem {
  private physics: PhysicsSystem;

  constructor(map: MapDefinition) {
    this.physics = new PhysicsSystem(map);
  }

  /**
   * Returns true if the player's active weapon is a knife (for speed boost application).
   */
  static isKnife(player: PlayerState): boolean {
    return player.activeWeapon === 'knife';
  }

  shoot(
    shooter: PlayerState,
    currentTick: number,
    players: Map<string, PlayerState>,
    snapshots: SnapshotEntry[],
    onEvent: HitCallback,
    barriersUp = false,
  ): void {
    const weapon = WEAPON_STATS[shooter.activeWeapon];
    if (!weapon) return;

    // Melee Logic
    if (weapon.slot === 'melee') {
      this.handleMelee(shooter, currentTick, players, onEvent);
      return;
    }

    // Operator Charge-up Logic (scoped rifle needs time to aim)
    if (shooter.activeWeapon === 'operator') {
      let chargeStart = operatorChargeStart.get(shooter.id) ?? 0;
      if (chargeStart === 0) {
        operatorChargeStart.set(shooter.id, Date.now());
        return; // Start charging
      }

      const elapsed = Date.now() - chargeStart;
      if (elapsed < (weapon.scopeTime || 0)) {
        return; // Still charging / scoping
      }

      // Fully charged — reset and proceed to fire
      operatorChargeStart.set(shooter.id, 0);
    } else {
      operatorChargeStart.delete(shooter.id);
    }

    // Reload check
    const reloadEnd = reloadEndTick.get(shooter.id) ?? 0;
    if (Date.now() < reloadEnd) return; // still reloading

    // Fire rate limiter
    const ticksBetweenShots = Math.ceil(TICK_RATE / weapon.fireRate);
    const lastTick = lastShotTick.get(shooter.id) ?? 0;
    if (currentTick - lastTick < ticksBetweenShots) return;

    // Semi-auto lock: prevent holding the trigger
    // Automatic weapons ALWAYS bypass this check
    if (!weapon.automatic) {
      if (wasShootingMap.get(shooter.id)) return;
      wasShootingMap.set(shooter.id, true);
    }
    // Automatic weapons: clear the semi-auto lock so they always fire while held
    // (wasShootingMap is irrelevant for them, already handled above)

    // Ammo empty — just play click sound, no auto-reload
    if (shooter.ammo[shooter.activeWeapon] <= 0) {
      onEvent({
        type: 'low_ammo',
        position: shooter.position,
        range: 300,
      } as AudioEvent);
      return;
    }

    lastShotTick.set(shooter.id, currentTick);
    shooter.ammo[shooter.activeWeapon]--;

    // Calculate spread
    const spread = this.calcSpread(shooter, weapon);

    // Spray pattern offset
    const shotIndex = currentTick - lastTick;
    const pattern = weapon.recoilPattern[Math.min(shotIndex, weapon.recoilPattern.length - 1)] ?? { x: 0, y: 0 };
    const spreadRad = ((spread + Math.abs(pattern.x) * 0.1) * Math.PI) / 180;

    // Audio — includes weaponId so client can play correct sound profile
    onEvent({
      type: 'gunshot',
      position: shooter.position,
      range: weapon.range * 1.5,
      weaponId: shooter.activeWeapon,
    } as AudioEvent);

    // Shotgun: multiple pellets
    const pellets = shooter.activeWeapon === 'judge' ? 12 : 1;

    for (let p = 0; p < pellets; p++) {
      const angleOffset = (Math.random() - 0.5) * spreadRad * 2;
      const finalAngle = shooter.angle + angleOffset;
      const dir: Vec2 = { x: Math.cos(finalAngle), y: Math.sin(finalAngle) };

      // Lag compensated hit detection
      const hitInfo = this.lagCompensatedRaycast(shooter, dir, weapon, players, snapshots, barriersUp);

      // Always emit hit for tracers (even if it hits a wall)
      onEvent({
        type: 'bullet_hit',
        origin: { ...shooter.position },
        target: hitInfo.hitPos,
        hitType: hitInfo.playerHit ? 'player' : 'wall',
        playerId: shooter.id
      } as any);

      if (hitInfo.playerHit) {
        const isHeadshot = hitInfo.playerHit.isHeadshot;
        const dmg = isHeadshot ? weapon.damage.head : weapon.damage.body;

        onEvent({
          attackerId: shooter.id,
          targetId: hitInfo.playerHit.playerId,
          damage: dmg,
          isHeadshot,
          weaponId: shooter.activeWeapon,
        } as any);
      }
    }
  }

  stopShooting(shooterId: string): void {
    operatorChargeStart.delete(shooterId);
    wasShootingMap.set(shooterId, false);
  }

  startReload(player: PlayerState, onEvent?: (e: any) => void): void {
    const weapon = WEAPON_STATS[player.activeWeapon];
    if (!weapon || weapon.magSize === 0) return;            // knife/nuke — no reload
    if (player.reserveAmmo[player.activeWeapon] <= 0) return; // no reserve ammo
    if (player.isReloading) return;                          // already reloading

    const reloadEnd = Date.now() + weapon.reloadTime;
    reloadEndTick.set(player.id, reloadEnd);
    player.isReloading = true;

    if (onEvent) {
      onEvent({
        type: 'reload',
        position: player.position,
        range: 600,
        weaponId: player.activeWeapon,
      } as AudioEvent);
    }

    const reloadWeapon = player.activeWeapon;
    
    setTimeout(() => {
      // Only reload if player still has the same weapon (didn't switch)
      if (player.activeWeapon !== reloadWeapon) return;
      const needed = weapon.magSize - player.ammo[reloadWeapon];
      const take = Math.min(needed, player.reserveAmmo[reloadWeapon]);
      player.ammo[reloadWeapon] += take;
      player.reserveAmmo[reloadWeapon] -= take;
      player.isReloading = false;
      reloadEndTick.delete(player.id);
    }, weapon.reloadTime);
  }

  private handleMelee(
    shooter: PlayerState,
    currentTick: number,
    players: Map<string, PlayerState>,
    onEvent: HitCallback,
  ): void {
    const weapon = WEAPON_STATS['knife'];
    const now = Date.now();
    const lastSwing = knifeLastSwing.get(shooter.id) ?? 0;

    // Melee fire rate limiter
    const msBetweenSwings = 1000 / weapon.fireRate;
    if (now - lastSwing < msBetweenSwings) return;

    knifeLastSwing.set(shooter.id, now);

    // Audio for swing
    onEvent({
      type: 'knife_swing',
      position: shooter.position,
      range: 300,
      playerId: shooter.id,
      angle: shooter.angle,
    } as any);

    // Find nearest enemy in front arc (60°)
    let closest: { id: string; dist: number } | null = null;
    for (const [id, player] of players) {
      if (id === shooter.id || player.team === shooter.team) continue;
      if (player.status !== 'alive') continue;

      const d = Math.hypot(player.position.x - shooter.position.x, player.position.y - shooter.position.y);
      if (d <= weapon.range) {
        const angleToTarget = Math.atan2(
          player.position.y - shooter.position.y,
          player.position.x - shooter.position.x,
        );
        const angleDiff = Math.abs(this.normalizeAngle(angleToTarget - shooter.angle));
        if (angleDiff < Math.PI / 3) { // 60° cone
          if (!closest || d < closest.dist) {
            closest = { id, dist: d };
          }
        }
      }
    }

    if (closest) {
      onEvent({
        attackerId: shooter.id,
        targetId: closest.id,
        damage: weapon.damage.body,
        isHeadshot: false,
        weaponId: 'knife',
      } as any);
    }
  }

  private normalizeAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ─── Spread calculation ───────────────────
  private calcSpread(player: PlayerState, weapon: typeof WEAPON_STATS[WeaponId]): number {
    const isMoving = Math.hypot(player.velocity.x, player.velocity.y) > 10;

    if (isMoving) return weapon.moveInaccuracy;
    if (player.isCrouching) return weapon.crouchInaccuracy;
    if (player.isWalking) return weapon.standInaccuracy * 0.6;
    return weapon.standInaccuracy;
  }

  private lagCompensatedRaycast(
    shooter: PlayerState,
    dir: Vec2,
    weapon: typeof WEAPON_STATS[WeaponId],
    currentPlayers: Map<string, PlayerState>,
    snapshots: SnapshotEntry[],
    barriersUp = false,
  ): { playerHit: { playerId: string; isHeadshot: boolean } | null; hitPos: Vec2 } {
    const origin = shooter.position;
    const targetTime = Date.now() - (shooter.ping || 50);
    const snapshot = snapshots.find(s => s.timestamp >= targetTime) ?? snapshots[snapshots.length - 1];

    let closestPlayer: { playerId: string; isHeadshot: boolean; dist: number } | null = null;

    for (const [id, player] of currentPlayers) {
      if (id === shooter.id || player.team === shooter.team || player.status !== 'alive') continue;

      const snapPos = snapshot?.players.get(id)?.position ?? player.position;
      const bodyHit = this.rayCircleIntersect(origin, dir, snapPos, GAME_CONSTANTS.PLAYER_RADIUS);
      const headOffset: Vec2 = { x: snapPos.x, y: snapPos.y - 12 };
      const headHit = this.rayCircleIntersect(origin, dir, headOffset, GAME_CONSTANTS.HEAD_RADIUS);

      const isHead = headHit !== null && (bodyHit === null || headHit < bodyHit);
      const dist = headHit ?? bodyHit;

      if (dist !== null && dist <= weapon.range) {
        if (!closestPlayer || dist < closestPlayer.dist) {
          closestPlayer = { playerId: id, isHeadshot: isHead, dist };
        }
      }
    }

    // Check walls (and optionally barriers)
    const wallCheck = this.physics.raycast(origin, dir, weapon.range, barriersUp);

    // Wall blocks shot if closer than player
    if (wallCheck.hit) {
      if (!closestPlayer || wallCheck.dist < closestPlayer.dist) {
        return { playerHit: null, hitPos: wallCheck.point };
      }
    }

    if (closestPlayer) {
      const hitPos = {
        x: origin.x + dir.x * closestPlayer.dist,
        y: origin.y + dir.y * closestPlayer.dist,
      };
      return { playerHit: closestPlayer, hitPos };
    }

    // Miss — max range
    return {
      playerHit: null,
      hitPos: {
        x: origin.x + dir.x * weapon.range,
        y: origin.y + dir.y * weapon.range,
      },
    };
  }

  // ─── Ray-circle intersection ──────────────
  private rayCircleIntersect(origin: Vec2, dir: Vec2, center: Vec2, radius: number): number | null {
    const oc = { x: origin.x - center.x, y: origin.y - center.y };
    const b = 2 * (oc.x * dir.x + oc.y * dir.y);
    const c = oc.x * oc.x + oc.y * oc.y - radius * radius;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / 2;
    return t >= 0 ? t : null;
  }
}
