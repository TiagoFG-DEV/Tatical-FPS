import { Socket, Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, ServerToClientEvents, ClientToServerEvents, LobbyMode } from '@tactical-fps/shared';
import { LobbyManager } from '../lobby/LobbyManager';

export function registerLobbyHandlers(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  lobbyManager: LobbyManager,
): void {

  // ─── Create Lobby ───────────────────────
  socket.on('create_lobby', (name: string, mode?: LobbyMode) => {
    const playerName = name.trim().slice(0, 24) || `Player${socket.id.slice(0, 4)}`;
    const lobbyMode: LobbyMode = mode ?? 'custom';
    const lobby = lobbyManager.createLobby(socket.id, playerName, lobbyMode);

    if (!lobby) {
      socket.emit('lobby_error', 'Already in a lobby.');
      return;
    }

    socket.join(lobby.code);
    socket.emit('lobby_state', lobby);
    console.log(`[Lobby] ${playerName} created ${lobbyMode} lobby ${lobby.code}`);
  });

  // ─── Join Lobby ──────────────────────────
  socket.on('join_lobby', (code: string, name: string) => {
    const playerName = name.trim().slice(0, 24) || `Player${socket.id.slice(0, 4)}`;
    const lobby = lobbyManager.joinLobby(socket.id, code, playerName);

    if (!lobby) {
      socket.emit('lobby_error', 'Lobby not found, full, or already starting.');
      return;
    }

    socket.join(lobby.code);
    lobbyManager.broadcastLobbyState(lobby.code);
    console.log(`[Lobby] ${playerName} joined lobby ${lobby.code}`);
  });

  // ─── Leave Lobby ─────────────────────────
  socket.on('leave_lobby', () => {
    const code = lobbyManager.getLobbyCode(socket.id);
    if (code) {
      socket.leave(code);
      lobbyManager.leaveLobby(socket.id);
      lobbyManager.broadcastLobbyState(code);
    }
  });

  // ─── Set Team ────────────────────────────
  socket.on('set_team', (team) => {
    const ok = lobbyManager.setTeam(socket.id, team);
    if (ok) {
      const code = lobbyManager.getLobbyCode(socket.id);
      if (code) lobbyManager.broadcastLobbyState(code);
    } else {
      socket.emit('lobby_error', 'Team is full (max 5 per side).');
    }
  });

  // ─── Move Player (Host Only) ──────────────
  socket.on('move_player', (targetId, team) => {
    const ok = lobbyManager.movePlayer(socket.id, targetId, team);
    if (ok) {
      const code = lobbyManager.getLobbyCode(socket.id);
      if (code) lobbyManager.broadcastLobbyState(code);
    } else {
      socket.emit('lobby_error', 'Cannot move player: team full or not host.');
    }
  });

  // ─── Set Team Name ───────────────────────
  socket.on('set_team_name', (side, name) => {
    const ok = lobbyManager.setTeamName(socket.id, side, name);
    if (ok) {
      const code = lobbyManager.getLobbyCode(socket.id);
      if (code) lobbyManager.broadcastLobbyState(code);
    }
  });

  // ─── Toggle Team Mode ────────────────────
  socket.on('toggle_team_mode', (enabled) => {
    const ok = lobbyManager.toggleTeamMode(socket.id, enabled);
    if (ok) {
      const code = lobbyManager.getLobbyCode(socket.id);
      if (code) lobbyManager.broadcastLobbyState(code);
    }
  });

  socket.on('set_map', (mapId) => {
    const ok = lobbyManager.setMap(socket.id, mapId);
    if (ok) {
      const code = lobbyManager.getLobbyCode(socket.id);
      if (code) lobbyManager.broadcastLobbyState(code);
    }
  });

  // ─── Ready ───────────────────────────────
  socket.on('set_ready', (ready) => {
    const ok = lobbyManager.setReady(socket.id, ready);
    if (ok) {
      const code = lobbyManager.getLobbyCode(socket.id);
      if (code) lobbyManager.broadcastLobbyState(code);
    }
  });

  // ─── Start Match ─────────────────────────
  socket.on('start_match', (mapId) => {
    const ok = lobbyManager.startMatch(socket.id, mapId);
    const code = lobbyManager.getLobbyCode(socket.id);

    if (!ok || !code) {
      socket.emit('lobby_error', 'Cannot start: need at least 1 player.');
      return;
    }

    io.to(code).emit('match_starting', 5);

    let countdown = 5;
    const interval = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(interval);
        const room = lobbyManager.getGameRoom(code);
        if (room) room.start();
      }
    }, 1000);
  });

  // ─── Kick Player ─────────────────────────
  socket.on('kick_player', (targetId) => {
    const code = lobbyManager.getLobbyCode(socket.id);
    const ok = lobbyManager.kickPlayer(socket.id, targetId);

    if (ok && code) {
      io.to(targetId).emit('lobby_error', 'You were kicked from the lobby.');
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.leave(code);
      lobbyManager.broadcastLobbyState(code);
    }
  });

  // ─── Matchmaking Queue ───────────────────
  socket.on('queue_join', (playerName, teamName, _partyMembers) => {
    const lobby = lobbyManager.getLobbyForSocket(socket.id);
    if (lobby && lobby.isTeamMode) {
      lobbyManager.joinPartyQueue(socket.id, playerName, teamName);
    } else {
      const name = playerName.trim().slice(0, 24) || `Player${socket.id.slice(0, 4)}`;
      lobbyManager.joinQueue(socket.id, name, teamName);
    }
  });

  socket.on('queue_leave', () => {
    lobbyManager.leaveQueue(socket.id);
    console.log(`[Queue] ${socket.id} left matchmaking queue`);
  });

  // ─── Chat ────────────────────────────────
  socket.on('lobby_chat', (message, team) => {
    const lobby = lobbyManager.getLobbyForSocket(socket.id);
    if (!lobby) return;

    const player = lobby.players.find(p => p.id === socket.id);
    if (!player) return;

    const msg: ChatMessage = {
      id: uuidv4(),
      senderId: socket.id,
      senderName: player.name,
      team,
      message: message.slice(0, 256),
      timestamp: Date.now(),
    };

    if (team === 'all') {
      lobbyManager.broadcastChat(lobby.code, msg);
    } else {
      const teamSockets = lobby.players
        .filter(p => p.team === team)
        .map(p => p.id);
      teamSockets.forEach(sid => {
        io.to(sid).emit('lobby_chat', msg);
      });
    }
  });
}
