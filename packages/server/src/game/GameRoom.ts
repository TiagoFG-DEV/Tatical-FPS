import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type {
  LobbyState, PlayerState, SpikeState, RoundState, GameSnapshot,
  PlayerInput, WeaponId, ArmorType, KillEvent, EconomyUpdate,
  ServerToClientEvents, ClientToServerEvents, Vec2, Team,
} from '@tactical-fps/shared';
import {
  GAME_CONSTANTS, WEAPON_STATS, ARMOR_STATS, MAPS,
} from '@tactical-fps/shared';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { ShootingSystem } from './systems/ShootingSystem';
import { EconomySystem } from './systems/EconomySystem';
import { MatchSystem } from './systems/MatchSystem';
import { VisibilitySystem } from './systems/VisibilitySystem';
import { AntiCheatSystem } from './systems/AntiCheatSystem';

// Snapshot history entry for lag compensation
interface SnapshotEntry {
  tick: number;
  timestamp: number;
  players: Map<string, { position: Vec2; angle: number }>;
}

// Per-player input buffer
interface InputEntry {
  input: PlayerInput;
  receivedAt: number;
}

export class GameRoom {
  readonly code: string;
  private io: Server<ClientToServerEvents, ServerToClientEvents>;
  private lobby: LobbyState;

  // ECS-style state
  private players = new Map<string, PlayerState>();
  private spike: SpikeState;
  private round: RoundState;
  private mapId: string;

  // Systems
  private physics: PhysicsSystem;
  private shooting: ShootingSystem;
  private economy: EconomySystem;
  private match: MatchSystem;
  private visibility: VisibilitySystem;
  private anticheat: AntiCheatSystem;

  // Network
  private inputBuffers = new Map<string, InputEntry[]>();
  private snapshotHistory: SnapshotEntry[] = [];
  private tick = 0;
  private lastTickTime = 0;
  private gameLoopTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private pingMap = new Map<string, number>();
  private tpCooldowns = new Map<string, number>();
  private spikeCooldowns = new Map<string, number>(); // 2s cooldown for pickup/drop nuke
  private knifeVelocities = new Map<string, { x: number; y: number }>(); // ice-skating persistence
  private isPlanting = new Set<string>(); // players currently holding Q to plant/defuse
  private initialPlayersCount = { attackers: 0, defenders: 0 };

  // Timing constants
  private readonly TICK_MS = 1000 / GAME_CONSTANTS.TICK_RATE;
  private readonly SNAPSHOT_MS = 1000 / GAME_CONSTANTS.SNAPSHOT_RATE;

  constructor(
    code: string,
    lobby: LobbyState,
    io: Server<ClientToServerEvents, ServerToClientEvents>,
  ) {
    this.code = code;
    this.io = io;
    this.lobby = lobby;
    this.mapId = lobby.mapId;

    const map = MAPS[lobby.mapId];
    this.physics = new PhysicsSystem(map);
    this.shooting = new ShootingSystem(map);
    this.visibility = new VisibilitySystem(map);
    this.economy = new EconomySystem();
    this.match = new MatchSystem();
    this.anticheat = new AntiCheatSystem();

    this.spike = this.createInitialSpike();
    this.round = this.match.createInitialRound();

    // Initialize players from lobby
    let atk = 0; let def = 0;
    for (const lp of lobby.players) {
      if (lp.team === 'attackers') atk++;
      else if (lp.team === 'defenders') def++;
      this.players.set(lp.id, this.createPlayer(lp.id, lp.name, lp.team));
      this.inputBuffers.set(lp.id, []);
    }
    this.initialPlayersCount = { attackers: atk, defenders: def };
  }

  // ─── Lifecycle ────────────────────────────
  start(): void {
    this.beginBuyPhase();

    // 128-tick game loop
    this.gameLoopTimer = setInterval(() => this.tick128(), this.TICK_MS);

    // 30/sec snapshot broadcast
    this.snapshotTimer = setInterval(() => this.broadcastSnapshot(), this.SNAPSHOT_MS);
  }

