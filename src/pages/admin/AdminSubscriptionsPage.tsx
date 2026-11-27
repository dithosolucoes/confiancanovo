import React, { useEffect, useState } from 'react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceCatalogItem, ServiceSubscription, UserProfile } from '../../types/domain';
import { CalendarCheck, PauseCircle, PlayCircle, Plus, PlusCircle, Repeat, XCircle } from 'lucide-react';

export function AdminSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<ServiceSubscription[]>([]);
  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [plans, setPlans] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<ServiceSubscription | null>(null);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [preferredDay, setPreferredDay] = useState(15);
  const [createInitialOrder, setCreateInitialOrder] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [subRes, custRes, catRes] = await Promise.all([
        apiFetch<{ subscriptions: ServiceSubscription[] }>('/api/subscriptions'),
        apiFetch<{ customers: UserProfile[] }>('/api/customers'),
        apiFetch<{ catalog: ServiceCatalogItem[] }>('/api/catalog'),
      ]);
      setSubscriptions(subRes.subscriptions);
      const activeCustomers = custRes.customers.filter((c) => c.is_active);
      setCustomers(activeCustomers);
      const subCatalog = catRes.catalog.filter((c) => c.is_active && c.is_subscription);
      const resolvedPlans = subCatalog.length > 0 ? subCatalog : catRes.catalog.filter((c) => c.is_active);
      setPlans(resolvedPlans);

      if (activeCustomers[0] && !selectedCustomerId) {
        setSelectedCustomerId(activeCustomers[0].id);
        setServiceAddress(activeCustomers[0].address || '');
      }
      if (resolvedPlans[0] && !selectedCatalogId) {
        setSelectedCatalogId(resolvedPlans[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar subscrições.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreateModal() {
    setModalError('');
    const firstCust = customers.find((c) => c.id === selectedCustomerId) || customers[0];
    if (firstCust) {
      setSelectedCustomerId(firstCust.id);
      if (!serviceAddress && firstCust.address) {
        setServiceAddress(firstCust.address);
      }
    }
    if (!selectedCatalogId && plans[0]) {
      setSelectedCatalogId(plans[0].id);
    }
    setCreateOpen(true);
  }

  async function handleCreateSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomerId) {
      setModalError('Selecione um cliente.');
      return;
    }
    if (!serviceAddress.trim()) {
      setModalError('Indique a morada do serviço recorrente.');
      return;
    }
    setSubmitting(true);
    setModalError('');
    setMessage('');
    try {
      const res = await apiFetch<{
        subscription: ServiceSubscription;
        initialOrder?: { reference_code: string } | null;
      }>('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: selectedCustomerId,
          catalog_id: selectedCatalogId,
          service_address: serviceAddress,
          preferred_day: preferredDay,
          create_initial_order: createInitialOrder,
        }),
      });
      setCreateOpen(false);
      setMessage(
        res.initialOrder
          ? `Subscrição criada com 1.ª ordem ${res.initialOrder.reference_code} gerada.`
          : 'Subscrição criada com sucesso.'
      );
      await load();
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao criar subscrição.');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(sub: ServiceSubscription, status: 'active' | 'paused' | 'cancelled') {
    setBusyId(sub.id);
    setError('');
    setMessage('');
    try {
      await apiFetch(`/api/subscriptions/${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setConfirmCancel(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar subscrição.');
    } finally {
      setBusyId(null);
    }
  }

  async function generateMonthlyOrder(sub: ServiceSubscription) {
    setBusyId(sub.id);
    setError('');
    setMessage('');
    try {
      const res = await apiFetch<{ order: { reference_code: string } }>(
        `/api/subscriptions/${sub.id}/generate-order`,
        { method: 'POST' }
      );
      setMessage(`Ordem ${res.order.reference_code} gerada para ${sub.customer_name}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar ordem mensal.');
    } finally {
      setBusyId(null);
    }
  }

  const activeSubs = subscriptions.filter((s) => s.status === 'active');
  const mrr = activeSubs.reduce((s, x) => s + Number(x.monthly_price || 0), 0);

  return (
    <PortalLayout
      title="Subscrições & Planos Recorrentes"
      breadcrumb="Planos Mensais"
      primaryAction={
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Nova Subscrição</span>
        </button>
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Subscrições Ativas</span>
            <Repeat className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {activeSubs.length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">Receita Mensal Recorrente (MRR)</div>
          <div className="mt-2 font-display text-2xl font-semibold text-emerald-700 tabular-nums">
            {formatEUR(mrr)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Total de Contratos</span>
            <CalendarCheck className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {subscriptions.length}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente / Morada</th>
                <th className="px-4 py-3 font-medium">Plano</th>
                <th className="px-4 py-3 font-medium">Valor Mensal</th>
                <th className="px-4 py-3 font-medium">Dia / Próx. Ciclo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    A carregar subscrições...
                  </td>
                </tr>
              ) : subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Sem subscrições registadas.
                  </td>
                </tr>
              ) : (
                subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{sub.customer_name}</div>
                      <div className="text-xs text-slate-500">
                        {sub.customer_phone || sub.customer_email || '—'}
                      </div>
                      <div className="text-xs text-slate-500 truncate max-w-[260px]">
                        {sub.service_address}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="font-medium">{sub.plan_name}</div>
                      {sub.last_order_generated_at && (
                        <div className="text-[11px] text-slate-400 tabular-nums">
                          Última OS: {formatDatePT(sub.last_order_generated_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                      {formatEUR(sub.monthly_price)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                      <div>Dia {sub.preferred_day} de cada mês</div>
                      <div className="text-slate-400">Próx.: {formatDatePT(sub.next_billing_date)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      <span
                        className={
                          sub.status === 'active'
                            ? 'text-emerald-700'
                            : sub.status === 'paused'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                        }
                      >
                        {sub.status === 'active'
                          ? 'Ativa'
                          : sub.status === 'paused'
                          ? 'Pausada'
                          : 'Cancelada'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {sub.status === 'active' && (
                          <button
                            type="button"
                            disabled={busyId === sub.id}
                            onClick={() => generateMonthlyOrder(sub)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            <PlusCircle className="h-3.5 w-3.5" />
                            Gerar Ordem
                          </button>
                        )}
                        {sub.status === 'active' && (
                          <button
                            type="button"
                            disabled={busyId === sub.id}
                            onClick={() => updateStatus(sub, 'paused')}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <PauseCircle className="h-3.5 w-3.5" />
                            Pausar
                          </button>
                        )}
                        {sub.status === 'paused' && (
                          <button
                            type="button"
                            disabled={busyId === sub.id}
                            onClick={() => updateStatus(sub, 'active')}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            <PlayCircle className="h-3.5 w-3.5" />
                            Reativar
                          </button>
                        )}
                        {sub.status !== 'cancelled' && (
                          <button
                            type="button"
                            disabled={busyId === sub.id}
                            onClick={() => setConfirmCancel(sub)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Subscription Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Nova Subscrição Mensal</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Fechar
              </button>
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateSubscription} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Cliente B2C</label>
                <select
                  required
                  value={selectedCustomerId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedCustomerId(nextId);
                    const found = customers.find((c) => c.id === nextId);
                    if (found?.address) setServiceAddress(found.address);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {customers.length === 0 && <option value="">Sem clientes ativos</option>}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Plano Recorrente</label>
                <select
                  required
                  value={selectedCatalogId}
                  onChange={(e) => setSelectedCatalogId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatEUR(p.subscription_price || p.base_service_fee)}/mês
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Morada da Prestação Mensal
                </label>
                <input
                  type="text"
                  required
                  value={serviceAddress}
                  onChange={(e) => setServiceAddress(e.target.value)}
                  placeholder="Morada completa em Lisboa / Margem Sul"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Dia Preferido de Visita (1–28)
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  required
                  value={preferredDay}
                  onChange={(e) => setPreferredDay(Number(e.target.value))}
                  className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>

              <label className="flex items-center gap-2 pt-1 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createInitialOrder}
                  onChange={(e) => setCreateInitialOrder(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Gerar 1.ª ordem de serviço mensal imediatamente</span>
              </label>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || customers.length === 0}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {submitting ? 'A criar...' : 'Ativar Subscrição'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmCancel)}
        title="Cancelar Subscrição?"
        description={`Confirma o cancelamento da subscrição de ${confirmCancel?.customer_name || ''} (${confirmCancel?.plan_name || ''})?`}
        confirmLabel="Cancelar Subscrição"
        variant="danger"
        loading={Boolean(busyId)}
        onConfirm={() => confirmCancel && updateStatus(confirmCancel, 'cancelled')}
        onCancel={() => setConfirmCancel(null)}
      />
    </PortalLayout>
  );
}
