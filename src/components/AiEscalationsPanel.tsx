import { useCallback, useEffect, useState } from 'react';
import { apiFetch, formatDatePT } from '../lib/api';

interface EscalatedMessage {
  sender: string;
  content: string;
  created_at: string;
}

interface Escalation {
  id: string;
  customer_name: string;
  customer_role: string;
  updated_at: string;
  messages: EscalatedMessage[];
}

const SENDER_LABEL: Record<string, string> = { customer: 'Cliente', ai: 'Assistente' };

// Conversas que o assistente IA encaminhou para o gestor (só o super admin vê)
export function AiEscalationsPanel() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ escalations: Escalation[] }>('/api/ai/escalations');
      setItems(res.escalations);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar os encaminhamentos.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function resolve(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/ai/conversations/${id}/resolve`, { method: 'POST' });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível marcar como resolvido.');
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0 && !error) return null;

  return (
    <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Encaminhados pelo assistente IA ({items.length})
        </h2>
      </div>
      {error && <div className="mb-2 text-xs text-rose-700">{error}</div>}
      <div className="space-y-3">
        {items.map((e) => (
          <article key={e.id} className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs">
                <span className="font-semibold text-slate-900">{e.customer_name}</span>
                <span className="ml-2 text-slate-500">
                  {formatDatePT(e.updated_at, true)}
                </span>
              </div>
              <button
                type="button"
                disabled={busyId === e.id}
                onClick={() => resolve(e.id)}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
              >
                Marcar como resolvido
              </button>
            </div>
            <ul className="space-y-1.5">
              {e.messages.map((m, i) => (
                <li key={i} className="text-xs text-slate-700">
                  <span className="font-medium">{SENDER_LABEL[m.sender] || 'Sistema'}:</span>{' '}
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
