import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ApplianceNifFields } from '../../components/ApplianceNifFields';
import { QuoteStatusLabel, ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type {
  Organization,
  ServiceCatalogItem,
  ServiceOrder,
  UserProfile,
} from '../../types/domain';

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewScope, setViewScope] = useState<'active' | 'trash'>('active');
  const [statusFilter, setStatusFilter] = useState('all');
  const [quoteFilter, setQuoteFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Create order modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState('');
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);

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
  const [requesterOrgId, setRequesterOrgId] = useState('');
  const [providerOrgId, setProviderOrgId] = useState('org-matrix');
  const [techId, setTechId] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [serviceKind, setServiceKind] = useState<'avulso' | 'sequencia' | 'recorrente'>('avulso');
  const [applianceType, setApplianceType] = useState('');
  const [customerNif, setCustomerNif] = useState('');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        quoteStatus: quoteFilter,
        search,
      });
      if (viewScope === 'trash') {
        params.set('includeDeleted', 'only');
      }
      const res = await apiFetch<{ orders: ServiceOrder[] }>(`/api/orders?${params}`);
      setOrders(res.orders);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar ordens.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, quoteFilter, search, viewScope]);

  async function handleRestoreOrder(orderId: string) {
    setError('');
    try {
      await apiFetch(`/api/orders/${orderId}/restore`, { method: 'POST' });
      loadOrders();
    } catch (err: any) {
      setError(err?.message || 'Erro ao restaurar ordem.');
    }
  }

  async function handleQuickAssignTech(order: ServiceOrder, nextTechId: string) {
    setError('');
    try {
      const nextStatus =
        nextTechId && order.status === 'pending' ? 'accepted' : order.status;
      await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          technician_id: nextTechId || null,
          status: nextStatus,
        }),
      });
      loadOrders();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atribuir técnico.');
    }
  }

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    Promise.all([
      apiFetch<{ catalog: ServiceCatalogItem[] }>('/api/catalog'),
      apiFetch<{ technicians: UserProfile[] }>('/api/technicians'),
      apiFetch<{ organizations: Organization[] }>('/api/organizations'),
    ]).then(([c, t, o]) => {
      setCatalog(c.catalog);
      if (c.catalog[0]) setCatalogId(c.catalog[0].id);
      setTechnicians(t.technicians);
      setOrgs(o.organizations);
    });
  }, []);

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          catalog_id: catalogId,
          customer_name: customerName,
          customer_phone: customerPhone,
          service_address: serviceAddress,
          address_complement: addressComplement,
          postal_code: postalCode,
          localidade,
          scheduled_at: new Date(scheduledAt).toISOString(),
          requester_org_id: requesterOrgId || null,
          provider_org_id: providerOrgId,
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
      setDescription('');
      loadOrders();
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao criar ordem.');
    }
  }

  return (
    <PortalLayout
      title="Ordens de Serviço"
      breadcrumb="Operacional"
      primaryAction={
        <button
          type="button"
          onClick={() => {
            setModalError('');
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
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}
        {/* Segmented Active vs Trash */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setViewScope('active')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                viewScope === 'active'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ordens Ativas
            </button>
            <button
              type="button"
              onClick={() => setViewScope('trash')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                viewScope === 'trash'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Lixeira / Eliminados</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar ref., cliente, serviço ou morada..."
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <option value="all">Todos Estados Operacionais</option>
            <option value="pending">Aguardando Técnico</option>
            <option value="accepted">Aceite</option>
            <option value="on_the_way">A Caminho</option>
            <option value="in_progress">No Local / Em Curso</option>
            <option value="budgeting">Em Orçamentação</option>
            <option value="payment_pending">Aguarda Pagamento</option>
            <option value="completed">Concluído</option>
            <option value="cancelled">Cancelado</option>
          </select>

          <select
            value={quoteFilter}
            onChange={(e) => setQuoteFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <option value="all">Todos Estados Orçamento</option>
            <option value="none">Sem Orçamento</option>
            <option value="sent">Enviado</option>
            <option value="accepted">Aprovado</option>
            <option value="rejected">Recusado</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ref.</th>
                  <th className="px-4 py-3">Serviço & Morada</th>
                  <th className="px-4 py-3">Cliente / Parceiro</th>
                  <th className="px-4 py-3">Técnico</th>
                  <th className="px-4 py-3">Operacional</th>
                  <th className="px-4 py-3">Orçamento</th>
                  <th className="px-4 py-3 text-right">Total c/ IVA</th>
                  <th className="px-4 py-3 text-right">
                    {viewScope === 'trash' ? 'Restaurar' : 'Repasse'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      A carregar ordens de serviço...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhuma ordem encontrada com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <Link to={`/admin/servicos/${o.id}`} className="hover:underline">
                          {o.reference_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/servicos/${o.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {o.service_name}
                        </Link>
                        <div className="text-xs text-slate-500 truncate max-w-xs">
                          {o.service_address}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-slate-800">{o.customer_name}</div>
                        <div className="text-slate-500">
                          {o.requester_org_name || 'Particular B2C'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {viewScope === 'trash' ? (
                          <div>{o.technician_name || 'Por atribuir'}</div>
                        ) : (
                          <select
                            aria-label={`Atribuir técnico para ${o.reference_code}`}
                            value={o.technician_id || ''}
                            onChange={(e) => handleQuickAssignTech(o, e.target.value)}
                            className="w-40 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                          >
                            <option value="">Mural (Por atribuir)</option>
                            {technicians.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.full_name}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="mt-0.5 text-[11px] text-slate-400">{o.provider_org_name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusLabel status={o.status} />
                      </td>
                      <td className="px-4 py-3">
                        <QuoteStatusLabel status={o.quote_status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatEUR(o.total_customer_amount)}
                        <div className="text-[11px] font-normal text-slate-400">
                          IVA {o.vat_rate}% · {formatDatePT(o.scheduled_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-700 tabular-nums whitespace-nowrap">
                        {viewScope === 'trash' ? (
                          <button
                            type="button"
                            onClick={() => handleRestoreOrder(o.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Restaurar</span>
                          </button>
                        ) : (
                          formatEUR(o.technician_payout)
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Order Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Criar Nova Ordem de Serviço
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

            <form onSubmit={handleCreateOrder} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Serviço do Catálogo</label>
                  <select
                    value={catalogId}
                    onChange={(e) => setCatalogId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.category} — {c.name} (Taxa {formatEUR(c.base_service_fee)} · IVA {c.default_vat_rate}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Nome do Cliente</label>
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
                  <label className="block text-xs font-medium text-slate-700">Rua / Avenida / N.º</label>
                  <input
                    type="text"
                    required
                    value={serviceAddress}
                    onChange={(e) => setServiceAddress(e.target.value)}
                    placeholder="Ex: Av. da República, 45"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Andar / Porta / Compl.</label>
                  <input
                    type="text"
                    value={addressComplement}
                    onChange={(e) => setAddressComplement(e.target.value)}
                    placeholder="Ex: 3º Esq."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Código Postal</label>
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      placeholder="1050-189"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Localidade</label>
                    <input
                      type="text"
                      value={localidade}
                      onChange={(e) => setLocalidade(e.target.value)}
                      placeholder="Lisboa"
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

                <div>
                  <label className="block text-xs font-medium text-slate-700">Parceiro Solicitante (Opcional)</label>
                  <select
                    value={requesterOrgId}
                    onChange={(e) => setRequesterOrgId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Cliente Particular B2C</option>
                    {orgs
                      .filter((o) => o.org_type === 'partner_client')
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Executor / Centro Técnico</label>
                  <select
                    value={providerOrgId}
                    onChange={(e) => setProviderOrgId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {orgs
                      .filter((o) => o.org_type !== 'partner_client')
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.custom_payout_percentage}%)
                        </option>
                      ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Atribuir Técnico (Opcional)</label>
                  <select
                    value={techId}
                    onChange={(e) => setTechId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Deixar no Mural Disponível</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.organization_name || 'Autônomo'})
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

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Criar Ordem
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
