import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Navigation, Search, Star, Wrench } from 'lucide-react';
import { GpsPermissionPrompt } from '../../components/GpsPermissionPrompt';
import { PortalLayout } from '../../components/PortalLayout';
import { QuoteStatusLabel, ServiceStatusLabel } from '../../components/StatusLabel';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceOrder } from '../../types/domain';

function calcDuration(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  const mins = Math.round((e - s) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function TechAgendaPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [statusTab, setStatusTab] = useState<'all' | 'accepted' | 'active' | 'completed'>('all');
  const [todayOnly, setTodayOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [gpsPrompt, setGpsPrompt] = useState<{
    open: boolean;
    orderId: string;
    message?: string;
  }>({ open: false, orderId: '' });

  async function loadMine() {
    const res = await apiFetch<{ orders: ServiceOrder[] }>('/api/orders?scope=mine');
    setOrders(res.orders);
  }

  useEffect(() => {
    void loadMine();
  }, []);

  async function captureGps(): Promise<{ lat?: number; lng?: number; error?: string }> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { error: 'Geolocalização não disponível neste navegador.' };
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => resolve({ error: err.message || 'Permissão GPS recusada.' }),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });
  }

  async function submitOnTheWay(orderId: string, originLat?: number, originLng?: number) {
    setBusyId(orderId);
    setError(null);
    try {
      const res = await apiFetch<{ trip: any }>('/api/mileage/record', {
        method: 'POST',
        body: JSON.stringify({ action: 'on_the_way', serviceOrderId: orderId, originLat, originLng }),
      });
      setToast(`Em deslocação! Percurso calculado: ${res.trip.distance_km} km.`);
      setTimeout(() => setToast(null), 5000);
      await loadMine();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleOnTheWay(orderId: string) {
    setBusyId(orderId);
    const gps = await captureGps();
    if (gps.lat === undefined || gps.lng === undefined) {
      setBusyId(null);
      setGpsPrompt({ open: true, orderId, message: gps.error });
      return;
    }
    await submitOnTheWay(orderId, gps.lat, gps.lng);
  }

  async function handleStep(orderId: string, status: 'in_progress' | 'completed') {
    setBusyId(orderId);
    setError(null);
    try {
      await apiFetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadMine();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const filtered = orders.filter((o) => {
    if (statusTab === 'accepted' && o.status !== 'accepted') return false;
    if (
      statusTab === 'active' &&
      !['on_the_way', 'in_progress', 'budgeting', 'payment_pending'].includes(o.status)
    ) {
      return false;
    }
    if (statusTab === 'completed' && o.status !== 'completed') return false;
    if (todayOnly && !String(o.scheduled_at || '').startsWith(todayStr)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.reference_code} ${o.service_name} ${o.customer_name} ${o.service_address}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PortalLayout
      title="Minha Agenda de Serviços"
      breadcrumb="Portal do Técnico"
      primaryAction={
        <Link
          to="/tecnico/disponiveis"
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          Ver Mural Disponíveis
        </Link>
      }
    >
      <div className="space-y-4">
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {toast}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'Todas'],
                ['accepted', 'Aceites'],
                ['active', 'Em Curso / Caminho'],
                ['completed', 'Concluídas'],
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

            <button
              type="button"
              onClick={() => setTodayOnly((v) => !v)}
              className={`ml-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                todayOnly
                  ? 'border-slate-900 bg-slate-100 text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {todayOnly ? 'Apenas Hoje' : 'Hoje'}
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar ref., morada ou cliente..."
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Nenhum serviço encontrado com os filtros aplicados.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((o) => {
              const isPreferred = user && o.preferred_technician_id === user.id;
              const duration = calcDuration(o.tech_arrived_at, o.completed_at);
              return (
                <div
                  key={o.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-slate-600">
                            {o.reference_code}
                          </span>
                          {isPreferred && (
                            <span className="inline-flex items-center gap-1 font-semibold text-violet-700">
                              <Star className="h-3.5 w-3.5 fill-violet-600" />
                              <span>Cliente pediu você</span>
                            </span>
                          )}
                          {duration && (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 tabular-nums">
                              <Clock className="h-3 w-3" />
                              <span>{duration}</span>
                            </span>
                          )}
                        </div>
                        <Link
                          to={`/tecnico/agenda/${o.id}`}
                          className="mt-1 block text-base font-semibold text-slate-900 hover:underline"
                        >
                          {o.service_name}
                        </Link>
                      </div>

                      <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-right tabular-nums shrink-0">
                        <span className="block text-[11px] font-medium text-emerald-700">
                          Seu Ganho
                        </span>
                        <span className="text-base font-bold text-emerald-800">
                          {formatEUR(o.technician_payout)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <ServiceStatusLabel status={o.status} />
                      <QuoteStatusLabel status={o.quote_status} />
                    </div>

                    <div className="space-y-1 text-xs text-slate-600">
                      <div>
                        <strong className="text-slate-800">Morada:</strong> {o.service_address}
                      </div>
                      <div>
                        <strong className="text-slate-800">Agendado:</strong>{' '}
                        <span className="tabular-nums">{formatDatePT(o.scheduled_at, true)}</span>
                      </div>
                      <div>
                        <strong className="text-slate-800">Cliente:</strong> {o.customer_name} (
                        {o.customer_phone || '—'})
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    {o.status === 'accepted' && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => handleOnTheWay(o.id)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        <Navigation className="h-3.5 w-3.5" />
                        <span>A Caminho (Iniciar Km)</span>
                      </button>
                    )}

                    {o.status === 'on_the_way' && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => handleStep(o.id, 'in_progress')}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        <span>Cheguei no Local</span>
                      </button>
                    )}

                    {(o.status === 'in_progress' || o.status === 'budgeting') && (
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => handleStep(o.id, 'completed')}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Concluir Serviço</span>
                      </button>
                    )}

                    <Link
                      to={`/tecnico/agenda/${o.id}`}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Abrir / Orçamento & Chat
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <GpsPermissionPrompt
        open={gpsPrompt.open}
        errorMessage={gpsPrompt.message}
        onClose={() => setGpsPrompt({ open: false, orderId: '' })}
        onRetry={async () => {
          const id = gpsPrompt.orderId;
          setGpsPrompt({ open: false, orderId: '' });
          if (id) await handleOnTheWay(id);
        }}
        onUseFallback={async () => {
          const id = gpsPrompt.orderId;
          setGpsPrompt({ open: false, orderId: '' });
          if (id) await submitOnTheWay(id);
        }}
      />
    </PortalLayout>
  );
}
