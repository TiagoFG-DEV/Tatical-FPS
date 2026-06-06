// ============================================================
// TACTICAL FPS — Shared Types & Constants
// Single source of truth for client + server
// Divergence from Valorant: "Spike" → "Nuclear Explosive (NUKE)"
// ============================================================

// Re-export maps so consumers can use @tactical-fps/shared directly
export { MAPS, MAP_OMEGA } from './maps';

// ─────────────────────────────────────────
// VECTORS
// ─────────────────────────────────────────
export interface Vec2 {
  x: number;
  y: number;
}

// ─────────────────────────────────────────
// TEAMS
// ─────────────────────────────────────────
export type Team = 'attackers' | 'defenders' | 'spectator';

// ─────────────────────────────────────────
// WEAPONS (trimmed for tactical focus)
// ─────────────────────────────────────────
export type WeaponId =
  | 'knife'
  | 'classic'
  | 'sheriff'
  | 'ghost'
  | 'spectre'
  | 'phantom'
  | 'vandal'
  | 'operator'
  | 'judge'
  | 'ares'
  | 'odin';

export type WeaponSlot = 'primary' | 'secondary' | 'melee';

export interface WeaponStats {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  cost: number;
  damage: {
    head: number;
    body: number;
    legs: number;
  };
  fireRate: number;      // shots per second
  reloadTime: number;    // ms
  magSize: number;
  reserveAmmo: number;
  range: number;         // pixels effective range
  armor_penetration: number; // 0-1
  firstShotAccuracy: number; // 0-1 (1 = perfect)
  moveInaccuracy: number;    // cone degrees while moving
  standInaccuracy: number;   // cone degrees while standing
  crouchInaccuracy: number;  // cone degrees while crouching
  recoilPattern: Vec2[];     // spray pattern offsets
  killBonus: number;
  automatic: boolean;
  adsZoom?: number;
  scopeTime?: number;     // ms delay to focus (Operator)
  screenShake?: number;   // Intensity of shake
}

// ─────────────────────────────────────────
// ARMOR
// ─────────────────────────────────────────
export type ArmorType = 'none' | 'light' | 'heavy';

export interface ArmorStats {
  type: ArmorType;
  cost: number;
  damageReduction: number; // 0-1
  hasHelmet: boolean;
}

// ─────────────────────────────────────────
// PLAYER STATE
// ─────────────────────────────────────────
export type PlayerStatus = 'alive' | 'dead' | 'spectating';

export interface PlayerState {
  id: string;
  name: string;
  team: Team;
  status: PlayerStatus;
  position: Vec2;
  angle: number;         // aim direction in radians
  velocity: Vec2;
  health: number;
  armor: number;
  armorType: ArmorType;
  hasHelmet: boolean;
  weapons: WeaponId[];
  activeWeapon: WeaponId;
  ammo: Record<WeaponId, number>;
  reserveAmmo: Record<WeaponId, number>;
  credits: number;
  isReloading: boolean;
  isCrouching: boolean;
  isWalking: boolean;
  isDisconnected?: boolean;
  hasSpike: boolean;      // hasSpike = hasNuke in game narrative
  kills: number;
  deaths: number;
  assists: number;
  ping: number;
}

// ─────────────────────────────────────────
// NUKE (Nuclear Explosive — replaces Spike)
// ─────────────────────────────────────────
export type SpikeStatus = 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';

export interface SpikeState {
  status: SpikeStatus;
  position: Vec2;
  carrierId: string | null;
  plantedBy: string | null;
  plantProgress: number;   // 0-1
  defuseProgress: number;  // 0-1
  defuserId: string | null;
  plantTime: number | null;    // server timestamp
  explodeTime: number | null;  // server timestamp
  halfDefused: boolean;
}

// ─────────────────────────────────────────
// BULLET
// ─────────────────────────────────────────
export interface BulletState {
  id: string;
  ownerId: string;
  position: Vec2;
  direction: Vec2;
  weaponId: WeaponId;
  speed: number;
  damage: number;
  createdAt: number;
}

// ─────────────────────────────────────────
// ROUND / MATCH
// ─────────────────────────────────────────
export type RoundPhase =
  | 'waiting'
  | 'buy'
  | 'combat'
  | 'post_plant'
  | 'round_end'
  | 'halftime'
  | 'overtime'
  | 'match_end';

