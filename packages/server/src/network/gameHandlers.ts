import { Socket, Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@tactical-fps/shared';
import { LobbyManager } from '../lobby/LobbyManager';

export function registerGameHandlers(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  _io: Server<ClientToServerEvents, ServerToClientEvents>,
  lobbyManager: LobbyManager,
): void {

  // ─── Player Input ────────────────────────
  // High-frequency: called every client frame
  socket.on('player_input', (input) => {
    const room = lobbyManager.getGameRoomForSocket(socket.id);
    if (!room) return;
    room.handleInput(socket.id, input);
  });

  // ─── Buy Item ────────────────────────────
  socket.on('buy_item', (item) => {
    const room = lobbyManager.getGameRoomForSocket(socket.id);
    if (!room) return;
    room.handleBuy(socket.id, item);
  });

  // ─── Ping measurement ────────────────────
  socket.on('ping', (clientTime) => {
    const room = lobbyManager.getGameRoomForSocket(socket.id);
    if (room) {
      const ping = Date.now() - clientTime;
      room.updatePlayerPing(socket.id, ping);
    }
  });
}
