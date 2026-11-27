import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Edit3, Plus, Search, XCircle } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PortalLayout } from '../../components/PortalLayout';
import { QuoteStatusLabel, ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceOrder } from '../../types/domain';

export function PartnerOrdersPage() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<'all' | 'pending' | 'active' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [editingOrder, setEditingOrder] = useState<ServiceOrder | null>(null);
  const [editAddress, setEditAddress] = useState('');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<ServiceOrder | null>(null);

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await apiFetch<{ orders: ServiceOrder[] }>('/api/orders');
      setOrders(res.orders);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  function openEditModal(o: ServiceOrder) {
    setEditingOrder(o);
    setEditAddress(o.service_address);
    setEditCustomerName(o.customer_name);
    setEditCustomerPhone(o.customer_phone || '');
    setEditDescription(o.description || '');
    setError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingOrder) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/orders/${editingOrder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          service_address: editAddress,
          customer_name: editCustomerName,
          customer_phone: editCustomerPhone,
          description: editDescription,
        }),
      });
      setEditingOrder(null);
      await loadOrders();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelOrder() {
    if (!cancelTarget) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/orders/${cancelTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      setCancelTarget(null);
      await loadOrders();
    } catch (err: any) {
      setCancelTarget(null);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = orders.filter((o) => {
    if (statusTab === 'pending' && o.status !== 'pending') return false;
    if (
      statusTab === 'active' &&
      !['accepted', 'on_the_way', 'in_progress', 'budgeting', 'payment_pending'].includes(o.status)
    ) {
      return false;
    }
    if (statusTab === 'completed' && o.status !== 'completed') return false;
    if (statusTab === 'cancelled' && o.status !== 'cancelled') return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.reference_code} ${o.service_name} ${o.service_address} ${o.customer_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PortalLayout
      title="Acompanhamento de Chamados"
      breadcrumb="Portal Parceiro"
      primaryAction={
        <Link
          to="/parceiro/novo-pedido"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Novo Chamado</span>
        </Link>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'Todos'],
                ['pending', 'Pendentes'],
                ['active', 'Em Curso'],
                ['completed', 'Concluídos'],
                ['cancelled', 'Cancelados'],
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
              placeholder="Pesquisar ref., imóvel ou contacto..."
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ref.</th>
                  <th className="px-4 py-3">Imóvel & Serviço</th>
                  <th className="px-4 py-3">Agendado</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Orçamento</th>
                  <th className="px-4 py-3 text-right">Total c/ IVA</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                      A carregar chamados...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhum chamado encontrado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">
                        <Link to={`/parceiro/servicos/${o.id}`} className="hover:underline">
                          {o.reference_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/parceiro/servicos/${o.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {o.service_name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {o.service_address} · {o.customer_name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                        {formatDatePT(o.scheduled_at, true)}
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusLabel status={o.status} />
                      </td>
                      <td className="px-4 py-3">
                        <QuoteStatusLabel status={o.quote_status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                        {formatEUR(o.total_customer_amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {o.status === 'pending' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(o)}
                              className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              title="Editar pendente"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setCancelTarget(o)}
                              className="rounded border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                              title="Cancelar chamado"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Link
                            to={`/parceiro/servicos/${o.id}`}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                          >
                            Ver
                          </Link>
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

      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Editar Chamado Pendente · {editingOrder.reference_code}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Morada do Imóvel</label>
                <input
                  type="text"
                  required
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Contacto</label>
                  <input
                    type="text"
                    required
                    value={editCustomerName}
                    onChange={(e) => setEditCustomerName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
                  <input
                    type="text"
                    value={editCustomerPhone}
                    onChange={(e) => setEditCustomerPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Descrição</label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        variant="danger"
        loading={saving}
        title="Cancelar este chamado?"
        description={
          cancelTarget
            ? `O chamado ${cancelTarget.reference_code} (${cancelTarget.service_name}) será cancelado.`
            : ''
        }
        confirmLabel="Confirmar Cancelamento"
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => void handleCancelOrder()}
      />
    </PortalLayout>
  );
}
