import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type {
  LobbyState, LobbyPlayer, Team, MapId, ChatMessage,
  ServerToClientEvents, ClientToServerEvents, LobbyMode,
} from '@tactical-fps/shared';
import { GameRoom } from '../game/GameRoom';

// ─────────────────────────────────────────
// LOBBY MANAGER — Central registry for lobbies
// Supports Custom (code-based) and Matchmaking (queue) modes
// ─────────────────────────────────────────
export class LobbyManager {
  private lobbies = new Map<string, LobbyState>();
  private playerLobby = new Map<string, string>(); // socketId → lobbyCode
  private gameRooms = new Map<string, GameRoom>();  // lobbyCode → GameRoom
  private io: Server<ClientToServerEvents, ServerToClientEvents>;

  // ─── Matchmaking queue ───────────────────
  private matchmakingQueue: Array<{
    socketId: string;
    name: string;
    teamName: string;
    partyMembers: string[];
    enqueuedAt: number;
  }> = [];
  private matchmakingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(io: Server<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
    this.startMatchmakingLoop();
  }

  // ─── Create Lobby ───────────────────────
  createLobby(socketId: string, playerName: string, mode: LobbyMode = 'custom'): LobbyState | null {
    if (this.playerLobby.has(socketId)) return null;

    const code = this.generateCode();
    const host: LobbyPlayer = {
      id: socketId,
      name: playerName,
      team: 'attackers',
      isReady: false,
      isHost: true,
      ping: 0,
    };

    const lobby: LobbyState = {
      code,
      mapId: 'omega',
      players: [host],
      maxPlayers: 10,
      gameStarting: false,
      countdownSeconds: 0,
      mode,
      isTeamMode: false,
      teamName: { attackers: 'ATTACKERS', defenders: 'DEFENDERS' },
    };

    this.lobbies.set(code, lobby);
    this.playerLobby.set(socketId, code);
    return lobby;
  }

  // ─── Join Lobby ──────────────────────────
  joinLobby(socketId: string, code: string, playerName: string): LobbyState | null {
    const lobby = this.lobbies.get(code.toUpperCase());
    if (!lobby) return null;
    if (lobby.players.length >= lobby.maxPlayers) return null;
    if (lobby.gameStarting) return null;
    if (this.playerLobby.has(socketId)) return null;

    // Balance teams
    const attackers = lobby.players.filter(p => p.team === 'attackers').length;
    const defenders = lobby.players.filter(p => p.team === 'defenders').length;
    const team: Team = attackers <= defenders ? 'attackers' : 'defenders';

    // Ensure name uniqueness in the lobby
    let finalName = playerName.trim() || 'Player';
    let counter = 1;
    while (lobby.players.some(p => p.name === finalName)) {
      finalName = `${playerName.trim() || 'Player'}${counter}`;
      counter++;
    }

    const player: LobbyPlayer = {
      id: socketId,
      name: finalName,
      team,
      isReady: false,
      isHost: false,
      ping: 0,
    };

    lobby.players.push(player);
    this.playerLobby.set(socketId, code.toUpperCase());
    return lobby;
  }

  // ─── Leave Lobby ─────────────────────────
  leaveLobby(socketId: string): string | null {
    const code = this.playerLobby.get(socketId);
    if (!code) return null;

    const lobby = this.lobbies.get(code);
    if (!lobby) return null;

    lobby.players = lobby.players.filter(p => p.id !== socketId);
    this.playerLobby.delete(socketId);

    if (lobby.players.length === 0) {
      this.lobbies.delete(code);
      const room = this.gameRooms.get(code);
      if (room) { room.destroy(); this.gameRooms.delete(code); }
      return null;
    }

    // Transfer host if needed
    if (!lobby.players.some(p => p.isHost)) {
      lobby.players[0].isHost = true;
    }

    return code;
  }

  // ─── Handle Disconnect ───────────────────
  handleDisconnect(socketId: string): void {
    // Remove from matchmaking queue if present
    this.matchmakingQueue = this.matchmakingQueue.filter(e => e.socketId !== socketId);

    const code = this.leaveLobby(socketId);
    if (code) {
      const lobby = this.lobbies.get(code);
      if (lobby) this.broadcastLobbyState(code);
    }

    const room = this.getGameRoomForSocket(socketId);
    if (room) room.handleDisconnect(socketId);
  }

  // ─── Matchmaking Queue ───────────────────
  joinQueue(socketId: string, name: string, teamName: string, _partyMembers: string[] = []): void {
    // Already in queue or lobby
    if (this.matchmakingQueue.some(e => e.socketId === socketId)) return;

    this.matchmakingQueue.push({
      socketId,
      name,
      teamName: teamName.trim().slice(0, 20) || 'TEAM',
      partyMembers: [],
      enqueuedAt: Date.now(),
    });

    // Notify position
    this.broadcastQueuePositions();
  }