  destroy(): void {
    if (this.gameLoopTimer) clearInterval(this.gameLoopTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
  }

  // ─── 128-tick loop ───────────────────────
  private tick128(): void {
    const now = Date.now();
    const dt = this.TICK_MS / 1000; // seconds
    this.tick++;

    // Process one input per player
    for (const [playerId, buffer] of this.inputBuffers) {
      const player = this.players.get(playerId);
      if (!player || player.status !== 'alive') continue;

      const entry = buffer.shift();
      if (!entry) continue;

      // Anti-cheat: validate before applying
      if (!this.anticheat.validateInput(player, entry.input, entry.receivedAt)) continue;

      this.applyInput(player, entry.input, dt);
    }

    // Store snapshot for lag compensation
    this.storeSnapshot(now);

    // Match state machine
    this.match.tick(this.round, now, this.players, this.spike, this.economy, this.io, this.code, (event) => {
      this.handleMatchEvent(event);
    });

    // Spike updates (beep audio, explode check)
    this.updateSpike(now);

    this.lastTickTime = now;
  }

  // ─── Input Processing ────────────────────
  handleInput(socketId: string, input: PlayerInput): void {
    const buffer = this.inputBuffers.get(socketId);
    if (!buffer) return;

    // Cap buffer to prevent overflow attacks
    if (buffer.length > 10) buffer.shift();
    buffer.push({ input, receivedAt: Date.now() });
  }

  private applyInput(player: PlayerState, input: PlayerInput, dt: number): void {
    if (this.round.phase === 'round_end' || this.round.phase === 'match_end' || this.round.phase === 'halftime') return;

    // Update player state flags
    player.isCrouching = input.crouching;
    player.isWalking = input.walking;
    player.angle = input.angle;

    const isKnife = player.activeWeapon === 'knife';

    // Base speed (knife is x1.8 faster)
    const baseSpeed = player.isCrouching ? GAME_CONSTANTS.PLAYER_CROUCH_SPEED
                    : player.isWalking ? GAME_CONSTANTS.PLAYER_SPEED
                    : GAME_CONSTANTS.PLAYER_RUN_SPEED;
    const speed = isKnife ? baseSpeed * 1.8 : baseSpeed;

    const desiredVel = { x: input.moveX * speed, y: input.moveY * speed };

    // Normalize diagonal
    if (input.moveX !== 0 && input.moveY !== 0) {
      const inv = 1 / Math.SQRT2;
      desiredVel.x *= inv;
      desiredVel.y *= inv;
    }

    // Knife: apply ice-skating friction (lerp toward desired)
    let vel = desiredVel;
    if (isKnife) {
      const prev = this.knifeVelocities.get(player.id) ?? { x: 0, y: 0 };
      vel = this.physics.applyKnifeFriction(prev, desiredVel, dt);
      this.knifeVelocities.set(player.id, vel);
    } else {
      this.knifeVelocities.delete(player.id);
    }

    player.velocity = vel;

    // Lock movement completely while planting or defusing
    if (this.isPlanting.has(player.id)) {
      player.velocity = { x: 0, y: 0 };
    }

    // Movement with barrier check
    const isBuyPhase = this.round.phase === 'buy';
    const newPos = this.physics.move(player.position, player.velocity, dt, GAME_CONSTANTS.PLAYER_RADIUS, isBuyPhase, player.team);
    player.position = newPos;

    // Teleporters
    this.handleTeleporters(player);

    // Interaction (E key) - Pickup / Drop Nuke
    if (input.pickupDrop && player.status === 'alive') {
      this.handlePickupDrop(player);
    }

    // Interaction (Q key) - Plant / Defuse (resets progress when not held)
    if (input.plantDefuse) {
      this.handlePlantDefuse(player);
    } else {
      // Q released — cancel any in-progress plant/defuse
      if (this.isPlanting.has(player.id)) {
        this.isPlanting.delete(player.id);
        if (this.spike.status !== 'planted') {
          this.spike.plantProgress = 0;
        }
        this.spike.defuseProgress = 0;
        this.spike.defuserId = null;
      }
    }

    // Footstep audio is now handled entirely client-side using GameRenderer + SoundSystem
    // to avoid network jitter. We don't emit 'footstep_run' from the server anymore.

    // Weapon switch — supports 4 slots: melee, secondary, primary, (nuke if attacker+hasSpike)
    if (input.switchWeapon) {
      const originalWeapon = player.activeWeapon;
      if (input.switchWeapon === 'primary') {
        const primary = player.weapons.find(w => WEAPON_STATS[w as WeaponId].slot === 'primary');
        if (primary) player.activeWeapon = primary;
      } else if (input.switchWeapon === 'secondary') {
        const secondary = player.weapons.find(w => WEAPON_STATS[w as WeaponId].slot === 'secondary');
        if (secondary) player.activeWeapon = secondary;
      } else if (input.switchWeapon === 'melee') {
        player.activeWeapon = 'knife';
      } else if (input.switchWeapon === 'nuke') {
        // Slot 4: only if attacker carrying the nuke
        if (player.hasSpike && player.team === 'attackers') {
          player.activeWeapon = 'knife'; // visual slot only; nuke is not a weapon
        }
      } else if (input.switchWeapon === 'next' || input.switchWeapon === 'prev') {
        // Build slot list dynamically
        const validWeapons: WeaponId[] = [];
        const primary = player.weapons.find(w => WEAPON_STATS[w as WeaponId].slot === 'primary');
        const secondary = player.weapons.find(w => WEAPON_STATS[w as WeaponId].slot === 'secondary');
        if (primary) validWeapons.push(primary);
        if (secondary) validWeapons.push(secondary);
        validWeapons.push('knife');
        const currIdx = validWeapons.indexOf(player.activeWeapon);
        if (currIdx !== -1) {
          const delta = input.switchWeapon === 'next' ? 1 : -1;
          player.activeWeapon = validWeapons[(currIdx + delta + validWeapons.length) % validWeapons.length];
        }
      } else if (player.weapons.includes(input.switchWeapon as WeaponId)) {
        player.activeWeapon = input.switchWeapon as WeaponId;
      }
      // If weapon changed, cancel any active reload
      if (player.activeWeapon !== originalWeapon) {
        player.isReloading = false;
      }
    }

    // Shooting
    if (input.shooting && player.status === 'alive') {
      this.shooting.shoot(player, this.tick, this.players, this.snapshotHistory, (event) => {
        if ('type' in event && (event as any).type === 'bullet_hit') {
          (this.io.to(this.code) as any).emit('bullet_hit', event);
        } else if ('type' in event) {
          this.io.to(this.code).emit('audio_event', event as any);
        } else {
          this.handleHit(event);
        }
      }, this.round.barriersUp);
    } else {
      this.shooting.stopShooting(player.id);
    }

    // Reload
    if (input.reloading && player.status === 'alive') {
      this.shooting.startReload(player, (event) => {
        if ('type' in event) {
          this.io.to(this.code).emit('audio_event', event as any);
        }
      });
    }

    // Drop weapon (G key) — drops currently active weapon except knife
    if (input.dropWeapon) {
      this.dropWeapon(player);
    }

    // Q key: if planted + defender near spike → defuse; else if attacker in zone → plant
    // Weapon drop via Q is handled in dropWeapon when active is not knife and not in plant zone

    // Send server correction for reconciliation
    this.io.to(player.id).emit('server_correction', {
      seq: input.seq,
      position: player.position,
      velocity: player.velocity,
      timestamp: Date.now(),
    });
  }

  // ─── Combat ──────────────────────────────
  private handleHit(event: {
    attackerId: string; targetId: string; damage: number; isHeadshot: boolean; weaponId: WeaponId;
  }): void {
    const target = this.players.get(event.targetId);
    const attacker = this.players.get(event.attackerId);
    if (!target || !attacker || target.status !== 'alive') return;

    // Apply armor reduction to body shots
    let dmg = event.damage;
    if (!event.isHeadshot && target.armor > 0 && target.armorType !== 'none') {
      const reduction = ARMOR_STATS[target.armorType].damageReduction;
      dmg = Math.round(dmg * (1 - reduction));
      target.armor = Math.max(0, target.armor - Math.round(event.damage * 0.5));
    }

    target.health = Math.max(0, target.health - dmg);

    // Broadcast damage event
    this.io.to(this.code).emit('damage_event', {
      targetId: target.id,
      damage: dmg,
      isHeadshot: event.isHeadshot,
      remainingHealth: target.health,
      attackerId: event.attackerId,
    });

    if (target.health <= 0) {
      this.handleDeath(target, attacker, event.weaponId, event.isHeadshot);
    }
  }

  private handleDeath(
    victim: PlayerState, killer: PlayerState,
    weaponId: WeaponId, isHeadshot: boolean,
  ): void {
    victim.status = 'dead';
    victim.health = 0;

    // Kill credit
    killer.kills++;
    victim.deaths++;
    const killBonus = WEAPON_STATS[weaponId].killBonus;
    killer.credits = Math.min(9000, killer.credits + killBonus);

    // Spike drop
    if (victim.hasSpike) {
      victim.hasSpike = false;
      this.spike.carrierId = null;
      this.spike.status = 'dropped';
      this.spike.position = { ...victim.position };
      this.io.to(this.code).emit('spike_event', this.spike);
    }

    const killEvent: KillEvent = {
      id: uuidv4(),
      killerId: killer.id,
      killerName: killer.name,
      victimId: victim.id,
      victimName: victim.name,
      weaponId,
      isHeadshot,
      timestamp: Date.now(),
    };
    this.io.to(this.code).emit('kill_event', killEvent);

    this.match.checkRoundEnd(this.round, this.players, this.spike);
  }

  // ─── Interaction ───────────────────────────
  private handlePickupDrop(player: PlayerState): void {
    const now = Date.now();
    // 2-second cooldown between nuke pickup/drop actions
    const cooldownEnd = this.spikeCooldowns.get(player.id) ?? 0;
    if (now < cooldownEnd) return;

    if (player.hasSpike) {
      // Drop nuke
      player.hasSpike = false;
      this.spike.status = 'dropped';
      this.spike.carrierId = null;
      this.spike.position = { ...player.position };
      this.spikeCooldowns.set(player.id, now + 2000);
      this.io.to(this.code).emit('spike_event', this.spike);
    } else {
      // Try pickup — only attackers can pick up the nuke
      if (this.spike.status === 'dropped' && player.team === 'attackers') {
        const dist = this.dist(player.position, this.spike.position);
        if (dist < GAME_CONSTANTS.SPIKE_PICKUP_RANGE) {
          player.hasSpike = true;
          this.spike.status = 'carried';
          this.spike.carrierId = player.id;
          this.spikeCooldowns.set(player.id, now + 2000);
          this.io.to(this.code).emit('spike_event', this.spike);
        }
      }
    }
  }

  private handlePlantDefuse(player: PlayerState): void {
    if (player.status !== 'alive') return;

    // Plant
    if (player.hasSpike && player.team === 'attackers' && (this.round.phase === 'combat' || this.round.phase === 'post_plant')) {
      const map = MAPS[this.lobby.mapId];
      const inZone = map.zones.some(z =>
        (z.type === 'site_a' || z.type === 'site_b' || z.type === 'site_c') &&
        this.physics.isPointInZone(player.position, z)
      );

      if (inZone) {
        // Lock movement while planting
        this.isPlanting.add(player.id);
        player.velocity = { x: 0, y: 0 };

        this.spike.plantProgress += (1 / (GAME_CONSTANTS.SPIKE_PLANT_TIME / this.TICK_MS));
        if (this.spike.plantProgress >= 1) {
          this.isPlanting.delete(player.id);
          this.spike.status = 'planted';
          this.spike.position = { ...player.position };
          this.spike.plantedBy = player.id;
          this.spike.plantTime = Date.now();
          this.spike.explodeTime = Date.now() + GAME_CONSTANTS.SPIKE_EXPLODE_COUNTDOWN;
          player.hasSpike = false;
          this.round.phase = 'post_plant';
          this.round.phaseEndTime = this.spike.explodeTime;

          this.io.to(this.code).emit('spike_event', this.spike);
          this.io.to(this.code).emit('audio_event', {
            type: 'spike_plant_complete', position: this.spike.position, range: 99999,
          });
        }
      } else {
        // Left the zone mid-plant — reset progress
        if (this.isPlanting.has(player.id)) {
          this.isPlanting.delete(player.id);
          this.spike.plantProgress = 0;
        }
      }
    }

    // Defuse — only when defender is physically touching the nuke
    if (this.spike.status === 'planted' && player.team === 'defenders') {
      const dist = this.dist(player.position, this.spike.position);
      if (dist <= GAME_CONSTANTS.SPIKE_PICKUP_RANGE) {
        // Lock movement while defusing
        this.isPlanting.add(player.id);
        player.velocity = { x: 0, y: 0 };

        this.spike.defuserId = player.id;
        this.spike.defuseProgress += (1 / (GAME_CONSTANTS.SPIKE_DEFUSE_TIME / this.TICK_MS));

        if (!this.spike.halfDefused && this.spike.defuseProgress >= 0.5) {
          this.spike.halfDefused = true;
          this.io.to(this.code).emit('audio_event', {
            type: 'defuse_start', position: this.spike.position, range: 99999,
          });
        }

        if (this.spike.defuseProgress >= 1) {
          this.isPlanting.delete(player.id);
          this.spike.status = 'defused';
          this.io.to(this.code).emit('spike_event', this.spike);
          this.match.endRound(this.round, 'defenders', 'spike_defused', this.players, this.economy, this.io, this.code, (e) => this.handleMatchEvent(e));
        }
      } else {
        // Walked away from nuke mid-defuse — reset
        if (this.isPlanting.has(player.id)) {
          this.isPlanting.delete(player.id);
          this.spike.defuseProgress = 0;
          this.spike.defuserId = null;
        }
      }
    }
  }

  private updateSpike(now: number): void {
    if (this.spike.status !== 'planted') return;
    if (!this.spike.explodeTime) return;

    const remaining = this.spike.explodeTime - now;
    if (remaining <= 0) {
      this.spike.status = 'exploded';
      
      // Calculate 1/6th map size radius (Omega is 4800, so diameter 800 -> radius 400)
      const explosionRadius = 400;
      
      // Instantly kill anyone in the blast radius
      for (const [id, p] of this.players) {
        if (p.status === 'alive' && this.dist(p.position, this.spike.position) <= explosionRadius) {
           p.status = 'dead';
           p.health = 0;
           this.io.to(this.code).emit('kill_event', {
             id: uuidv4(),
             killerId: p.id,
             killerName: 'Nuke',
             victimId: p.id,
             victimName: p.name,
             weaponId: 'knife', // Dummy weapon ID for explosion death
             isHeadshot: false,
             timestamp: Date.now(),
           });
        }
      }

      this.io.to(this.code).emit('spike_event', this.spike);
      this.io.to(this.code).emit('audio_event', {
        type: 'spike_explode', position: this.spike.position, range: 99999,
      });
      this.match.endRound(this.round, 'attackers', 'spike_exploded', this.players, this.economy, this.io, this.code, (e) => this.handleMatchEvent(e));
    }

    // Accelerating beep is now handled client-side using SoundSystem 
    // to guarantee perfect rhythm regardless of ping.
  }

  // ─── Snapshot ────────────────────────────
  private broadcastSnapshot(): void {
    // Build visibility-filtered snapshots per player
    const playerList = Array.from(this.players.values());

    for (const [socketId, viewer] of this.players) {
      const visibleIds = this.visibility.getVisiblePlayers(viewer, playerList);

      const snapshot: GameSnapshot = {
        tick: this.tick,
        timestamp: Date.now(),
        players: playerList.map(p => {
          if (p.id === socketId || p.team === viewer.team || visibleIds.has(p.id)) {
            return p;
          }
          // Ghost state: position hidden, only alive status
          return { ...p, position: { x: -9999, y: -9999 } };
        }),
        bullets: [],
        spike: this.spike,
        round: this.round,
        mapId: this.mapId as any,
      };

      this.io.to(socketId).emit('game_snapshot', snapshot);
    }
  }

  private storeSnapshot(now: number): void {
    const entry: SnapshotEntry = {
      tick: this.tick,
      timestamp: now,
      players: new Map(),
    };
    for (const [id, p] of this.players) {
      entry.players.set(id, { position: { ...p.position }, angle: p.angle });
    }
    this.snapshotHistory.push(entry);

    // Keep only last 1 second
    const cutoff = now - GAME_CONSTANTS.LAG_COMPENSATION_BUFFER;
    while (this.snapshotHistory.length > 0 && this.snapshotHistory[0].timestamp < cutoff) {
      this.snapshotHistory.shift();
    }
  }

  // ─── Round Management ────────────────────
  private beginBuyPhase(): void {
    this.round.phase = 'buy';
    this.round.phaseEndTime = Date.now() + GAME_CONSTANTS.BUY_PHASE_DURATION;
    this.round.roundWinner = null;
    this.round.roundEndReason = null;
    this.round.barriersUp = true;

    const map = MAPS[this.mapId];
    let atkIdx = 0, defIdx = 0;
    const isFirstRound = this.round.round === 1;

    for (const [, player] of this.players) {
      player.status = 'alive';
      // Only restore BASE health — armor and ammo persist from last round
      player.health = 100;
      player.isReloading = false;
      player.hasSpike = false;

      // Reset position to spawn
      const spawns = player.team === 'attackers' ? map.spawnPoints.attackers : map.spawnPoints.defenders;
      const idx = player.team === 'attackers' ? atkIdx++ : defIdx++;
      player.position = { ...spawns[idx % spawns.length] };
      player.velocity = { x: 0, y: 0 };

      if (isFirstRound) {
        // First round: full reset with default loadout
        player.armor = 0;
        player.armorType = 'none';
        player.hasHelmet = false;
        player.weapons = ['classic', 'knife'];
        player.activeWeapon = 'classic';
        player.ammo = this.createDefaultAmmo();
        player.reserveAmmo = this.createDefaultReserve();
      } else {
        // Subsequent rounds: keep weapons/armor/ammo, just ensure classic if broke
        if (!player.weapons.includes('knife')) player.weapons.push('knife');
        this.economy.ensureClassic(player);
        // Switch to best available weapon
        const primary = player.weapons.find(w => w !== 'knife' && WEAPON_STATS[w as WeaponId].slot === 'primary');
        const secondary = player.weapons.find(w => w !== 'knife' && WEAPON_STATS[w as WeaponId].slot === 'secondary');
        player.activeWeapon = primary ?? secondary ?? 'knife';
      }

      // Clear nuke cooldown
      this.spikeCooldowns.delete(player.id);
    }

    // Nuke starts DROPPED at the attacker spawn area (center of spawn points)
    // Attackers must walk up to it and press E to pick it up
    const atkSpawns = map.spawnPoints.attackers;
    const spawnCenterX = atkSpawns.reduce((s, p) => s + p.x, 0) / atkSpawns.length;
    const spawnCenterY = atkSpawns.reduce((s, p) => s + p.y, 0) / atkSpawns.length;
    this.spike = {
      ...this.createInitialSpike(),
      status: 'dropped',
      position: { x: spawnCenterX, y: spawnCenterY },
    };

    // Clear AntiCheat position baselines — players just teleported to spawn
    for (const [id] of this.players) {
      this.anticheat.resetPlayer(id);
    }

    this.io.to(this.code).emit('round_start', this.round);
  }

  handleBuy(socketId: string, item: WeaponId | ArmorType): void {
    if (this.round.phase !== 'buy') return;

    const player = this.players.get(socketId);
    if (!player) return;

    // removed inBuyZone check, players can buy anywhere during buy phase

    const alreadyOwned = (item === 'light' || item === 'heavy')
      ? player.armorType === item
      : player.weapons.includes(item as WeaponId);

    if (alreadyOwned) {
      const result = this.economy.sellItem(player, item);
      this.io.to(socketId).emit('buy_result', result);
    } else {
      const result = this.economy.buy(player, item);
      this.io.to(socketId).emit('buy_result', result);
    }
  }

  // ─── Misc ─────────────────────────────────
  private handleMatchEvent(event: string): void {
    if (event === 'round_end_buy') {
      this.beginBuyPhase();
    } else if (event === 'match_end') {
      // Return to lobby state
      this.lobby.gameStarting = false;
      this.lobby.countdownSeconds = 0;
      this.destroy(); // Stop game loop and snapshots
      this.io.to(this.code).emit('lobby_state', this.lobby);
    }
  }

  private handleInteraction(player: PlayerState): void {
    // 1. Pickup/Drop Nuke
    if (player.hasSpike) {
      // Drop
      player.hasSpike = false;
      this.spike.status = 'dropped';
      this.spike.carrierId = null;
      this.spike.position = { ...player.position };
      this.io.to(this.code).emit('spike_event', this.spike);
    } else {
      // Try pickup
      if (this.spike.status === 'dropped') {
        const dist = Math.hypot(player.position.x - this.spike.position.x, player.position.y - this.spike.position.y);
        if (dist < GAME_CONSTANTS.SPIKE_PICKUP_RANGE) {
          player.hasSpike = true;
          this.spike.status = 'carried';
          this.spike.carrierId = player.id;
          this.io.to(this.code).emit('spike_event', this.spike);
        }
      }
    }
  }

  private dropWeapon(player: PlayerState): void {
    // Knife is the ONLY item that can never be dropped
    if (player.activeWeapon === 'knife') return;

    const dropped = player.activeWeapon;
    player.weapons = player.weapons.filter(w => w !== dropped);

    // Switch to next best available weapon
    const primary = player.weapons.find(w => w !== 'knife' && WEAPON_STATS[w as WeaponId].slot === 'primary');
    const secondary = player.weapons.find(w => w !== 'knife' && WEAPON_STATS[w as WeaponId].slot === 'secondary');
    player.activeWeapon = primary ?? secondary ?? 'knife';

    // Ensure classic auto-restore
    this.economy.ensureClassic(player);
  }

  // Team assignment is handled exclusively by LobbyManager before match start

  updatePlayerPing(socketId: string, ping: number): void {
    this.pingMap.set(socketId, ping);
    const player = this.players.get(socketId);
    if (player) player.ping = ping;
  }

  handleDisconnect(socketId: string): void {
    const player = this.players.get(socketId);
    if (!player) return;

    // Broadcast system chat message about disconnect
    const msg = {
      id: uuidv4(),
      senderId: 'system',
      senderName: 'SYSTEM',
      team: 'all' as const,
      message: `${player.name} has disconnected.`,
      timestamp: Date.now(),
    };
    this.io.to(this.code).emit('lobby_chat', msg);

    // Drop spike if carrying
    if (player.hasSpike) {
      player.hasSpike = false;
      this.spike.status = 'dropped';
      this.spike.carrierId = null;
      this.spike.position = { ...player.position };
      this.io.to(this.code).emit('spike_event', this.spike);
    }

    // Completely remove player
    this.players.delete(socketId);
    this.inputBuffers.delete(socketId);

    // If both teams originally had > 0 players, and one team is now empty, end the match
    const originalHasBoth = this.initialPlayersCount.attackers > 0 && this.initialPlayersCount.defenders > 0;
    if (originalHasBoth && this.round.phase !== 'match_end') {
      const remainingOnTeam = Array.from(this.players.values()).filter(p => p.team === player.team).length;
      if (remainingOnTeam === 0) {
        const winningTeam = player.team === 'attackers' ? 'defenders' : 'attackers';
        // Force score to 1 less than win threshold so endRound ticks it to win
        if (winningTeam === 'attackers') {
          this.round.attackerScore = GAME_CONSTANTS.ROUNDS_TO_WIN - 1;
        } else {
          this.round.defenderScore = GAME_CONSTANTS.ROUNDS_TO_WIN - 1;
        }
        const reason = player.team === 'attackers' ? 'attackers_eliminated' : 'defenders_eliminated';
        this.match.endRound(this.round, winningTeam, reason, this.players, this.economy, this.io, this.code, (e) => this.handleMatchEvent(e));
      }
    }
  }

  // ─── Factories ────────────────────────────
  private createPlayer(id: string, name: string, team: Team): PlayerState {
    return {
      id, name, team,
      status: 'alive',
      position: { x: 200, y: 800 },
      angle: 0,
      velocity: { x: 0, y: 0 },
      health: 100,
      armor: 0,
      armorType: 'none',
      hasHelmet: false,
      weapons: ['classic', 'knife'],
      activeWeapon: 'classic',
      ammo: this.createDefaultAmmo(),
      reserveAmmo: this.createDefaultReserve(),
      credits: GAME_CONSTANTS.STARTING_CREDITS,
      isReloading: false,
      isCrouching: false,
      isWalking: false,
      hasSpike: false,
      kills: 0, deaths: 0, assists: 0,
      ping: 0,
    };
  }

  private createInitialSpike(): SpikeState {
    return {
      status: 'dropped',
      position: { x: 0, y: 0 },
      carrierId: null,
      plantedBy: null,
      plantProgress: 0,
      defuseProgress: 0,
      defuserId: null,
      plantTime: null,
      explodeTime: null,
      halfDefused: false,
    };
  }

  private createDefaultAmmo(): Record<WeaponId, number> {
    return Object.fromEntries(
      Object.keys(WEAPON_STATS).map(k => [k, WEAPON_STATS[k as WeaponId].magSize])
    ) as Record<WeaponId, number>;
  }

  private createDefaultReserve(): Record<WeaponId, number> {
    return Object.fromEntries(
      Object.keys(WEAPON_STATS).map(k => [k, WEAPON_STATS[k as WeaponId].reserveAmmo])
    ) as Record<WeaponId, number>;
  }

  private handleTeleporters(player: PlayerState): void {
    const now = Date.now();
    const cd = this.tpCooldowns.get(player.id) ?? 0;
    if (now < cd) return;

    const map = MAPS[this.mapId];
    if (!map) return;

    for (const zone of map.zones) {
      if (zone.type === 'teleporter' && zone.id.startsWith('tp_')) {
        if (this.physics.isPointInZone(player.position, zone)) {
          // Destination encoded in zone metadata; skip if no destination defined
          this.tpCooldowns.set(player.id, now + 2000);
          this.io.to(this.code).emit('audio_event', { type: 'teleport', position: player.position, range: 500 });
        }
      }
    }
  }

  // ─── Geometry Helpers ─────────────────────
  private dist(a: Vec2, b: Vec2): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > point.y) !== (yj > point.y) &&
        point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }
}