export type RoundWinner = 'attackers' | 'defenders' | null;
export type RoundEndReason =
  | 'spike_exploded'
  | 'spike_defused'
  | 'attackers_eliminated'
  | 'defenders_eliminated'
  | 'time_expired'
  | null;

export interface RoundState {
  round: number;
  phase: RoundPhase;
  phaseEndTime: number;    // server timestamp ms
  attackerScore: number;
  defenderScore: number;
  roundWinner: RoundWinner;
  roundEndReason: RoundEndReason;
  barriersUp: boolean; // True during buy phase
  isOvertime: boolean;
  overtimeRound: number;
}

// ─────────────────────────────────────────
// GAME SNAPSHOT (server → client, ~30/sec)
// ─────────────────────────────────────────
export interface GameSnapshot {
  tick: number;
  timestamp: number;
  players: PlayerState[];
  bullets: BulletState[];
  spike: SpikeState;
  round: RoundState;
  mapId: MapId;
}

// ─────────────────────────────────────────
// CLIENT INPUT (client → server, every frame)
// ─────────────────────────────────────────
export interface PlayerInput {
  seq: number;           // sequence number for reconciliation
  timestamp: number;
  moveX: number;         // -1, 0, 1
  moveY: number;         // -1, 0, 1
  angle: number;         // aim angle in radians
  shooting: boolean;
  reloading: boolean;
  crouching: boolean;
  walking: boolean;
  jumping: boolean;
  plantDefuse: boolean; // Q key
  pickupDrop: boolean;  // E key
  dropWeapon: boolean;
  switchWeapon: string | null;
}

// ─────────────────────────────────────────
// KILL FEED EVENT
// ─────────────────────────────────────────
export interface KillEvent {
  id: string;
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weaponId: WeaponId;
  isHeadshot: boolean;
  timestamp: number;
}

// ─────────────────────────────────────────
// MAPS
// ─────────────────────────────────────────
export type MapId = 'omega' | 'hexapost';

export interface MapWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  penetrable?: boolean;
}

export interface MapZone {
  id: string;
  label: string;
  type: 'site_a' | 'site_b' | 'site_c' | 'attacker_spawn' | 'defender_spawn' | 'mid' | 'buy_zone' | 'barrier' | 'metal_zone' | 'teleporter';
  polygon: Vec2[];
  surface?: string;
}

export interface MapDefinition {
  id: MapId;
  name: string;
  width: number;
  height: number;
  walls: MapWall[];
  zones: MapZone[];
  spawnPoints: {
    attackers: Vec2[];
    defenders: Vec2[];
  };
}

// ─────────────────────────────────────────
// LOBBY / ROOM
// ─────────────────────────────────────────
export type LobbyMode = 'custom' | 'matchmaking';

export interface LobbyPlayer {
  id: string;
  name: string;
  team: Team;
  isReady: boolean;
  isHost: boolean;
  ping: number;
  sessionToken?: string;
}

export interface LobbyState {
  code: string;
  mapId: MapId;
  players: LobbyPlayer[];
  maxPlayers: number;
  gameStarting: boolean;
  countdownSeconds: number;
  mode: LobbyMode;
  isTeamMode: boolean;
  teamName?: {
    attackers: string;
    defenders: string;
  };
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  team: Team | 'all';
  message: string;
  timestamp: number;
}

// ─────────────────────────────────────────
// MATCHMAKING (Online Queue)
// ─────────────────────────────────────────
export interface MatchmakingParty {
  partyId: string;
  hostId: string;
  teamName: string;
  members: { id: string; name: string }[];
  enqueuedAt: number;
}

export type MatchmakingStatus = 'idle' | 'queuing' | 'found';

// ─────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────
export interface ServerToClientEvents {
  // Lobby
  lobby_state: (state: LobbyState) => void;
  lobby_chat: (msg: ChatMessage) => void;
  lobby_error: (error: string) => void;
  match_starting: (countdown: number) => void;
  pong: (clientTime: number) => void;

  // Matchmaking
  queue_status: (status: { position: number; estimated: number; status: MatchmakingStatus }) => void;
  match_found: (lobbyCode: string) => void;

  // Game
  game_snapshot: (snapshot: GameSnapshot) => void;
  kill_event: (event: KillEvent) => void;
  round_start: (round: RoundState) => void;
  round_end: (round: RoundState, economyUpdates: EconomyUpdate[]) => void;
  match_end: (result: MatchResult) => void;
  server_correction: (correction: ServerCorrection) => void;
  buy_result: (result: BuyResult) => void;
  damage_event: (event: DamageEvent) => void;
  spike_event: (spike: SpikeState) => void;
  audio_event: (event: AudioEvent) => void;
  bullet_hit: (event: BulletHitEvent) => void;
}