  joinPartyQueue(socketId: string, playerName: string, teamName: string): void {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby || !lobby.isTeamMode) return;

    // Only host can queue the party
    const host = lobby.players.find(p => p.isHost);
    if (host?.id !== socketId) return;

    // Enqueue the whole party as one entry
    this.matchmakingQueue.push({
      socketId,
      name: playerName,
      teamName: teamName.trim().slice(0, 20) || 'TEAM',
      partyMembers: lobby.players.map(p => p.id),
      enqueuedAt: Date.now(),
    });

    this.broadcastQueuePositions();
  }

  leaveQueue(socketId: string): void {
    this.matchmakingQueue = this.matchmakingQueue.filter(e => e.socketId !== socketId);
    this.broadcastQueuePositions();
  }

  private startMatchmakingLoop(): void {
    // Check every 2 seconds if we can form a match
    this.matchmakingTimer = setInterval(() => {
      if (this.matchmakingQueue.length < 2) return;

      // Sort by oldest first (FIFO)
      this.matchmakingQueue.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

      // Try to find two entries (solo or party) that can play against each other
      // For simplicity: take the first two entries in the queue
      const entryA = this.matchmakingQueue[0];
      const entryB = this.matchmakingQueue[1];
      
      // If we have at least 2 entries, we can start a match
      const batch = this.matchmakingQueue.splice(0, 2);
      this.formMatchFromQueue(batch);
      this.broadcastQueuePositions();
    }, 2000);
  }

  private formMatchFromQueue(entries: typeof this.matchmakingQueue): void {
    const code = this.generateCode();
    const players: LobbyPlayer[] = [];

    // Entry 0 -> Attackers, Entry 1 -> Defenders
    const teams: Team[] = ['attackers', 'defenders'];
    
    entries.forEach((entry, teamIdx) => {
      const team = teams[teamIdx];
      
      if (entry.partyMembers && entry.partyMembers.length > 0) {
        // Find the lobby these players are in
        const lobbyCode = this.playerLobby.get(entry.socketId);
        const sourceLobby = lobbyCode ? this.lobbies.get(lobbyCode) : null;
        
        if (sourceLobby) {
          sourceLobby.players.forEach(p => {
            players.push({
              ...p,
              team: team,
              isReady: true,
            });
            this.playerLobby.set(p.id, code);
          });
        }
      } else {
        // Ensure name uniqueness in the matchmaking lobby
        let finalName = entry.name.trim() || 'Player';
        let counter = 1;
        while (players.some(p => p.name === finalName)) {
          finalName = `${entry.name.trim() || 'Player'}${counter}`;
          counter++;
        }

        // Solo player
        players.push({
          id: entry.socketId,
          name: finalName,
          team: team,
          isReady: true,
          isHost: teamIdx === 0,
          ping: 0,
        });
        this.playerLobby.set(entry.socketId, code);
      }
    });

    const lobby: LobbyState = {
      code,
      mapId: 'omega',
      players,
      maxPlayers: 10,
      gameStarting: true,
      countdownSeconds: 5,
      mode: 'matchmaking',
      isTeamMode: false,
      teamName: {
        attackers: entries[0]?.teamName ?? 'ATTACKERS',
        defenders: entries[1]?.teamName ?? 'DEFENDERS',
      },
    };

    this.lobbies.set(code, lobby);

    // Notify everyone
    players.forEach(p => {
      this.io.to(p.id).emit('match_found', code);
    });

    // Create game room and start countdown
    const room = new GameRoom(code, lobby, this.io);
    this.gameRooms.set(code, room);

    this.io.to(code).emit('match_starting', 5);
    let countdown = 5;
    const interval = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(interval);
        room.start();
      }
    }, 1000);
  }

  private broadcastQueuePositions(): void {
    this.matchmakingQueue.forEach((entry, i) => {
      const estimated = Math.max(0, Math.ceil((10 - this.matchmakingQueue.length) / 2) * 2);
      this.io.to(entry.socketId).emit('queue_status', {
        position: i + 1,
        estimated,
        status: 'queuing',
      });
    });
  }

  // ─── Set Team ────────────────────────────
  setTeam(socketId: string, team: Team): boolean {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby) return false;

    const player = lobby.players.find(p => p.id === socketId);
    if (!player) return false;

    const targetCount = lobby.players.filter(p => p.team === team).length;
    if (targetCount >= 5) return false;

    player.team = team;
    return true;
  }

  // Host-only: move any player to a specific team
  movePlayer(hostId: string, targetId: string, team: 'attackers' | 'defenders'): boolean {
    const lobby = this.getLobbyForSocket(hostId);
    if (!lobby) return false;

    const host = lobby.players.find(p => p.id === hostId);
    if (!host?.isHost) return false;

    const target = lobby.players.find(p => p.id === targetId);
    if (!target) return false;

    const targetCount = lobby.players.filter(p => p.team === team).length;
    if (targetCount >= 5) return false;

    target.team = team;
    return true;
  }

  toggleTeamMode(socketId: string, enabled: boolean): boolean {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby) return false;
    const player = lobby.players.find(p => p.id === socketId);
    if (!player?.isHost) return false;

    lobby.isTeamMode = enabled;
    if (enabled) {
      lobby.players.forEach(p => p.team = 'attackers');
    } else {
      // Reset team names when disabling team mode
      lobby.teamName = { attackers: 'ATTACKERS', defenders: 'DEFENDERS' };
    }
    return true;
  }

  // ─── Set Team Name ────────────────────────
  setTeamName(socketId: string, side: 'attackers' | 'defenders', name: string): boolean {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby) return false;
    const player = lobby.players.find(p => p.id === socketId);
    if (!player?.isHost) return false;
    
    // Only allow renaming if in Team Mode
    if (!lobby.isTeamMode) return false;

    if (!lobby.teamName) lobby.teamName = { attackers: 'ATTACKERS', defenders: 'DEFENDERS' };
    lobby.teamName[side] = name.trim().slice(0, 20) || (side === 'attackers' ? 'ATTACKERS' : 'DEFENDERS');
    return true;
  }

  // ─── Set Ready ────────────────────────────
  setReady(socketId: string, ready: boolean): boolean {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby) return false;

    const player = lobby.players.find(p => p.id === socketId);
    if (!player) return false;

    player.isReady = ready;
    return true;
  }

  // ─── Start Match ─────────────────────────
  startMatch(socketId: string, mapId: MapId): boolean {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby) return false;

    const player = lobby.players.find(p => p.id === socketId);
    if (!player?.isHost) return false;

    // Require at least 1 player total
    if (lobby.players.length < 1) return false;

    lobby.mapId = mapId;
    lobby.gameStarting = true;
    lobby.countdownSeconds = 5;

    const room = new GameRoom(lobby.code, lobby, this.io);
    this.gameRooms.set(lobby.code, room);

    this.io.to(lobby.code).emit('match_starting', 5);
    
    let countdown = 5;
    const interval = setInterval(() => {
      countdown--;
      lobby.countdownSeconds = countdown;
      this.broadcastLobbyState(lobby.code);
      
      if (countdown <= 0) {
        clearInterval(interval);
        room.start();
      }
    }, 1000);

    return true;
  }

  // ─── Kick Player ─────────────────────────
  kickPlayer(hostId: string, targetId: string): boolean {
    const lobby = this.getLobbyForSocket(hostId);
    if (!lobby) return false;

    const host = lobby.players.find(p => p.id === hostId);
    if (!host?.isHost) return false;

    lobby.players = lobby.players.filter(p => p.id !== targetId);
    this.playerLobby.delete(targetId);
    return true;
  }

  // ─── Set Map ─────────────────────────────
  setMap(socketId: string, mapId: MapId): boolean {
    const lobby = this.getLobbyForSocket(socketId);
    if (!lobby) return false;
    const player = lobby.players.find(p => p.id === socketId);
    if (!player?.isHost) return false;
    lobby.mapId = mapId;
    return true;
  }

  // ─── Broadcast ───────────────────────────
  broadcastLobbyState(code: string): void {
    const lobby = this.lobbies.get(code);
    if (!lobby) return;
    this.io.to(code).emit('lobby_state', lobby);
  }

  broadcastChat(code: string, msg: ChatMessage): void {
    this.io.to(code).emit('lobby_chat', msg);
  }

  // ─── Getters ─────────────────────────────
  getLobbyForSocket(socketId: string): LobbyState | null {
    const code = this.playerLobby.get(socketId);
    return code ? (this.lobbies.get(code) ?? null) : null;
  }

  getLobbyStateForSocket(socketId: string): LobbyState | null {
    return this.getLobbyForSocket(socketId);
  }

  getLobbyCode(socketId: string): string | null {
    return this.playerLobby.get(socketId) ?? null;
  }

  getGameRoom(code: string): GameRoom | null {
    return this.gameRooms.get(code) ?? null;
  }

  getGameRoomForSocket(socketId: string): GameRoom | null {
    const code = this.playerLobby.get(socketId);
    return code ? (this.gameRooms.get(code) ?? null) : null;
  }

  // ─── Private Helpers ─────────────────────
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do {
      code = Array.from({ length: 6 }, () =>
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');
    } while (this.lobbies.has(code));
    return code;
  }

  destroy(): void {
    if (this.matchmakingTimer) clearInterval(this.matchmakingTimer);
  }
}
