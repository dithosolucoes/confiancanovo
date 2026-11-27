import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, formatDatePT, formatEUR } from '../lib/api';
import { ServiceStatusLabel } from './StatusLabel';
import type {
  AppNotification,
  MileageTrip,
  ServiceOrder,
  UserProfile,
  WarrantyReturnVisit,
} from '../types/domain';

interface MirrorPayload {
  technician: UserProfile;
  availableOrders: ServiceOrder[];
  assignedOrders: ServiceOrder[];
  returnVisits?: WarrantyReturnVisit[];
  payouts: Array<{
    id: string;
    week_start: string;
    week_end: string;
    due_date: string;
    total_amount: number;
    status: string;
  }>;
  trips: MileageTrip[];
  notifications: AppNotification[];
}

// Mesmo conteúdo em dois modos: 'modal' (sobreposto na lista) e 'page' (página própria, em rota).
export function TechnicianMirrorModal({
  technicianId,
  onClose,
  mode = 'modal',
  pageRoute,
}: {
  technicianId: string | null;
  onClose: () => void;
  mode?: 'modal' | 'page';
  pageRoute?: string;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<MirrorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'available' | 'assigned' | 'payouts' | 'km' | 'notifications'>(
    'assigned'
  );

  useEffect(() => {
    if (!technicianId) return;
    setLoading(true);
    setError(null);
    apiFetch<MirrorPayload>(`/api/technicians/${technicianId}/mirror`)
      .then((res) => setData(res))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [technicianId]);

  if (!technicianId) return null;

  const isPage = mode === 'page';
  const openPageRoute =
    pageRoute ||
    (user?.role === 'company_admin' ? `/empresa/tecnicos/${technicianId}/espelho` : `/admin/tecnicos/${technicianId}/espelho`);

  const wrapperClass = isPage
    ? 'w-full'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4';
  const cardClass = isPage
    ? 'flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white'
    : 'flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl';

  return (
    <div className={wrapperClass}>
      <div className={cardClass}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Eye className="h-4 w-4 text-slate-700" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Espelho do Técnico (Somente Leitura)
              </h3>
              {data && (
                <p className="text-xs text-slate-500">
                  {data.technician.full_name} · {data.technician.organization_name || 'Confiança'} ·
                  Repasse efetivo {data.technician.effective_payout_percentage}%
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isPage && (
              <Link
                to={openPageRoute}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Abrir em página
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              aria-label={isPage ? 'Voltar' : 'Fechar espelho'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-6 py-2.5">
          {[
            { id: 'assigned', label: `Agenda & Serviços (${data?.assignedOrders.length ?? 0})` },
            { id: 'available', label: `Mural Disponíveis (${data?.availableOrders.length ?? 0})` },
            { id: 'payouts', label: `Repasses (${data?.payouts.length ?? 0})` },
            { id: 'km', label: `Km (${data?.trips.length ?? 0})` },
            { id: 'notifications', label: `Notificações (${data?.notifications.length ?? 0})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === item.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="py-10 text-center text-xs text-slate-500">
              A carregar visão do técnico...
            </p>
          ) : error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              {error}
            </div>
          ) : data ? (
            <>
              {tab === 'assigned' && (
                <div className="space-y-4">
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {data.assignedOrders.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-500">
                        Nenhuma ordem atribuída a este técnico.
                      </p>
                    ) : (
                      data.assignedOrders.map((o) => (
                        <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
                          <div>
                            <div className="font-mono font-semibold text-slate-900">
                              {o.reference_code} · {o.service_name}
                            </div>
                            <div className="mt-0.5 text-slate-500">
                              {o.service_address} · Agendado: {formatDatePT(o.scheduled_at, true)}
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <ServiceStatusLabel status={o.status} />
                            <div className="text-right tabular-nums">
                              <div className="text-[11px] text-slate-400">Ganho</div>
                              <div className="font-bold text-emerald-700">
                                {formatEUR(o.technician_payout)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {data.returnVisits && data.returnVisits.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                      <div className="text-xs font-semibold text-amber-900">
                        Visitas de Retorno / Garantia ({data.returnVisits.length})
                      </div>
                      <div className="divide-y divide-amber-200/60">
                        {data.returnVisits.map((rv) => (
                          <div key={rv.id} className="py-2 flex items-center justify-between text-xs">
                            <div>
                              <span className="font-mono font-semibold text-slate-900">
                                {rv.reference_code}
                              </span>{' '}
                              · {rv.notes || rv.service_name}
                            </div>
                            <span className="tabular-nums text-slate-600">
                              {formatDatePT(rv.scheduled_at, true)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'available' && (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {data.availableOrders.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">
                      Sem chamados livres no mural desta empresa.
                    </p>
                  ) : (
                    data.availableOrders.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-3 p-4 text-xs">
                        <div>
                          <div className="font-mono font-semibold text-slate-900">
                            {o.reference_code} · {o.service_name}
                          </div>
                          <div className="mt-0.5 text-slate-500">
                            {o.service_address} · {formatDatePT(o.scheduled_at, true)}
                          </div>
                        </div>
                        <div className="text-right tabular-nums">
                          <div className="text-[11px] text-slate-400">Ganho Inicial</div>
                          <div className="font-bold text-emerald-700">
                            {formatEUR(o.technician_payout)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'payouts' && (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {data.payouts.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">
                      Nenhum fechamento semanal registado para este técnico.
                    </p>
                  ) : (
                    data.payouts.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-4 text-xs tabular-nums">
                        <div>
                          <div className="font-semibold text-slate-900">
                            Ciclo {p.week_start} a {p.week_end}
                          </div>
                          <div className="text-slate-500">Pagamento: {p.due_date}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-slate-900">{formatEUR(p.total_amount)}</div>
                          <div className={p.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}>
                            {p.status === 'paid' ? 'Pago' : 'Relatório Enviado'}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'km' && (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {data.trips.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">
                      Sem deslocações registadas.
                    </p>
                  ) : (
                    data.trips.map((tr) => (
                      <div key={tr.id} className="flex items-center justify-between p-4 text-xs">
                        <div>
                          <div className="font-medium text-slate-900">
                            {tr.origin_address} → {tr.destination_address}
                          </div>
                          <div className="text-slate-500 tabular-nums">
                            {formatDatePT(tr.started_at, true)}
                          </div>
                        </div>
                        <div className="text-right font-semibold text-slate-900 tabular-nums">
                          {Number(tr.distance_km).toFixed(1)} km
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'notifications' && (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {data.notifications.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">
                      Sem notificações registadas.
                    </p>
                  ) : (
                    data.notifications.map((n) => (
                      <div key={n.id} className="p-4 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900">{n.title}</span>
                          <span className="text-slate-400 tabular-nums">
                            {formatDatePT(n.created_at, true)}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-600">{n.body}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