export interface ClientToServerEvents {
  // Lobby
  create_lobby: (name: string, mode?: LobbyMode, sessionToken?: string) => void;
  join_lobby: (code: string, name: string, sessionToken?: string) => void;
  leave_lobby: () => void;
  reconnect_lobby: (sessionToken: string) => void;
  set_team: (team: Team) => void;
  set_ready: (ready: boolean) => void;
  start_match: (mapId: MapId) => void;
  kick_player: (playerId: string) => void;
  move_player: (targetId: string, team: 'attackers' | 'defenders') => void; // HOST ONLY
  lobby_chat: (msg: string, team: Team | 'all') => void;
  set_team_name: (side: 'attackers' | 'defenders', name: string) => void;
  toggle_team_mode: (enabled: boolean) => void;
  set_map: (mapId: MapId) => void;

  // Matchmaking
  queue_join: (playerName: string, teamName: string, partyMembers?: string[], sessionToken?: string) => void;
  queue_leave: () => void;

  // Game
  player_input: (input: PlayerInput) => void;
  buy_item: (item: WeaponId | ArmorType) => void;
  ping: (clientTime: number) => void;
}

// ─────────────────────────────────────────
// MISC EVENT TYPES
// ─────────────────────────────────────────
export interface EconomyUpdate {
  playerId: string;
  credits: number;
  delta: number;
  reason: string;
}

export interface MatchResult {
  winner: Team;
  attackerScore: number;
  defenderScore: number;
  mvpId: string;
  players: Array<{
    id: string;
    name: string;
    kills: number;
    deaths: number;
    assists: number;
  }>;
}

export interface BulletHitEvent {
  type: 'bullet_hit';
  origin: Vec2;
  target: Vec2;
  hitType: 'player' | 'wall';
  playerId: string;
}

export interface ServerCorrection {
  seq: number;
  position: Vec2;
  velocity: Vec2;
  timestamp: number;
}

export interface BuyResult {
  success: boolean;
  error?: string;
  newCredits: number;
  item: WeaponId | ArmorType;
}

export interface DamageEvent {
  targetId: string;
  damage: number;
  isHeadshot: boolean;
  remainingHealth: number;
  attackerId: string;
}

export type AudioEventType =
  | 'gunshot'
  | 'footstep_run'
  | 'footstep_walk'
  | 'reload'
  | 'low_ammo'
  | 'spike_plant_start'
  | 'spike_plant_complete'
  | 'spike_beep'
  | 'spike_explode'
  | 'defuse_start'
  | 'defuse_complete'
  | 'round_start'
  | 'round_end_win'
  | 'round_end_lose'
  | 'teleport'
  | 'knife_swing';

export interface AudioEvent {
  type: AudioEventType;
  position: Vec2;
  range: number;
  playerId?: string;
  weaponId?: string;
  surface?: string;
}

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
export const GAME_CONSTANTS = {
  // Timing (ms)
  BUY_PHASE_DURATION: 30_000,
  ROUND_DURATION: 120_000, // 2 minutes
  SPIKE_PLANT_TIME: 2_000,
  SPIKE_DEFUSE_TIME: 2_000,
  SPIKE_EXPLODE_COUNTDOWN: 90_000, // 1:30 explosion timer
  ROUND_END_DELAY: 5_000,
  HALFTIME_DELAY: 8_000,

  // Match
  ROUNDS_TO_WIN: 13,
  MAX_ROUNDS: 24,
  OVERTIME_START: 12,

  // Economy
  STARTING_CREDITS: 800,
  WIN_BONUS: 3_000,
  LOSS_BONUS_BASE: 1_900,
  LOSS_BONUS_INCREMENT: 500,
  LOSS_BONUS_MAX: 2_900,
  SPIKE_PLANT_BONUS: 300,
  OVERTIME_CREDITS: 5_000,

  // Player physics
  PLAYER_SPEED: 180,       // Shift / Walk speed
  PLAYER_RUN_SPEED: 360,   // Fast run speed
  PLAYER_CROUCH_SPEED: 100,
  PLAYER_RADIUS: 14,
  HEAD_RADIUS: 7,

  // Network
  TICK_RATE: 128,
  SNAPSHOT_RATE: 30,
  LAG_COMPENSATION_BUFFER: 1_000,

  // Vision
  VISION_RANGE: 700,
  VISION_RAYS: 120,

  // Nuke
  SPIKE_PICKUP_RANGE: 60,

  // Max players
  MAX_PLAYERS_PER_TEAM: 5,
  MAX_PLAYERS: 10,
} as const;

