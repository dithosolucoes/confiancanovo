import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Paperclip, Plus, AlertTriangle } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR, getAuthToken } from '../../lib/api';
import { exportCashFlowPDF, exportCashFlowXLSX } from '../../lib/exports';
import {
  CASHFLOW_CATEGORY_LABELS,
  PT_CASHFLOW_CATEGORIES,
  type CashFlowEntry,
  type RecurrenceFrequency,
} from '../../types/domain';

const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  none: 'Lançamento Único',
  weekly: 'Semanal',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
};

export function AdminCashFlowPage() {
  const [entries, setEntries] = useState<CashFlowEntry[]>([]);
  const [tab, setTab] = useState<'all' | 'payables' | 'overdue' | 'paid'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);

  // Create form state
  const [entryType, setEntryType] = useState<'income' | 'expense'>('expense');
  const [category, setCategory] = useState('salaries');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<'pending' | 'paid'>('pending');
  const [mode, setMode] = useState<'single' | 'recurring' | 'installments'>('single');
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency>('monthly');
  const [recurrenceCount, setRecurrenceCount] = useState(6);
  const [totalInstallments, setTotalInstallments] = useState(3);

  // Partial pay modal state
  const [partialTarget, setPartialTarget] = useState<CashFlowEntry | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  // Receipt upload/view toast & errors
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  async function loadEntries() {
    setError(null);
    try {
      const res = await apiFetch<{ entries: CashFlowEntry[] }>('/api/cash-flow');
      setEntries(res.entries);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar fluxo de caixa.');
    }
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setModalError(null);
    try {
      const res = await apiFetch<{ createdCount: number }>('/api/cash-flow', {
        method: 'POST',
        body: JSON.stringify({
          entry_type: entryType,
          category,
          description,
          amount: Number(amount),
          due_date: dueDate,
          status,
          recurrence_frequency: mode === 'recurring' ? recurrenceFreq : 'none',
          recurrence_count: mode === 'recurring' ? recurrenceCount : 1,
          total_installments: mode === 'installments' ? totalInstallments : 1,
        }),
      });
      setModalOpen(false);
      setDescription('');
      setAmount('');
      setMode('single');
      await loadEntries();
      notify(
        res.createdCount > 1
          ? `${res.createdCount} lançamentos agendados no Contas a Pagar.`
          : 'Lançamento registado com sucesso.'
      );
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao criar lançamento financeiro.');
    }
  }

  async function handleMarkPaid(id: string) {
    setError(null);
    try {
      await apiFetch(`/api/cash-flow/${id}/mark-paid`, { method: 'POST' });
      await loadEntries();
      notify('Lançamento liquidado na totalidade.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao liquidar lançamento.');
    }
  }

  async function handlePartialPaySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partialTarget) return;
    setModalError(null);
    try {
      await apiFetch(`/api/cash-flow/${partialTarget.id}/partial-pay`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(partialAmount) }),
      });
      setPartialTarget(null);
      setPartialAmount('');
      await loadEntries();
      notify('Pagamento parcial registado.');
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao registar pagamento parcial.');
    }
  }

  async function handleUploadReceipt(entryId: string, file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await apiFetch(`/api/cash-flow/${entryId}/receipt`, {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            dataUrl: reader.result,
          }),
        });
        await loadEntries();
        notify(`Comprovativo "${file.name}" anexado.`);
      } catch (err: any) {
        setError(err?.message || 'Erro ao anexar comprovativo.');
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleViewReceipt(entry: CashFlowEntry) {
    setError(null);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/cash-flow/${entry.id}/receipt`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) {
        setError('Não foi possível transferir o comprovativo.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.receipt_name || 'comprovativo';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err: any) {
      setError(err?.message || 'Erro ao descarregar comprovativo.');
    }
  }

  const paidIncomes = entries
    .filter((e) => e.entry_type === 'income')
    .reduce((s, e) => s + Number(e.paid_amount || (e.status === 'paid' ? e.amount : 0)), 0);
  const paidExpenses = entries
    .filter((e) => e.entry_type === 'expense')
    .reduce((s, e) => s + Number(e.paid_amount || (e.status === 'paid' ? e.amount : 0)), 0);
  const pendingPayables = entries
    .filter((e) => e.entry_type === 'expense' && e.status !== 'paid')
    .reduce((s, e) => s + Math.max(0, Number(e.amount) - Number(e.paid_amount || 0)), 0);
  const overdueCount = entries.filter((e) => e.is_overdue).length;

  const filtered = entries.filter((e) => {
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (tab === 'payables') return e.entry_type === 'expense' && e.status !== 'paid';
    if (tab === 'overdue') return Boolean(e.is_overdue);
    if (tab === 'paid') return e.status === 'paid';
    return true;
  });

  return (
    <PortalLayout
      title="Contas a Pagar & Fluxo de Caixa"
      breadcrumb="Financeiro"
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportCashFlowXLSX(filtered, CASHFLOW_CATEGORY_LABELS)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => exportCashFlowPDF(filtered, CASHFLOW_CATEGORY_LABELS)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-slate-700" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Novo Lançamento</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            {toast}
          </div>
        )}

        {/* Summary Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Entradas Efetivadas</div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(paidIncomes)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Saídas Efetivadas</div>
            <div className="mt-2 font-display text-2xl font-bold text-rose-700 tabular-nums">
              {formatEUR(paidExpenses)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Saldo Atual de Caixa</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatEUR(paidIncomes - paidExpenses)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">
              Contas a Pagar ({overdueCount} em atraso)
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-amber-700 tabular-nums">
              {formatEUR(pendingPayables)}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'payables', label: 'A Pagar / Parciais' },
                { id: 'overdue', label: `Vencidos (${overdueCount})` },
                { id: 'paid', label: 'Liquidados' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
          >
            <option value="all">Todas as 18+ Categorias PT</option>
            {PT_CASHFLOW_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Ledger Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vencimento</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Pago / Total</th>
                  <th className="px-4 py-3 text-center">Anexo</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => {
                  const remaining = Math.max(0, Number(e.amount) - Number(e.paid_amount || 0));
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        <div>{formatDatePT(e.due_date)}</div>
                        {e.is_overdue && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Vencido</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">
                        <div>{CASHFLOW_CATEGORY_LABELS[e.category] || e.category}</div>
                        {e.recurrence_frequency && e.recurrence_frequency !== 'none' && (
                          <div className="text-[11px] font-normal text-slate-400">
                            Recorrente: {RECURRENCE_LABELS[e.recurrence_frequency]}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900">{e.description}</td>
                      <td className="px-4 py-3 text-xs font-medium">
                        {e.status === 'paid' ? (
                          <span className="text-emerald-700">Liquidado</span>
                        ) : e.status === 'partial' ? (
                          <span className="text-sky-700">
                            Parcial ({formatEUR(e.paid_amount)})
                          </span>
                        ) : (
                          <span className={e.is_overdue ? 'text-rose-700' : 'text-amber-700'}>
                            {e.is_overdue ? 'Em Atraso' : 'Previsto'}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${
                          e.entry_type === 'income' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        <div>
                          {e.entry_type === 'income' ? '+' : '-'} {formatEUR(e.amount)}
                        </div>
                        {e.status === 'partial' && (
                          <div className="text-[11px] font-normal text-slate-500">
                            Restam {formatEUR(remaining)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {e.receipt_name ? (
                          <button
                            type="button"
                            onClick={() => handleViewReceipt(e)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline"
                          >
                            <Paperclip className="h-3 w-3" />
                            <span className="max-w-24 truncate">{e.receipt_name}</span>
                          </button>
                        ) : (
                          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
                            <Paperclip className="h-3 w-3" />
                            <span>Anexar</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                              className="hidden"
                              onChange={(ev) => {
                                const file = ev.target.files?.[0];
                                if (file) void handleUploadReceipt(e.id, file);
                              }}
                            />
                          </label>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {e.status !== 'paid' && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setModalError(null);
                                setPartialTarget(e);
                                setPartialAmount(String((remaining / 2).toFixed(2)));
                              }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Parcial
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkPaid(e.id)}
                              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                            >
                              Liquidar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Entry Modal (18 PT Categories + Recurring + Installments) */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              Novo Lançamento Financeiro (ERP Portugal)
            </h3>
            {modalError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {modalError}
              </div>
            )}
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Tipo</label>
                  <select
                    value={entryType}
                    onChange={(e) => setEntryType(e.target.value as 'income' | 'expense')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="expense">Saída / Conta a Pagar</option>
                    <option value="income">Entrada / Receita</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Categoria PT</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {PT_CASHFLOW_CATEGORIES.filter(
                      (c) => c.type === 'both' || c.type === entryType
                    ).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Descrição</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Segurança Social TSU, Via Verde Frota, Seguro AT..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Valor Total (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">1º Vencimento</label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Estado Inicial</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'pending' | 'paid')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="pending">Previsto (A Pagar)</option>
                    <option value="paid">Já Liquidado</option>
                  </select>
                </div>
              </div>

              {/* Recurrence vs Installments */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Periodicidade / Parcelamento
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'single', label: 'Único' },
                      { id: 'recurring', label: 'Recorrente' },
                      { id: 'installments', label: 'Parcelado (Nx)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                        mode === m.id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {mode === 'recurring' && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600">
                        Frequência
                      </label>
                      <select
                        value={recurrenceFreq}
                        onChange={(e) => setRecurrenceFreq(e.target.value as RecurrenceFrequency)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="weekly">Semanal</option>
                        <option value="monthly">Mensal</option>
                        <option value="quarterly">Trimestral</option>
                        <option value="semiannual">Semestral</option>
                        <option value="annual">Anual</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600">
                        Repetições (Meses/Ciclos)
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={24}
                        value={recurrenceCount}
                        onChange={(e) => setRecurrenceCount(Number(e.target.value))}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                      />
                    </div>
                  </div>
                )}

                {mode === 'installments' && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-slate-600">
                      Número de Parcelas Mensais (divide o valor total automaticamente)
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={24}
                      value={totalInstallments}
                      onChange={(e) => setTotalInstallments(Number(e.target.value))}
                      className="mt-1 w-32 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                    />
                  </div>
                )}
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
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                >
                  Lançar no ERP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Partial Payment Modal */}
      {partialTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Registar Pagamento Parcial</h3>
            <p className="mt-1 text-xs text-slate-500">{partialTarget.description}</p>
            {modalError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {modalError}
              </div>
            )}
            <form onSubmit={handlePartialPaySubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Valor a Pagar Agora (€) — Em aberto:{' '}
                  {formatEUR(Number(partialTarget.amount) - Number(partialTarget.paid_amount || 0))}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPartialTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                >
                  Confirmar Pagamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
