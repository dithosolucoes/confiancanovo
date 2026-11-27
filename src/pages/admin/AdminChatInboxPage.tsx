import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';
import { AiEscalationsPanel } from '../../components/AiEscalationsPanel';
import { ServiceStatusLabel } from '../../components/StatusLabel';
import { useAuth } from '../../context/AuthContext';
import { useRealtime } from '../../context/RealtimeContext';
import { apiFetch, formatDatePT } from '../../lib/api';
import type { ChatThreadSummary, OrderMessage, ServiceOrder } from '../../types/domain';
import { ExternalLink, MessageSquare, Search, Send } from 'lucide-react';

export function AdminChatInboxPage() {
  const { user } = useAuth();
  const { addListener } = useRealtime();
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<ServiceOrder | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadThreads() {
    try {
      const res = await apiFetch<{ threads: ChatThreadSummary[] }>('/api/admin/chat/threads');
      setThreads(res.threads);
      if (!selectedId && res.threads.length > 0) {
        setSelectedId(res.threads[0].service_order_id);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar conversas.');
    }
  }

  async function loadConversation(orderId: string) {
    try {
      const res = await apiFetch<{ order: ServiceOrder }>(`/api/orders/${orderId}`);
      setActiveOrder(res.order);
      setMessages(res.order.messages || []);
    } catch (err: any) {
      setError(err?.message || 'Erro ao abrir conversa.');
    }
  }

  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadConversation(selectedId);
    }
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    return addListener((evt) => {
      if (evt.type === 'chat:message' && evt.message) {
        if (evt.orderId === selectedId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === evt.message.id)) return prev;
            return [...prev, evt.message];
          });
        }
        loadThreads();
      }
    });
  }, [addListener, selectedId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await apiFetch<{ message: OrderMessage }>(`/api/orders/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: draft.trim() }),
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) return prev;
        return [...prev, res.message];
      });
      setDraft('');
      loadThreads();
    } catch (err: any) {
      setError(err?.message || 'Erro ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  }

  const filtered = threads.filter((t) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      t.reference_code.toLowerCase().includes(q) ||
      t.customer_name.toLowerCase().includes(q) ||
      t.service_name.toLowerCase().includes(q) ||
      (t.technician_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <PortalLayout title="Central de Chat" breadcrumb="Atendimento em Tempo Real">
      <AiEscalationsPanel />

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[560px]">
        {/* Left pane: Threads list */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col">
          <div className="p-3 border-b border-slate-200">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar ordem, cliente ou técnico..."
                className="w-full rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-3 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[520px]">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Sem conversas correspondentes.
              </div>
            ) : (
              filtered.map((t) => {
                const isSelected = t.service_order_id === selectedId;
                return (
                  <button
                    key={t.service_order_id}
                    type="button"
                    onClick={() => setSelectedId(t.service_order_id)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-mono text-xs font-semibold ${
                          isSelected ? 'text-slate-200' : 'text-slate-900'
                        }`}
                      >
                        {t.reference_code}
                      </span>
                      <span
                        className={`text-[11px] tabular-nums ${
                          isSelected ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      >
                        {t.message_count} msg
                      </span>
                    </div>
                    <div
                      className={`mt-1 text-sm font-medium truncate ${
                        isSelected ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {t.customer_name} · {t.service_name}
                    </div>
                    <div
                      className={`mt-0.5 text-xs truncate ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {t.last_message
                        ? `${t.last_sender_name}: ${t.last_message}`
                        : `Sem mensagens${t.technician_name ? ` · Téc: ${t.technician_name}` : ''}`}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane: Messages */}
        <div className="lg:col-span-8 flex flex-col">
          {activeOrder ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-slate-50">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {activeOrder.reference_code}
                    </span>
                    <ServiceStatusLabel status={activeOrder.status} />
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-slate-900">
                    {activeOrder.customer_name} — {activeOrder.service_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    Técnico: {activeOrder.technician_name || 'Não atribuído'}
                  </div>
                </div>
                <Link
                  to={`/admin/servicos/${activeOrder.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir Ordem
                </Link>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3 max-h-[400px]">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center py-12 text-slate-400 text-xs">
                    <MessageSquare className="h-6 w-6 mb-2 text-slate-300" />
                    Ainda sem mensagens nesta ordem. Inicie o contacto abaixo.
                  </div>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === user?.id;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                      >
                        <div className="mb-1 text-[11px] text-slate-400">
                          {m.sender_name} · {formatDatePT(m.created_at, true)}
                        </div>
                        <div
                          className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm ${
                            mine
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-200 bg-slate-50 text-slate-800'
                          }`}
                        >
                          {m.message}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <form
                onSubmit={handleSend}
                className="flex items-center gap-2 border-t border-slate-200 p-4 bg-white"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escreva uma mensagem para cliente e técnico..."
                  className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
              Selecione uma ordem à esquerda para ver e responder às mensagens.
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
