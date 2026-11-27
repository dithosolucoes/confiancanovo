import type http from 'node:http';
import { WebSocketServer } from 'ws';
import { db } from '../db.ts';
import { parseCookies, verifyToken, COOKIE_NAME } from '../infra/auth-session.ts';
import { wsClients, type WsClientMeta } from '../infra/ws-state.ts';
import type { UserRole } from '../../src/types/domain.ts';

// Servidor WebSocket em /ws (fatia 17). Mesmo caminho, mesma ordem de autenticacao e mesmas mensagens do server.ts original.
export function registerWebSocketServer(httpServer: http.Server, ctx: { canUserAccessOrder: (user: any, order: any) => boolean }): void {
  const { canUserAccessOrder } = ctx;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const urlObj = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
    const queryToken = urlObj.searchParams.get('token');
    const cookies = parseCookies(req.headers.cookie);
    const token = queryToken || cookies[COOKIE_NAME];
    const verified = token ? verifyToken(token) : null;

    if (!verified) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const row = db
      .prepare('SELECT id, role, organization_id, is_active FROM profiles WHERE id = ?')
      .get(verified.userId) as any;
    if (!row || !row.is_active) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const meta: WsClientMeta = {
      ws,
      userId: row.id,
      role: row.role as UserRole,
      orderIds: new Set(),
    };
    wsClients.add(meta);

    ws.send(JSON.stringify({ type: 'ws:connected', userId: meta.userId }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'subscribe_order' && typeof msg.orderId === 'string') {
          const ord = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(msg.orderId) as any;
          if (ord && canUserAccessOrder({ ...row, is_active: true, full_name: '', email: '' }, ord)) {
            meta.orderIds.add(msg.orderId);
          }
        } else if (msg.type === 'unsubscribe_order' && typeof msg.orderId === 'string') {
          meta.orderIds.delete(msg.orderId);
        }
      } catch {
        // Ignore malformed WS frames
      }
    });

    ws.on('close', () => {
      wsClients.delete(meta);
    });
  });
}
