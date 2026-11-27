import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, PauseCircle } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PortalLayout } from '../../components/PortalLayout';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceOrder } from '../../types/domain';

export function TechAvailablePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<ServiceOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missingProfile: string[] = [];
  if (user?.role === 'technician') {
    if (!user.nif?.trim()) missingProfile.push('NIF');
    if (!user.iban?.trim()) missingProfile.push('IBAN');
    if (!user.emergency_contact?.trim()) missingProfile.push('Contacto de Emergência');
  }
  const isBlocked = Boolean(user?.is_paused) || missingProfile.length > 0;

  async function loadAvailable() {
    setLoading(true);
    try {
      const res = await apiFetch<{ orders: ServiceOrder[] }>('/api/orders?scope=available');
      setOrders(res.orders);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAvailable();
  }, []);

  async function handleAccept(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' }),
      });
      setConfirmOrder(null);
      navigate(`/tecnico/agenda/${id}`);
    } catch (err: any) {
      setConfirmOrder(null);
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PortalLayout title="Mural de Serviços Disponíveis" breadcrumb="Portal do Técnico">
      <div className="space-y-4">
        {user?.is_paused && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <PauseCircle className="h-4 w-4 text-amber-700 shrink-0" />
              <span>
                <strong>Conta em Pausa:</strong> a receção de chamados está pausada no seu perfil.
              </span>
            </div>
            <Link
              to="/tecnico/perfil"
              className="rounded-lg bg-amber-700 px-3 py-1.5 font-semibold text-white hover:bg-amber-800"
            >
              Reativar no Perfil
            </Link>
          </div>
        )}

        {missingProfile.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
              <span>
                Para aceitar serviços, complete no seu perfil: <strong>{missingProfile.join(', ')}</strong>.
              </span>
            </div>
            <Link
              to="/tecnico/perfil"
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
            >
              Completar Perfil
            </Link>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
            <span>{error}</span>
            <Link to="/tecnico/perfil" className="font-semibold underline">
              Ir para o Perfil
            </Link>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-900">
              Não existem serviços pendentes disponíveis neste momento.
            </p>
            <Link
              to="/tecnico/agenda"
              className="mt-3 inline-block text-xs font-medium text-slate-600 underline hover:text-slate-900"
            >
              Ir para a Minha Agenda
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs font-semibold text-slate-500">
                        {o.reference_code} · {o.urgency === 'urgent' ? 'Urgente' : 'Agendado'}
                      </div>
                      <h3 className="mt-1 text-base font-semibold text-slate-900">
                        {o.service_name}
                      </h3>
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

                  <div className="space-y-1 text-xs text-slate-600">
                    <div>
                      <strong className="text-slate-800">Morada:</strong> {o.service_address}
                      {o.localidade ? ` (${o.localidade})` : ''}
                    </div>
                    <div>
                      <strong className="text-slate-800">Agendado:</strong>{' '}
                      <span className="tabular-nums">{formatDatePT(o.scheduled_at, true)}</span>
                    </div>
                    <p className="pt-1 text-slate-500">{o.description}</p>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4">
                  <Link
                    to={`/tecnico/agenda/${o.id}`}
                    className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Ver Detalhes
                  </Link>
                  <button
                    type="button"
                    disabled={busyId === o.id || isBlocked}
                    onClick={() => setConfirmOrder(o)}
                    className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busyId === o.id ? 'A aceitar...' : 'Aceitar Serviço'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOrder !== null}
        title="Aceitar este serviço?"
        description={
          confirmOrder
            ? `Ao aceitar ${confirmOrder.reference_code} (${confirmOrder.service_name}), o serviço entra diretamente na sua agenda com ganho previsto de ${formatEUR(confirmOrder.technician_payout)}.`
            : ''
        }
        confirmLabel="Confirmar Aceitação"
        loading={busyId !== null}
        onCancel={() => setConfirmOrder(null)}
        onConfirm={() => {
          if (confirmOrder) void handleAccept(confirmOrder.id);
        }}
      />
    </PortalLayout>
  );
}