export const WEAPON_STATS: Record<WeaponId, WeaponStats> = {
  knife: {
    id: 'knife', name: 'Knife', slot: 'melee', cost: 0,
    damage: { head: 50, body: 25, legs: 20 },
    fireRate: 1.5, reloadTime: 0, magSize: 1, reserveAmmo: 0,
    range: 80, armor_penetration: 1.0,
    firstShotAccuracy: 1, moveInaccuracy: 0, standInaccuracy: 0, crouchInaccuracy: 0,
    recoilPattern: [], killBonus: 0, automatic: false,
  },
  classic: {
    id: 'classic', name: 'Classic', slot: 'secondary', cost: 0,
    damage: { head: 78, body: 26, legs: 22 },
    fireRate: 6.75, reloadTime: 1750, magSize: 12, reserveAmmo: 36,
    range: 600, armor_penetration: 0.76,
    firstShotAccuracy: 0.92, moveInaccuracy: 3.5, standInaccuracy: 1.0, crouchInaccuracy: 0.4,
    recoilPattern: [
      {x:0,y:-2},{x:0.3,y:-2.5},{x:-0.3,y:-2},{x:0.5,y:-3},{x:-0.5,y:-2.5},
    ],
    killBonus: 200, automatic: false,
  },
  sheriff: {
    id: 'sheriff', name: 'Sheriff', slot: 'secondary', cost: 800,
    damage: { head: 145, body: 55, legs: 46 },
    fireRate: 4, reloadTime: 2250, magSize: 6, reserveAmmo: 24,
    range: 900, armor_penetration: 0.76,
    firstShotAccuracy: 0.98, moveInaccuracy: 6, standInaccuracy: 0.5, crouchInaccuracy: 0.2,
    recoilPattern: [
      {x:0,y:-5},{x:1,y:-4},{x:-1,y:-5},{x:0.5,y:-4.5},{x:-0.5,y:-5},{x:0,y:-6},
    ],
    killBonus: 200, automatic: false,
  },
  ghost: {
    id: 'ghost', name: 'Ghost', slot: 'secondary', cost: 500,
    damage: { head: 105, body: 30, legs: 25 },
    fireRate: 6.75, reloadTime: 1500, magSize: 15, reserveAmmo: 45,
    range: 700, armor_penetration: 0.76,
    firstShotAccuracy: 0.95, moveInaccuracy: 4, standInaccuracy: 0.8, crouchInaccuracy: 0.3,
    recoilPattern: [
      {x:0,y:-3},{x:0.4,y:-3.5},{x:-0.4,y:-3},{x:0.8,y:-4},{x:-0.8,y:-3.5},
      {x:0,y:-4},{x:0.5,y:-4.5},{x:-0.5,y:-4},{x:1,y:-5},{x:-1,y:-4.5},
      {x:0,y:-5},{x:0.5,y:-5.5},{x:-0.5,y:-5},{x:1,y:-6},{x:-1,y:-5.5},
    ],
    killBonus: 200, automatic: false,
  },
  spectre: {
    id: 'spectre', name: 'Spectre', slot: 'primary', cost: 1600,
    damage: { head: 86, body: 29, legs: 24 },
    fireRate: 13.33, reloadTime: 2250, magSize: 30, reserveAmmo: 90,
    range: 550, armor_penetration: 0.95,
    firstShotAccuracy: 0.92, moveInaccuracy: 4.5, standInaccuracy: 1.2, crouchInaccuracy: 0.4,
    recoilPattern: Array.from({length: 30}, (_, i) => ({
      x: Math.sin(i * 0.7) * (1 + i * 0.05),
      y: -(1.5 + i * 0.08),
    })),
    killBonus: 200, automatic: true,
  },
  phantom: {
    id: 'phantom', name: 'Phantom', slot: 'primary', cost: 2900,
    damage: { head: 156, body: 39, legs: 33 },
    fireRate: 3.66, reloadTime: 2500, magSize: 30, reserveAmmo: 90,
    range: 800, armor_penetration: 0.95,
    firstShotAccuracy: 0.96, moveInaccuracy: 7, standInaccuracy: 0.8, crouchInaccuracy: 0.3,
    recoilPattern: Array.from({length: 30}, (_, i) => ({
      x: Math.sin(i * 0.5) * (0.5 + i * 0.06),
      y: -(2 + i * 0.12),
    })),
    killBonus: 200, automatic: true, screenShake: 1.2,
  },
  vandal: {
    id: 'vandal', name: 'Vandal', slot: 'primary', cost: 2900,
    damage: { head: 160, body: 40, legs: 34 },
    fireRate: 3.25, reloadTime: 2500, magSize: 25, reserveAmmo: 75,
    range: 1000, armor_penetration: 0.95,
    firstShotAccuracy: 0.97, moveInaccuracy: 8, standInaccuracy: 1.0, crouchInaccuracy: 0.4,
    recoilPattern: Array.from({length: 25}, (_, i) => ({
      x: Math.sin(i * 0.6) * (0.8 + i * 0.08),
      y: -(2.5 + i * 0.15),
    })),
    killBonus: 200, automatic: true, screenShake: 1.5,
  },
  operator: {
    id: 'operator', name: 'Operator', slot: 'primary', cost: 4700,
    damage: { head: 300, body: 155, legs: 130 },
    fireRate: 0.6, reloadTime: 3700, magSize: 5, reserveAmmo: 20,
    range: 2500, armor_penetration: 1.0,
    firstShotAccuracy: 1.0, moveInaccuracy: 30, standInaccuracy: 0.1, crouchInaccuracy: 0.05,
    recoilPattern: [
      {x:0,y:-8},{x:0,y:-8},{x:0,y:-8},{x:0,y:-8},{x:0,y:-8},
    ],
    killBonus: 200, automatic: false, adsZoom: 5.0, scopeTime: 600,
  },
  judge: {
    id: 'judge', name: 'Judge', slot: 'primary', cost: 1850,
    damage: { head: 34, body: 17, legs: 14 },  // per pellet, 12 pellets
    fireRate: 3.5, reloadTime: 2250, magSize: 7, reserveAmmo: 21,
    range: 300, armor_penetration: 0.76,
    firstShotAccuracy: 0.85, moveInaccuracy: 10, standInaccuracy: 3, crouchInaccuracy: 1.5,
    recoilPattern: Array.from({length: 7}, () => ({x: 0, y: -6})),
    killBonus: 200, automatic: true,
  },
  ares: {
    // Ares: cheaper LMG with high suppression. Less accurate than Spectre but
    // compensates with 50-round mag, high body damage through armor, and 16 RPS.
    // Cost: 1550 (cheaper than Spectre 1600 given worse accuracy & mobility)
    id: 'ares', name: 'Ares', slot: 'primary', cost: 1550,
    damage: { head: 80, body: 34, legs: 28 },
    fireRate: 16, reloadTime: 3500, magSize: 50, reserveAmmo: 150,
    range: 750, armor_penetration: 1.0,
    firstShotAccuracy: 0.75, moveInaccuracy: 12, standInaccuracy: 3.5, crouchInaccuracy: 2.0,
    recoilPattern: Array.from({length: 50}, (_, i) => ({
      x: Math.sin(i * 0.4) * Math.min(i * 0.1, 2.5),
      y: -(1.2 + Math.min(i * 0.06, 3.5)),
    })),
    killBonus: 200, automatic: true, screenShake: 1.2,
  },
  odin: {
    id: 'odin', name: 'Odin', slot: 'primary', cost: 3200,
    damage: { head: 95, body: 38, legs: 32 },
    fireRate: 15.6, reloadTime: 5000, magSize: 100, reserveAmmo: 200,
    range: 900, armor_penetration: 0.95,
    firstShotAccuracy: 0.8, moveInaccuracy: 12, standInaccuracy: 4, crouchInaccuracy: 2,
    recoilPattern: Array.from({length: 100}, (_, i) => ({
      x: Math.sin(i * 0.3) * (2 + i * 0.05),
      y: -(1.5 + i * 0.1),
    })),
    killBonus: 200, automatic: true, screenShake: 2.0,
  },
};

export const ARMOR_STATS: Record<ArmorType, ArmorStats> = {
  none: { type: 'none', cost: 0, damageReduction: 0, hasHelmet: false },
  light: { type: 'light', cost: 400, damageReduction: 0.25, hasHelmet: false },
  heavy: { type: 'heavy', cost: 1000, damageReduction: 0.50, hasHelmet: true },
};
