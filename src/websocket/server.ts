import { IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken, JwtPayload } from '@/api/middleware/auth';
import { logger } from '@/config/logger';
import { handleStreamMessage } from '@/websocket/streamHandler';

interface AuthenticatedSocket extends WebSocket {
  user?: JwtPayload;
  isAlive: boolean;
}

export function attachWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/booking-stream' });

  wss.on('connection', (ws: AuthenticatedSocket, req: IncomingMessage) => {
    ws.isAlive = true;

    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing authentication token');
      return;
    }

    try {
      ws.user = verifyToken(token);
    } catch {
      ws.close(4001, 'Invalid authentication token');
      return;
    }

    logger.info({ userId: ws.user.userId }, 'WebSocket client connected');

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as unknown;
        await handleStreamMessage(ws, message, ws.user!);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      logger.info({ userId: ws.user?.userId }, 'WebSocket client disconnected');
    });

    ws.send(JSON.stringify({ type: 'connected', userId: ws.user.userId }));
  });

  // Heartbeat to detect stale connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const socket = ws as AuthenticatedSocket;
      if (!socket.isAlive) { socket.terminate(); return; }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
