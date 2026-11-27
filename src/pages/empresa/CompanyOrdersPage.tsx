import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ApplianceNifFields } from '../../components/ApplianceNifFields';
import { QuoteStatusLabel, ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceCatalogItem, ServiceOrder, UserProfile } from '../../types/domain';

export function CompanyOrdersPage() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [techs, setTechs] = useState<UserProfile[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [techFilter, setTechFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  // Create order modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [catalogId, setCatalogId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [localidade, setLocalidade] = useState('');
  const [scheduledAt, setScheduledAt] = useState(
    new Date(Date.now() + 3600 * 1000 * 4).toISOString().slice(0, 16)
  );
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [serviceKind, setServiceKind] = useState<'avulso' | 'sequencia' | 'recorrente'>('avulso');
  const [applianceType, setApplianceType] = useState('');
  const [customerNif, setCustomerNif] = useState('');
  const [techId, setTechId] = useState('');
  const [description, setDescription] = useState('');

  async function loadAll() {
    setError(null);
    try {
      const [o, t, c] = await Promise.all([
        apiFetch<{ orders: ServiceOrder[] }>('/api/orders'),
        apiFetch<{ technicians: UserProfile[] }>('/api/technicians'),
        apiFetch<{ catalog: ServiceCatalogItem[] }>('/api/catalog'),
      ]);
      setOrders(o.orders);
      setTechs(t.technicians);
      const activeCat = c.catalog.filter((item) => item.is_active && !item.is_subscription);
      setCatalog(activeCat);
      if (activeCat[0] && !catalogId) {
        setCatalogId(activeCat[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar ordens do centro técnico.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function assignTech(orderId: string, technicianId: string) {
    setError(null);
    try {
      await apiFetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ technician_id: technicianId || null }),
      });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atribuir técnico.');
    }
  }

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setModalError(null);
    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          catalog_id: catalogId,
          customer_name: customerName,
          customer_phone: customerPhone,
          service_address: serviceAddress,
          address_complement: addressComplement || null,
          postal_code: postalCode || null,
          localidade: localidade || null,
          scheduled_at: new Date(scheduledAt).toISOString(),
          technician_id: techId || null,
          description,
          urgency,
          service_kind: serviceKind,
          appliance_type: applianceType,
          customer_nif: customerNif,
        }),
      });
      setModalOpen(false);
      setCustomerName('');
      setCustomerPhone('');
      setServiceAddress('');
      setAddressComplement('');
      setPostalCode('');
      setLocalidade('');
      setTechId('');
      setDescription('');
      await loadAll();
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao criar ordem da empresa.');
    } finally {
      setSaving(false);
    }
  }

  const filtered = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (techFilter === 'unassigned' && o.technician_id) return false;
    if (techFilter !== 'all' && techFilter !== 'unassigned' && o.technician_id !== techFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.reference_code} ${o.service_name} ${o.service_address} ${o.customer_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PortalLayout
      title="Ordens de Serviço da Empresa"
      breadcrumb="Operações"
      primaryAction={
        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Nova Ordem</span>
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar ref., morada ou serviço..."
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              <option value="all">Todos os Estados</option>
              <option value="pending">Aguardando</option>
              <option value="accepted">Aceite</option>
              <option value="on_the_way">A Caminho</option>
              <option value="in_progress">Em Curso</option>
              <option value="budgeting">Orçamentação</option>
              <option value="payment_pending">Aguardando Pgto</option>
              <option value="completed">Concluído</option>
              <option value="cancelled">Cancelado</option>
            </select>

            <select
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              <option value="all">Todos os Técnicos</option>
              <option value="unassigned">Por Atribuir</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ref.</th>
                  <th className="px-4 py-3">Serviço & Morada</th>
                  <th className="px-4 py-3">Distribuir Técnico</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Orçamento</th>
                  <th className="px-4 py-3 text-right">Repasse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhuma ordem encontrada para os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filtered.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">
                        <Link to={`/empresa/servicos/${o.id}`} className="hover:underline">
                          {o.reference_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/empresa/servicos/${o.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {o.service_name}
                        </Link>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {o.service_address} · {formatDatePT(o.scheduled_at, true)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.technician_id || ''}
                          onChange={(e) => assignTech(o.id, e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value="">Por atribuir (Mural Interno)</option>
                          {techs.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.full_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusLabel status={o.status} />
                      </td>
                      <td className="px-4 py-3">
                        <QuoteStatusLabel status={o.quote_status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">
                        {formatEUR(o.technician_payout)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Company Order Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Nova Ordem do Centro Técnico
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateOrder} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Serviço do Catálogo
                  </label>
                  <select
                    value={catalogId}
                    onChange={(e) => setCatalogId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.category} — {c.name} (Taxa {formatEUR(c.base_service_fee)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Nome do Cliente
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Morada da Intervenção
                  </label>
                  <input
                    type="text"
                    required
                    value={serviceAddress}
                    onChange={(e) => setServiceAddress(e.target.value)}
                    placeholder="Ex: Rua Capitão Leitão, 42"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Andar / Complemento
                  </label>
                  <input
                    type="text"
                    value={addressComplement}
                    onChange={(e) => setAddressComplement(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Cód. Postal</label>
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Localidade</label>
                    <input
                      type="text"
                      value={localidade}
                      onChange={(e) => setLocalidade(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Data e Hora</label>
                  <input
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Urgência</label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as 'normal' | 'urgent')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="normal">Agendado Normal</option>
                    <option value="urgent">Urgente (24h)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Tipo de Serviço</label>
                  <select
                    value={serviceKind}
                    onChange={(e) => setServiceKind(e.target.value as 'avulso' | 'sequencia' | 'recorrente')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="avulso">Avulso (uma visita)</option>
                    <option value="sequencia">Em sequência (várias visitas)</option>
                    <option value="recorrente">Recorrente (manutenção)</option>
                  </select>
                </div>

                <ApplianceNifFields
                  appliance={applianceType}
                  onApplianceChange={setApplianceType}
                  nif={customerNif}
                  onNifChange={setCustomerNif}
                />

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Técnico da Empresa (Opcional)
                  </label>
                  <select
                    value={techId}
                    onChange={(e) => setTechId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Deixar no Mural Interno da Empresa</option>
                    {techs
                      .filter((t) => t.is_active)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.full_name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Descrição</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'A criar...' : 'Criar Ordem'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
