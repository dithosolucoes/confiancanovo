import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, Search, ShieldCheck, Star } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { QuoteStatusLabel, ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceOrder } from '../../types/domain';

export function CustomerOrdersPage() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<'all' | 'open' | 'action' | 'completed'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiFetch<{ orders: ServiceOrder[] }>('/api/orders')
      .then((res) => setOrders(res.orders))
      .finally(() => setLoading(false));
  }, []);

  const filtered = orders.filter((o) => {
    if (statusTab === 'open' && ['completed', 'cancelled'].includes(o.status)) return false;
    if (
      statusTab === 'action' &&
      !(o.quote_status === 'sent' || o.status === 'payment_pending' || o.suggestion_status === 'pending')
    ) {
      return false;
    }
    if (statusTab === 'completed' && o.status !== 'completed') return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.reference_code} ${o.service_name} ${o.service_address} ${o.technician_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PortalLayout
      title="Meus Serviços & Histórico"
      breadcrumb="Portal do Cliente"
      primaryAction={
        <Link
          to="/cliente/agendar"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Solicitar Serviço</span>
        </Link>
      }
    >
      <div className="space-y-4">
        {orders.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['all', 'Todos'],
                  ['open', 'Em Aberto'],
                  ['action', 'Aguardam Aprovação / Pgto'],
                  ['completed', 'Concluídos'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusTab(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusTab === key
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar ref., serviço ou morada..."
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm text-slate-600">Ainda não tem pedidos registados.</p>
            <Link
              to="/cliente/agendar"
              className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
            >
              Agendar Primeiro Serviço
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Nenhum serviço corresponde aos filtros selecionados.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((o) => (
              <Link
                key={o.id}
                to={`/cliente/servicos/${o.id}`}
                className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-400 sm:flex-row sm:items-center"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-900">
                      {o.reference_code}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatDatePT(o.scheduled_at, true)}</span>
                    <span aria-hidden="true">·</span>
                    <span>Técnico: {o.technician_name || 'A atribuir'}</span>
                    {o.suggestion_status === 'pending' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>Novo horário sugerido</span>
                        </span>
                      </>
                    )}
                    {o.warranty_return_requested_at && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>Garantia acionada</span>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-base font-semibold text-slate-900">{o.service_name}</div>
                  <div className="text-xs text-slate-500">{o.service_address}</div>
                </div>

                <div className="flex flex-wrap items-center gap-5 sm:justify-end">
                  <div className="space-y-1 text-left sm:text-right">
                    <ServiceStatusLabel status={o.status} />
                    <div>
                      <QuoteStatusLabel status={o.quote_status} />
                    </div>
                  </div>

                  <div className="text-right tabular-nums">
                    <div className="text-base font-bold text-slate-900">
                      {formatEUR(o.total_customer_amount)}
                    </div>
                    {o.rating ? (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-600">
                        <Star className="h-3.5 w-3.5 fill-amber-400" />
                        <span>{o.rating}/5</span>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        {o.quote_paid ? 'Pago' : 'Ver detalhes'}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
