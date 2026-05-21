import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@tactical-fps/shared';

// Resolve server URL: Vercel env var → same-origin proxy → localhost fallback
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  SERVER_URL || window.location.origin,
  {
    path: '/socket.io',
    transports: ['websocket'],
    autoConnect: false,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 10_000,
  },
);

// Auto-measure ping every 2 seconds
let pingInterval: ReturnType<typeof setInterval> | null = null;

socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
  pingInterval = setInterval(() => {
    socket.emit('ping', Date.now());
  }, 2000);
});

socket.on('disconnect', (reason) => {
  console.warn('[Socket] Disconnected:', reason);
  if (pingInterval) clearInterval(pingInterval);
});
