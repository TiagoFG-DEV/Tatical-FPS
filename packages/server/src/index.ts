import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { LobbyManager } from './lobby/LobbyManager';
import { registerLobbyHandlers } from './network/lobbyHandlers';
import { registerGameHandlers } from './network/gameHandlers';
import type { ServerToClientEvents, ClientToServerEvents } from '@tactical-fps/shared';

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const app = express();

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// Health check for Vercel/Railway
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Optimize for competitive gameplay: smaller ping interval
  pingInterval: 2000,
  pingTimeout: 5000,
  // Use websocket only — no long-polling for game traffic
  transports: ['websocket'],
  // Enable per-message deflate for bandwidth reduction
  perMessageDeflate: {
    threshold: 128,
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
  },
});

const lobbyManager = new LobbyManager(io);

io.on('connection', (socket) => {
  console.log(`[Server] Client connected: ${socket.id}`);

  registerLobbyHandlers(socket, io, lobbyManager);
  registerGameHandlers(socket, io, lobbyManager);

  socket.on('ping', (clientTime) => {
    socket.emit('lobby_state', lobbyManager.getLobbyStateForSocket(socket.id) as any);
    // Ping is handled by measuring round-trip in client
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Server] Client disconnected: ${socket.id} — ${reason}`);
    lobbyManager.handleDisconnect(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Server] Tactical FPS Server running on port ${PORT}`);
  console.log(`[Server] Allowing connections from: ${CLIENT_URL}`);
});

export { io };
