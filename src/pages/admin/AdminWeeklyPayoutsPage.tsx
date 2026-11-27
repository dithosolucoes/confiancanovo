import { useCallback, useEffect, useState } from 'react';
import { Printer, CheckCircle2, Mail, RotateCw, Download, FileSpreadsheet, Receipt } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TechPayoutForecast } from '../../components/TechPayoutForecast';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import {
  adjustmentLabel,
  exportTechReceiptPDF,
  exportWeeklyPayoutPDF,
  exportWeeklyPayoutXLSX,
} from '../../lib/exports';
import { getRecentWeeklyCycles } from '../../core/finance/weekly-cycle';
import type { WeeklyPayoutGroup } from '../../types/domain';

export function AdminWeeklyPayoutsPage() {
  const cycles = getRecentWeeklyCycles(4);
  const [selectedDate, setSelectedDate] = useState(cycles[0].weekStart);
  const [groups, setGroups] = useState<WeeklyPayoutGroup[]>([]);
  const [cycleInfo, setCycleInfo] = useState(cycles[0]);
  const [invoiceNotice, setInvoiceNotice] = useState('');
  const [awaitingReceipt, setAwaitingReceipt] = useState<{ count: number; amount: number }>({ count: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reportGroup, setReportGroup] = useState<WeeklyPayoutGroup | null>(null);
  const [confirmCloseGroup, setConfirmCloseGroup] = useState<WeeklyPayoutGroup | null>(null);
  const [confirmPaidGroup, setConfirmPaidGroup] = useState<WeeklyPayoutGroup | null>(null);
  // Desconto / reembolso no fechamento (motivo obrigatório)
  const [adjKind, setAdjKind] = useState<'' | 'desconto' | 'reembolso'>('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState('');

  function openCloseModal(g: WeeklyPayoutGroup) {
    setAdjKind('');
    setAdjAmount('');
    setAdjReason('');
    setAdjError('');
    setConfirmCloseGroup(g);
  }

  function buildAdjustment(): { kind: 'desconto' | 'reembolso'; amount: number; reason: string } | null | 'invalid' {
    if (!adjKind && !adjAmount.trim()) return null;
    const amount = Number(adjAmount.replace(',', '.'));
    const reason = adjReason.trim();
    if (!adjKind || !Number.isFinite(amount) || amount <= 0) return 'invalid';
    if (reason.length < 5) return 'invalid';
    return { kind: adjKind, amount, reason };
  }

  const loadWeekly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        cycle: typeof cycles[0];
        groups: WeeklyPayoutGroup[];
        invoiceNotice: string;
        awaitingReceipt?: { count: number; amount: number };
      }>(`/api/payouts/weekly?date=${selectedDate}`);
      setCycleInfo(res.cycle);
      setGroups(res.groups);
      setInvoiceNotice(res.invoiceNotice);
      setAwaitingReceipt(res.awaitingReceipt ?? { count: 0, amount: 0 });
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadWeekly();
  }, [loadWeekly]);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }

  async function handleCloseWeek(g: WeeklyPayoutGroup) {
    const adjustment = buildAdjustment();
    if (adjustment === 'invalid') {
      setAdjError('Para aplicar desconto ou reembolso, escolha o tipo, informe um valor maior que zero e um motivo (mínimo 5 caracteres).');
      return;
    }
    setAdjError('');
    setBusyId(g.targetId);
    setError('');
    try {
      await apiFetch('/api/payouts/close-week', {
        method: 'POST',
        body: JSON.stringify({
          technicianId: g.targetType === 'technician' ? g.targetId : null,
          organizationId: g.targetType === 'organization' ? g.targetId : null,
          weekStart: cycleInfo.weekStart,
          weekEnd: cycleInfo.weekEnd,
          dueDate: cycleInfo.dueDate,
          adjustment,
        }),
      });
      setConfirmCloseGroup(null);
      await loadWeekly();
      notify(`Semana fechada e relatório enviado para ${g.targetName}.`);
    } catch (err: any) {
      setError(err?.message || 'Erro ao fechar semana.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleResendReport(g: WeeklyPayoutGroup) {
    if (!g.existingPayoutId) return;
    setBusyId(g.targetId);
    setError('');
    try {
      const res = await apiFetch<{ ok: boolean; reportSentAt: string }>(
        `/api/payouts/${g.existingPayoutId}/resend-report`,
        { method: 'POST' }
      );
      await loadWeekly();
      setReportGroup((prev) =>
        prev && prev.targetId === g.targetId ? { ...prev, reportSentAt: res.reportSentAt } : prev
      );
      notify(`Relatório reenviado por e-mail para ${g.targetName}.`);
    } catch (err: any) {
      setError(err?.message || 'Erro ao reenviar relatório.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkPaid(g: WeeklyPayoutGroup) {
    if (!g.existingPayoutId) return;
    setBusyId(g.targetId);
    setError('');
    try {
      await apiFetch(`/api/payouts/${g.existingPayoutId}/mark-paid`, { method: 'POST' });
      setConfirmPaidGroup(null);
      await loadWeekly();
      notify(`Pagamento de ${formatEUR(g.totalAmount)} confirmado no Fluxo de Caixa.`);
    } catch (err: any) {
      setError(err?.message || 'Erro ao marcar como pago.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PortalLayout title="Fechamento Semanal de Repasses" breadcrumb="Financeiro">
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {toast}
          </div>
        )}

        {/* Cycle Selector Header */}
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Ciclo Semanal (Domingo a Sábado → Pagamento Sexta-feira)
            </h2>
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              Período: <strong>{cycleInfo.weekStart}</strong> a{' '}
              <strong>{cycleInfo.weekEnd}</strong> · Vencimento previsto:{' '}
              <strong className="text-emerald-700">{cycleInfo.dueDate}</strong>
            </p>
          </div>

          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 tabular-nums"
          >
            {cycles.map((c, idx) => (
              <option key={c.weekStart} value={c.weekStart}>
                {idx === 0 ? 'Semana Atual: ' : 'Semana: '}
                {c.weekStart} a {c.weekEnd} (Pag. {c.dueDate})
              </option>
            ))}
          </select>
        </div>

        <TechPayoutForecast />

        {/* Serviços concluídos que ainda não foram recebidos: ficam de fora do repasse */}
        {awaitingReceipt.count > 0 && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-3.5 text-xs text-sky-900">
            <strong>
              {awaitingReceipt.count} serviço(s) concluído(s) aguardam recebimento
            </strong>{' '}
            (€ {awaitingReceipt.amount.toFixed(2)} em repasses). Entram no repasse assim que o recebimento for
            dado na baixa da ordem.
          </div>
        )}

        {/* Invoice Notice Banner */}
        {invoiceNotice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-3.5 text-xs text-amber-900">
            <strong>Aviso obrigatório nos relatórios enviados:</strong> {invoiceNotice}
          </div>
        )}

        {/* Payouts Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Técnico / Centro Técnico</th>
                  <th className="px-4 py-3">NIF / IBAN</th>
                  <th className="px-4 py-3 text-center">Serviços</th>
                  <th className="px-4 py-3 text-right">Total (c/ IVA)</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      A agrupar serviços concluídos...
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhum serviço concluído neste ciclo semanal.
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <tr key={g.targetId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{g.targetName}</div>
                        <div className="text-xs text-slate-500">
                          {g.targetType === 'organization'
                            ? 'Centro Técnico Parceiro'
                            : 'Técnico Individual'}{' '}
                          · {g.targetEmail || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                        <div>NIF: {g.nif || '—'}</div>
                        <div>IBAN: {g.iban || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-center font-medium tabular-nums">
                        {g.ordersCount}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                        {formatEUR(g.totalAmount)}
                        {Number(g.adjustmentAmount || 0) !== 0 && (
                          <div className="text-[11px] font-normal text-slate-500">
                            {adjustmentLabel(g.adjustmentKind)}{' '}
                            {Number(g.adjustmentAmount) < 0 ? '−' : '+'}{' '}
                            {formatEUR(Math.abs(Number(g.adjustmentAmount)))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-medium">
                        {g.status === 'open' && <span className="text-amber-700">Em Aberto</span>}
                        {g.status === 'pending' && (
                          <div>
                            <span className="text-sky-700">Relatório Enviado</span>
                            {g.reportSentAt && (
                              <div className="mt-0.5 text-[11px] font-normal text-slate-400 tabular-nums">
                                {formatDatePT(g.reportSentAt, true)}
                              </div>
                            )}
                          </div>
                        )}
                        {g.status === 'paid' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Pago</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setReportGroup(g)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>Ver Extrato</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => exportWeeklyPayoutPDF(g, invoiceNotice)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            title="Exportar PDF (NIF 518646696)"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => exportWeeklyPayoutXLSX(g)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            title="Exportar Excel"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            <span>Excel</span>
                          </button>

                          {g.existingPayoutId && (
                            <button
                              type="button"
                              onClick={() => exportTechReceiptPDF(g, invoiceNotice)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                              title="Recibo com bloco fiscal (logo e dados da empresa)"
                            >
                              <Receipt className="h-3.5 w-3.5" />
                              <span>Recibo PDF</span>
                            </button>
                          )}

                          {g.status === 'open' && (
                            <button
                              type="button"
                              disabled={busyId === g.targetId}
                              onClick={() => openCloseModal(g)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              <span>Fechar Semana e Enviar</span>
                            </button>
                          )}

                          {g.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === g.targetId}
                                onClick={() => handleResendReport(g)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                                <span>Reenviar relatório</span>
                              </button>
                              <button
                                type="button"
                                disabled={busyId === g.targetId}
                                onClick={() => setConfirmPaidGroup(g)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                              >
                                Marcar como Pago
                              </button>
                            </>
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
      </div>

      {/* Printable Weekly Report Modal */}
      {reportGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-8 shadow-xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Relatório Semanal de Repasse — Confiança Repara
                </h3>
                <p className="text-xs text-slate-500">
                  Período: {reportGroup.weekStart} a {reportGroup.weekEnd} · Pagamento:{' '}
                  {reportGroup.dueDate}
                </p>
              </div>
              <div className="no-print flex items-center gap-2">
                {reportGroup.status === 'pending' && reportGroup.existingPayoutId && (
                  <button
                    type="button"
                    disabled={busyId === reportGroup.targetId}
                    onClick={() => handleResendReport(reportGroup)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    <span>Reenviar Relatório</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => exportWeeklyPayoutXLSX(reportGroup)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportWeeklyPayoutPDF(reportGroup, invoiceNotice)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Descarregar PDF (NIF 518646696)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReportGroup(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs text-slate-700">
              <div>
                <div className="text-slate-500">Beneficiário</div>
                <div className="mt-0.5 font-semibold text-slate-900">{reportGroup.targetName}</div>
                <div>NIF: {reportGroup.nif || '—'}</div>
                <div>IBAN: {reportGroup.iban || '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-slate-500">Total a Receber (c/ IVA)</div>
                <div className="mt-0.5 font-display text-xl font-bold text-slate-900 tabular-nums">
                  {formatEUR(reportGroup.totalAmount)}
                </div>
              </div>
            </div>

            <table className="w-full text-left text-xs">
              <thead className="border-y border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Ref.</th>
                  <th className="px-3 py-2">Serviço & Morada</th>
                  <th className="px-3 py-2">Concluído</th>
                  <th className="px-3 py-2 text-right">Repasse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportGroup.orders.map((ord) => (
                  <tr key={ord.id}>
                    <td className="px-3 py-2 font-mono font-medium">{ord.reference_code}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{ord.service_name}</div>
                      <div className="text-slate-500">{ord.service_address}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatDatePT(ord.completed_at)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatEUR(ord.technician_payout)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <strong>Instrução de Faturação Obrigatória:</strong>
              <p className="mt-1">{invoiceNotice}</p>
            </div>
          </div>
        </div>
      )}

      {confirmCloseGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Fechar Semana e Enviar Relatório?
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Irá travar {confirmCloseGroup.ordersCount} {confirmCloseGroup.ordersCount === 1 ? 'ordem' : 'ordens'} de {confirmCloseGroup.targetName} no
                total de {formatEUR(confirmCloseGroup.totalAmount)} (antes de ajustes), gerar previsão em
                Contas a Pagar e notificar por e-mail.
              </p>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <div className="text-xs font-semibold text-slate-700">Desconto ou reembolso (opcional)</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">Tipo</label>
                  <select
                    value={adjKind}
                    onChange={(e) => setAdjKind(e.target.value as '' | 'desconto' | 'reembolso')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Sem ajuste</option>
                    <option value="desconto">Desconto (diminui o repasse)</option>
                    <option value="reembolso">Reembolso (aumenta o repasse)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600">Valor (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    placeholder="0,00"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Motivo (obrigatório com ajuste)
                </label>
                <input
                  type="text"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Ex: combustível de deslocação não reembolsado no serviço"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              {adjError && <p className="text-xs font-medium text-rose-700">{adjError}</p>}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCloseGroup(null)}
                disabled={Boolean(busyId)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleCloseWeek(confirmCloseGroup)}
                disabled={Boolean(busyId)}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyId ? 'A fechar...' : 'Fechar Semana e Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmPaidGroup)}
        title="Confirmar Pagamento do Repasse?"
        description={`Confirma que o pagamento de ${formatEUR(
          confirmPaidGroup?.totalAmount || 0
        )} para ${confirmPaidGroup?.targetName || ''} foi liquidado?`}
        confirmLabel="Marcar como Pago"
        loading={Boolean(busyId)}
        onConfirm={() => confirmPaidGroup && handleMarkPaid(confirmPaidGroup)}
        onCancel={() => setConfirmPaidGroup(null)}
      />
    </PortalLayout>
  );
}
