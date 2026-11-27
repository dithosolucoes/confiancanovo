import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getAuthToken } from '../lib/api';
import { useAuth } from './AuthContext';

export interface RealtimeEvent {
  type: 'ws:connected' | 'chat:message' | 'notification:new' | 'order:updated';
  orderId?: string;
  message?: any;
  notification?: any;
  eta_minutes?: number;
  eta_distance_km?: number;
}

type EventListener = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribeOrder: (orderId: string) => void;
  unsubscribeOrder: (orderId: string) => void;
  addListener: (fn: EventListener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<EventListener>>(new Set());
  const subscribedOrdersRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) {
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | null = null;

    function connect() {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getAuthToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        for (const oid of subscribedOrdersRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe_order', orderId: oid }));
        }
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as RealtimeEvent;
          for (const fn of listenersRef.current) {
            fn(parsed);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user]);

  function subscribeOrder(orderId: string) {
    subscribedOrdersRef.current.add(orderId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_order', orderId }));
    }
  }

  function unsubscribeOrder(orderId: string) {
    subscribedOrdersRef.current.delete(orderId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe_order', orderId }));
    }
  }

  function addListener(fn: EventListener) {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }

  return (
    <RealtimeContext.Provider
      value={{ connected, subscribeOrder, unsubscribeOrder, addListener }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider');
  return ctx;
}
