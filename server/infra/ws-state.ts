import { WebSocket } from 'ws';
import type { UserRole } from '../../src/types/domain.ts';

// Estado dos clientes WebSocket (fatia 17). Usado pelo servidor /ws e pelas rotas que transmitem eventos.
export interface WsClientMeta {
  ws: WebSocket;
  userId: string;
  role: UserRole;
  orderIds: Set<string>;
}

export const wsClients = new Set<WsClientMeta>();

export function broadcastToUser(userId: string, event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function broadcastToOrder(orderId: string, event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  for (const client of wsClients) {
    if (
      (client.orderIds.has(orderId) || client.role === 'super_admin') &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(payload);
    }
  }
}
