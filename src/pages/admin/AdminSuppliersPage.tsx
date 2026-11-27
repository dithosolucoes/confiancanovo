import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Edit2, Plus, Undo2, X } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { Supplier } from '../../types/domain';

interface ForecastItem {
  id: string;
  service_order_id: string;
  reference_code: string;
  service_name: string;
  description: string;
  quantity: number;
  supplier_unit_cost: number;
  total_supplier_cost: number;
  supplier_name: string | null;
  supplier_nif: string | null;
  is_paid_to_supplier: boolean;
  completed_at: string | null;
  ordered_at: string | null;
  lead_days: number | null;
  expected_arrival_at: string | null;
  arrived_at: string | null;
}

interface PanelPart {
  id: string;
  reference_code: string;
  service_name: string;
  description: string;
  total_supplier_cost: number;
  supplier_name: string | null;
  supplier_email: string | null;
  ordered_at: string | null;
  expected_arrival_at: string | null;
  chased_at: string | null;
  supplier_quote_status: string | null;
  days_late?: number;
  days_to_arrival?: number | null;
  days_waiting?: number | null;
  days_waiting_supplier?: number | null;
}

interface PanelQuote {
  id: string;
  reference_code: string;
  service_name: string;
  customer_name: string;
  total_customer_amount: number;
  days_waiting: number;
}

interface PartsPanelData {
  today: string;
  summary: {
    toOrder: number;
    waitingSupplier: number;
    late: number;
    arriving: number;
    quotesWaiting: number;
    quotesOver15Days: number;
    longestWaitDays: number;
    shortestWaitDays: number;
  };
  toOrder: PanelPart[];
  waitingSupplier: PanelPart[];
  late: PanelPart[];
  arriving: PanelPart[];
  quotesWaiting: PanelQuote[];
}

type PanelRow = {
  key: string;
  main: string;
  sub: string;
  badge: string;
  tone: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
};

