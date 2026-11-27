import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { ServiceOrder } from '../../types/domain';
import { CheckCircle2, FileCheck2, Receipt, Search, Undo2, X } from 'lucide-react';

export function AdminInvoicingPage() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'invoiced' | 'pending_invoice'>('all');
  const [baixaFilter, setBaixaFilter] = useState<'all' | 'received' | 'pending_baixa'>('all');

  const [invoiceOrder, setInvoiceOrder] = useState<ServiceOrder | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmUndoBaixa, setConfirmUndoBaixa] = useState<ServiceOrder | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (invoiceFilter !== 'all') qs.set('invoiceFilter', invoiceFilter);
      if (baixaFilter !== 'all') qs.set('baixaFilter', baixaFilter);
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiFetch<{ orders: ServiceOrder[] }>(`/api/orders?${qs.toString()}`);
      setOrders(res.orders);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar ordens para faturação.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [invoiceFilter, baixaFilter]);

  function openInvoiceModal(o: ServiceOrder) {
    setInvoiceOrder(o);
    setInvoiceNumber(o.invoice_number || `FT 2026/${o.reference_code.replace('WO-2026-', '')}`);
    setInvoiceDate(o.invoice_issued_at || new Date().toISOString().split('T')[0]);
  }

  async function saveInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceOrder) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/orders/${invoiceOrder.id}/invoice`, {
        method: 'POST',
        body: JSON.stringify({
          invoice_number: invoiceNumber,
          invoice_issued_at: invoiceDate,
        }),
      });
      setInvoiceOrder(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao registar fatura.');
    } finally {
      setSaving(false);
    }
  }

  async function markBaixa(order: ServiceOrder) {
    setError('');
    try {
      await apiFetch(`/api/orders/${order.id}/baixa`, {
        method: 'POST',
        body: JSON.stringify({ received_at: new Date().toISOString().split('T')[0] }),
      });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao registar baixa de recebimento.');
    }
  }

  async function undoBaixa() {
    if (!confirmUndoBaixa) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/orders/${confirmUndoBaixa.id}/baixa`, {
        method: 'POST',
        body: JSON.stringify({ undo: true }),
      });
      setConfirmUndoBaixa(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao estornar baixa.');
    } finally {
      setSaving(false);
    }
  }

  const completed = orders.filter((o) => o.status === 'completed');
  const invoicedCount = completed.filter((o) => Boolean(o.invoice_number)).length;
  const pendingInvoiceAmount = completed
    .filter((o) => !o.invoice_number)
    .reduce((s, o) => s + Number(o.total_customer_amount || 0), 0);
  const pendingBaixaAmount = completed
    .filter((o) => !o.baixa_received_at)
    .reduce((s, o) => s + Number(o.total_customer_amount || 0), 0);

  return (
    <PortalLayout title="Faturação & Baixa de Recebimentos" breadcrumb="Financeiro Fiscal">
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Ordens Concluídas Faturadas</span>
            <FileCheck2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {invoicedCount} / {completed.length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Aguardando Emissão de Fatura</span>
            <Receipt className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-amber-700 tabular-nums">
            {formatEUR(pendingInvoiceAmount)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">Pendente de Baixa (Recebimento)</div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {formatEUR(pendingBaixaAmount)}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="relative flex-1 min-w-[220px] max-w-md"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar referência, cliente ou serviço..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
          />
        </form>

        <select
          value={invoiceFilter}
          onChange={(e) => setInvoiceFilter(e.target.value as any)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">Faturação: Todas</option>
          <option value="pending_invoice">Por Faturar</option>
          <option value="invoiced">Faturadas</option>
        </select>

        <select
          value={baixaFilter}
          onChange={(e) => setBaixaFilter(e.target.value as any)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">Recebimento: Todos</option>
          <option value="pending_baixa">Pendente de Baixa</option>
          <option value="received">Baixa Efetuada</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Ordem / Cliente</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Total c/ IVA</th>
                <th className="px-4 py-3 font-medium">Fatura Emitida</th>
                <th className="px-4 py-3 font-medium">Baixa Recebimento</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    A carregar registos...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Nenhuma ordem encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/servicos/${o.id}`}
                        className="font-mono text-xs font-semibold text-slate-900 hover:underline"
                      >
                        {o.reference_code}
                      </Link>
                      <div className="font-medium text-slate-900">{o.customer_name}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[260px]">
                        {o.service_name}
                        {o.requester_org_name ? ` · ${o.requester_org_name}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ServiceStatusLabel status={o.status} />
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                      {formatEUR(o.total_customer_amount)}
                      <div className="text-[11px] font-sans font-normal text-slate-400">
                        IVA {o.vat_rate}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {o.invoice_number ? (
                        <div>
                          <div className="font-mono font-semibold text-slate-900">
                            {o.invoice_number}
                          </div>
                          <div className="text-slate-400 tabular-nums">
                            {formatDatePT(o.invoice_issued_at)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-amber-700 font-medium">Pendente</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {o.baixa_received_at ? (
                        <div>
                          <span className="font-medium text-emerald-700">Recebido</span>
                          <div className="text-slate-400 tabular-nums">
                            {formatDatePT(o.baixa_received_at)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">Em aberto</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openInvoiceModal(o)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          {o.invoice_number ? 'Editar Fatura' : 'Emitir Fatura'}
                        </button>
                        {o.baixa_received_at ? (
                          <button
                            type="button"
                            onClick={() => setConfirmUndoBaixa(o)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            Estornar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markBaixa(o)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Dar Baixa
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

      {invoiceOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={saveInvoice}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Registar Fatura — {invoiceOrder.reference_code}
              </h3>
              <button
                type="button"
                onClick={() => setInvoiceOrder(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Número da Fatura (ex: FT 2026/001)
                </label>
                <input
                  required
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Data de Emissão
                </label>
                <input
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInvoiceOrder(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'A guardar...' : 'Guardar Fatura'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmUndoBaixa)}
        title="Estornar Baixa de Recebimento?"
        description={`Confirma remover a baixa de recebimento da ordem ${confirmUndoBaixa?.reference_code || ''}?`}
        confirmLabel="Estornar Baixa"
        variant="danger"
        loading={saving}
        onConfirm={undoBaixa}
        onCancel={() => setConfirmUndoBaixa(null)}
      />
    </PortalLayout>
  );
}
