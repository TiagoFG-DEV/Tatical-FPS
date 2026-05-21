import { create } from 'zustand';
import type {
  LobbyState, GameSnapshot, KillEvent, ChatMessage,
  PlayerState, RoundState, SpikeState, MatchResult, MatchmakingStatus,
} from '@tactical-fps/shared';
import { MAPS } from '@tactical-fps/shared';

// ─────────────────────────────────────────
// LOBBY STORE
// ─────────────────────────────────────────
interface LobbyStore {
  lobby: LobbyState | null;
  myId: string;
  playerName: string;
  error: string | null;
  countdownSeconds: number;
  // matchmaking
  queueStatus: MatchmakingStatus;
  queuePosition: number;
  queueEstimated: number;
  chatMessages: ChatMessage[];

  setLobby: (l: LobbyState) => void;
  addChat: (m: ChatMessage) => void;
  setMyId: (id: string) => void;
  setPlayerName: (n: string) => void;
  setError: (e: string | null) => void;
  setCountdown: (n: number) => void;
  setQueueStatus: (s: MatchmakingStatus, pos: number, est: number) => void;
  reset: () => void;
}

export const useLobbyStore = create<LobbyStore>((set) => ({
  lobby: null,
  myId: '',
  playerName: localStorage.getItem('playerName') || '',
  error: null,
  countdownSeconds: 0,
  queueStatus: 'idle',
  queuePosition: 0,
  queueEstimated: 0,
  chatMessages: [],

  setLobby: (lobby) => set({ lobby }),
  addChat: (m) => set(s => ({ chatMessages: [...s.chatMessages, m].slice(-50) })),
  setMyId: (myId) => set({ myId }),
  setPlayerName: (playerName) => {
    localStorage.setItem('playerName', playerName);
    set({ playerName });
  },
  setError: (error) => set({ error }),
  setCountdown: (countdownSeconds) => set({ countdownSeconds }),
  setQueueStatus: (queueStatus, queuePosition, queueEstimated) =>
    set({ queueStatus, queuePosition, queueEstimated }),
  reset: () => set({
    lobby: null, error: null, countdownSeconds: 0,
    queueStatus: 'idle', queuePosition: 0, queueEstimated: 0,
  }),
}));

// ─────────────────────────────────────────
// GAME STORE
// ─────────────────────────────────────────
interface GameStore {
  snapshot: GameSnapshot | null;
  myPlayer: PlayerState | null;
  killFeed: KillEvent[];
  chatMessages: ChatMessage[];
  round: RoundState | null;
  spike: SpikeState | null;
  matchResult: MatchResult | null;
  ping: number;
  buyMenuOpen: boolean;
  scoreboardOpen: boolean;
  isBuying: boolean;
  // damage flash
  lastDamageAt: number;
  isInPlantZone: boolean;

  setSnapshot: (s: GameSnapshot, myId: string) => void;
  addKill: (k: KillEvent) => void;
  addChat: (m: ChatMessage) => void;
  setMatchResult: (r: MatchResult) => void;
  setPing: (p: number) => void;
  setBuyMenuOpen: (v: boolean) => void;
  setScoreboardOpen: (v: boolean) => void;
  setIsBuying: (v: boolean) => void;
  triggerDamage: () => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  snapshot: null,
  myPlayer: null,
  killFeed: [],
  chatMessages: [],
  round: null,
  spike: null,
  matchResult: null,
  ping: 0,
  buyMenuOpen: false,
  scoreboardOpen: false,
  isBuying: false,
  lastDamageAt: 0,
  isInPlantZone: false,

  setSnapshot: (snapshot, myId) => {
    const myPlayer = snapshot.players.find(p => p.id === myId) ?? null;
    
    let isInPlantZone = false;
    if (myPlayer) {
      const map = MAPS[snapshot.mapId];
      if (map) {
        const p = myPlayer.position;
        isInPlantZone = map.zones.some((z: any) => {
          if (z.type !== 'site_a' && z.type !== 'site_b' && z.type !== 'site_c') return false;
          const poly = z.polygon;
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        });
      }
    }

    set({ snapshot, myPlayer, round: snapshot.round, spike: snapshot.spike, isInPlantZone });
  },
  addKill: (k) => set(s => ({
    killFeed: [k, ...s.killFeed].slice(0, 8),
  })),
  addChat: (m) => set(s => ({
    chatMessages: [...s.chatMessages, m].slice(-50),
  })),
  setMatchResult: (matchResult) => set({ matchResult }),
  setPing: (ping) => set({ ping }),
  setBuyMenuOpen: (buyMenuOpen) => set({ buyMenuOpen }),
  setScoreboardOpen: (scoreboardOpen) => set({ scoreboardOpen }),
  setIsBuying: (isBuying) => set({ isBuying }),
  triggerDamage: () => set({ lastDamageAt: Date.now() }),
  reset: () => set({
    snapshot: null, myPlayer: null, killFeed: [],
    chatMessages: [], round: null, spike: null,
    matchResult: null, buyMenuOpen: false, scoreboardOpen: false,
    lastDamageAt: 0,
  }),
}));