function PanelList({ title, empty, rows }: { title: string; empty: string; rows: PanelRow[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">{title}</div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-slate-500">{empty}</div>
      ) : (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-slate-900">{r.main}</div>
                <div className="truncate text-[11px] text-slate-500">{r.sub}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={`text-[11px] font-semibold ${r.tone}`}>{r.badge}</span>
                {r.action && (
                  <button
                    type="button"
                    onClick={r.action.onClick}
                    disabled={r.action.disabled}
                    className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {r.action.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LogisticsEditor({
  item,
  onSaved,
  onError,
}: {
  item: ForecastItem;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [orderedAt, setOrderedAt] = useState(item.ordered_at || '');
  const [leadDays, setLeadDays] = useState(item.lead_days != null ? String(item.lead_days) : '');
  const [arrivedAt, setArrivedAt] = useState(item.arrived_at || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrderedAt(item.ordered_at || '');
    setLeadDays(item.lead_days != null ? String(item.lead_days) : '');
    setArrivedAt(item.arrived_at || '');
  }, [item.ordered_at, item.lead_days, item.arrived_at]);

  async function save() {
    setBusy(true);
    try {
      await apiFetch(`/api/suppliers/items/${item.id}/logistics`, {
        method: 'PATCH',
        body: JSON.stringify({
          ordered_at: orderedAt || null,
          lead_days: leadDays === '' ? null : Number(leadDays),
          arrived_at: arrivedAt || null,
        }),
      });
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Erro ao guardar logística da peça.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-[180px] space-y-1.5 text-xs">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[10px] font-medium text-slate-500">
          Encomendada
          <input
            type="date"
            value={orderedAt}
            onChange={(e) => setOrderedAt(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
          />
        </label>
        <label className="text-[10px] font-medium text-slate-500">
          Prazo (dias)
          <input
            type="number"
            min={0}
            max={365}
            value={leadDays}
            onChange={(e) => setLeadDays(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs tabular-nums"
          />
        </label>
        <label className="col-span-2 text-[10px] font-medium text-slate-500">
          Chegou em
          <input
            type="date"
            value={arrivedAt}
            onChange={(e) => setArrivedAt(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-500">
          Previsto: {item.expected_arrival_at ? formatDatePT(item.expected_arrival_at, false) : '—'}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {busy ? 'A guardar...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

export function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [panel, setPanel] = useState<PartsPanelData | null>(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [confirmPayItem, setConfirmPayItem] = useState<ForecastItem | null>(null);
  const [confirmUndoItem, setConfirmUndoItem] = useState<ForecastItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [nif, setNif] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  const [editForm, setEditForm] = useState({
    name: '',
    nif: '',
    phone: '',
    email: '',
    notes: '',
  });

  async function loadAll() {
    setError('');
    try {
      const [s, f, p] = await Promise.all([
        apiFetch<{ suppliers: Supplier[] }>('/api/suppliers'),
        apiFetch<{ forecast: ForecastItem[] }>('/api/suppliers/forecast'),
        apiFetch<PartsPanelData>('/api/suppliers/parts-panel'),
      ]);
      setSuppliers(s.suppliers);
      setForecast(f.forecast);
      setPanel(p);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar fornecedores.');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name, nif, phone, email, notes }),
      });
      setModalOpen(false);
      setName('');
      setNif('');
      setPhone('');
      setEmail('');
      setNotes('');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Erro ao registar fornecedor.');
    } finally {
      setSaving(false);
    }
  }

  function openEditSupplier(s: Supplier) {
    setEditingSupplier(s);
    setEditForm({
      name: s.name || '',
      nif: s.nif || '',
      phone: s.phone || '',
      email: s.email || '',
      notes: s.notes || '',
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSupplier) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/suppliers/${editingSupplier.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      setEditingSupplier(null);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Erro ao editar fornecedor.');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPaid() {
    if (!confirmPayItem) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/suppliers/items/${confirmPayItem.id}/mark-paid`, { method: 'POST' });
      setConfirmPayItem(null);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Erro ao dar baixa de pagamento.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUndoPaid() {
    if (!confirmUndoItem) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/suppliers/items/${confirmUndoItem.id}/undo-paid`, { method: 'POST' });
      setConfirmUndoItem(null);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Erro ao estornar pagamento.');
    } finally {
      setSaving(false);
    }
  }

  // Ações do painel de peças
  const [panelMsg, setPanelMsg] = useState<string | null>(null);
  async function panelAction(path: string, method: 'POST' | 'PATCH', body: unknown, okMsg: string) {
    setError('');
    try {
      await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      setPanelMsg(okMsg);
      window.setTimeout(() => setPanelMsg(null), 4000);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'Operação não concluída.');
    }
  }

  const totalPending = forecast
    .filter((f) => !f.is_paid_to_supplier)
    .reduce((s, f) => s + f.total_supplier_cost, 0);

  // Previsão de pagamento por semana (domingo a sábado) e por mês corrente.
  // Data de referência: chegada prevista (ou conclusão, se ainda não há previsão).
  const nowForecast = new Date();
  const weekStartIso = new Date(
    Date.UTC(nowForecast.getUTCFullYear(), nowForecast.getUTCMonth(), nowForecast.getUTCDate() - nowForecast.getUTCDay())
  )
    .toISOString()
    .slice(0, 10);
  const weekEndIso = new Date(
    Date.UTC(nowForecast.getUTCFullYear(), nowForecast.getUTCMonth(), nowForecast.getUTCDate() - nowForecast.getUTCDay() + 6)
  )
    .toISOString()
    .slice(0, 10);
  const monthPrefix = nowForecast.toISOString().slice(0, 7);
  const pendingItems = forecast.filter((f) => !f.is_paid_to_supplier);
  const dueDateOf = (f: ForecastItem) => (f.expected_arrival_at || f.completed_at || '').slice(0, 10);
  const pendingThisWeek = pendingItems
    .filter((f) => dueDateOf(f) >= weekStartIso && dueDateOf(f) <= weekEndIso)
    .reduce((s, f) => s + f.total_supplier_cost, 0);
  const pendingThisMonth = pendingItems
    .filter((f) => dueDateOf(f).slice(0, 7) === monthPrefix)
    .reduce((s, f) => s + f.total_supplier_cost, 0);

  return (
    <PortalLayout
      title="Fornecedores & Previsão de Peças"
      breadcrumb="Financeiro"
      primaryAction={
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Novo Fornecedor</span>
        </button>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}
        {panelMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {panelMsg}
          </div>
        )}

        {/* Painel de peças: atrasos, chegadas, encomendas e espera dos orçamentos */}
        {panel && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {[
                { label: 'A encomendar', value: panel.summary.toOrder, tone: 'text-slate-900' },
                { label: 'Aguardando fornecedor', value: panel.summary.waitingSupplier, tone: 'text-slate-900' },
                { label: 'Atrasadas', value: panel.summary.late, tone: 'text-rose-700' },
                { label: 'A chegar', value: panel.summary.arriving, tone: 'text-slate-900' },
                { label: 'Orçamentos em espera', value: panel.summary.quotesWaiting, tone: 'text-slate-900' },
                { label: 'Espera > 15 dias', value: panel.summary.quotesOver15Days, tone: 'text-amber-700' },
                { label: 'Maior espera (dias)', value: panel.summary.longestWaitDays, tone: 'text-slate-900' },
                { label: 'Menor espera (dias)', value: panel.summary.shortestWaitDays, tone: 'text-slate-900' },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="text-[11px] font-medium text-slate-500">{c.label}</div>
                  <div className={`mt-1 text-xl font-bold tabular-nums ${c.tone}`}>{c.value}</div>
                </div>
              ))}
            </div>

            {panel.summary.quotesOver15Days > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {panel.summary.quotesOver15Days} orçamento(s) esperam resposta do cliente há mais de 15 dias. Confirme se
                  ainda é válido ou feche o serviço.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PanelList
                title="Atrasadas: cobrar o fornecedor"
                empty="Nenhuma peça atrasada."
                rows={panel.late.map((p) => ({
                  key: p.id,
                  main: `${p.description} · ${p.reference_code}`,
                  sub: `${p.supplier_name || 'Compra direta'} · previsto ${formatDatePT(p.expected_arrival_at, false)}${
                    p.chased_at ? ` · cobrado em ${formatDatePT(p.chased_at, true)}` : ''
                  }`,
                  badge: `${p.days_late} dia(s) de atraso`,
                  tone: 'text-rose-700',
                  action: {
                    label: p.supplier_email ? 'Cobrar fornecedor' : 'Sem e-mail do fornecedor',
                    disabled: !p.supplier_email,
                    onClick: () =>
                      panelAction(`/api/suppliers/items/${p.id}/chase`, 'POST', undefined, 'Cobrança enviada ao fornecedor.'),
                  },
                }))}
              />
              <PanelList
                title="A chegar"
                empty="Nenhuma peça a chegar."
                rows={panel.arriving.map((p) => ({
                  key: p.id,
                  main: `${p.description} · ${p.reference_code}`,
                  sub: `${p.supplier_name || 'Compra direta'}${
                    p.expected_arrival_at ? ` · previsto ${formatDatePT(p.expected_arrival_at, false)}` : ' · sem prazo'
                  }`,
                  badge: p.days_to_arrival != null ? `em ${p.days_to_arrival} dia(s)` : 'sem prazo',
                  tone: 'text-slate-700',
                }))}
              />
              <PanelList
                title="A encomendar"
                empty="Nenhuma peça por encomendar."
                rows={panel.toOrder.map((p) => ({
                  key: p.id,
                  main: `${p.description} · ${p.reference_code}`,
                  sub: `${p.supplier_name || 'Compra direta'} · ${formatEUR(p.total_supplier_cost)}`,
                  badge: p.days_waiting != null ? `orçamento aprovado há ${p.days_waiting} dia(s)` : '',
                  tone: 'text-slate-700',
                  action: {
                    label: 'Pedir orçamento ao fornecedor',
                    onClick: () =>
                      panelAction(
                        `/api/suppliers/items/${p.id}/supplier-quote`,
                        'PATCH',
                        { status: 'requested' },
                        'Pedido de orçamento registado.'
                      ),
                  },
                }))}
              />
              <PanelList
                title="Aguardando fornecedor (orçamento pedido)"
                empty="Nenhum orçamento pedido aos fornecedores."
                rows={panel.waitingSupplier.map((p) => ({
                  key: p.id,
                  main: `${p.description} · ${p.reference_code}`,
                  sub: `${p.supplier_name || 'Fornecedor não indicado'}`,
                  badge: p.days_waiting_supplier != null ? `pedido há ${p.days_waiting_supplier} dia(s)` : '',
                  tone: 'text-slate-700',
                  action: {
                    label: 'Orçamento recebido',
                    onClick: () =>
                      panelAction(
                        `/api/suppliers/items/${p.id}/supplier-quote`,
                        'PATCH',
                        { status: 'received' },
                        'Orçamento do fornecedor marcado como recebido.'
                      ),
                  },
                }))}
              />
              <PanelList
                title="Orçamentos em espera do cliente (maior espera primeiro)"
                empty="Nenhum orçamento em espera."
                rows={panel.quotesWaiting.map((q) => ({
                  key: q.id,
                  main: `${q.reference_code} · ${q.customer_name}`,
                  sub: `${q.service_name} · ${formatEUR(q.total_customer_amount)}`,
                  badge: `${q.days_waiting} dia(s)${q.days_waiting > 15 ? ' · alerta' : ''}`,
                  tone: q.days_waiting > 15 ? 'text-amber-700' : 'text-slate-700',
                }))}
              />
            </div>
          </section>
        )}

        {/* Parts Forecast */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Previsão de Pagamento de Peças (Orçamentos Aprovados)
              </h2>
              <p className="text-xs text-slate-500">
                Serviços com orçamento aprovado e custo de fornecedor preenchido aparecem automaticamente aqui.
              </p>
            </div>
            <div className="text-right tabular-nums">
              <div>
                <span className="text-xs text-slate-500">Total Pendente: </span>
                <span className="text-base font-bold text-amber-700">{formatEUR(totalPending)}</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Esta semana: <span className="font-semibold text-slate-800">{formatEUR(pendingThisWeek)}</span>
                {' · '}Este mês: <span className="font-semibold text-slate-800">{formatEUR(pendingThisMonth)}</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ordem</th>
                  <th className="px-4 py-3">Peça / Material</th>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3 text-right">Custo Total</th>
                  <th className="px-4 py-3">Encomenda e chegada</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {forecast.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-slate-900">
                        {f.reference_code}
                      </div>
                      <div className="text-xs text-slate-500">{formatDatePT(f.completed_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{f.description}</div>
                      <div className="text-xs text-slate-500">
                        Qtd: {f.quantity} · {f.service_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div>{f.supplier_name || 'Compra Direta (Técnico)'}</div>
                      {f.supplier_nif && (
                        <div className="font-mono text-slate-400">NIF {f.supplier_nif}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {formatEUR(f.total_supplier_cost)}
                    </td>
                    <td className="px-4 py-3">
                      <LogisticsEditor item={f} onSaved={loadAll} onError={setError} />
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-medium">
                      {f.is_paid_to_supplier ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Pago</span>
                        </span>
                      ) : (
                        <span className="text-amber-700">Previsão Pendente</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!f.is_paid_to_supplier ? (
                        <button
                          type="button"
                          onClick={() => setConfirmPayItem(f)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Dar Baixa como Pago
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmUndoItem(f)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Estornar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Suppliers Directory */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Diretório de Fornecedores</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3">NIF</th>
                  <th className="px-4 py-3">Contacto</th>
                  <th className="px-4 py-3">Notas</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                      {s.nif || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{s.email || '—'}</div>
                      <div>{s.phone || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{s.notes || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditSupplier(s)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Novo Fornecedor</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSupplier} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">NIF</label>
                  <input
                    type="text"
                    value={nif}
                    onChange={(e) => setNif(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telefone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Notas</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
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
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Editar Fornecedor — {editingSupplier.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingSupplier(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">NIF</label>
                  <input
                    type="text"
                    value={editForm.nif}
                    onChange={(e) => setEditForm((f) => ({ ...f, nif: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telefone</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">E-mail</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Notas</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSupplier(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving ? 'A guardar...' : 'Guardar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmPayItem)}
        title="Confirmar Pagamento ao Fornecedor?"
        description={`Confirmar baixa de ${formatEUR(confirmPayItem?.total_supplier_cost || 0)} (${
          confirmPayItem?.description || ''
        }) no Fluxo de Caixa?`}
        confirmLabel="Confirmar Pagamento"
        loading={saving}
        onConfirm={handleMarkPaid}
        onCancel={() => setConfirmPayItem(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmUndoItem)}
        title="Estornar Pagamento ao Fornecedor?"
        description={`Confirma reverter "${confirmUndoItem?.description || ''}" para previsão pendente?`}
        confirmLabel="Estornar"
        variant="danger"
        loading={saving}
        onConfirm={handleUndoPaid}
        onCancel={() => setConfirmUndoItem(null)}
      />
    </PortalLayout>
  );
}
