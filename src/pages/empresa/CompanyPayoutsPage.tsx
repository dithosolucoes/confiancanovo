import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import { exportWeeklyPayoutPDF, exportWeeklyPayoutXLSX } from '../../lib/exports';
import type { WeeklyPayoutGroup } from '../../types/domain';

export function CompanyPayoutsPage() {
  const [groups, setGroups] = useState<WeeklyPayoutGroup[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    apiFetch<{ groups: WeeklyPayoutGroup[]; history: any[]; invoiceNotice: string }>(
      '/api/payouts/weekly'
    ).then((res) => {
      setGroups(res.groups);
      setHistory(res.history);
      setNotice(res.invoiceNotice);
    });
  }, []);

  return (
    <PortalLayout title="Relatório Financeiro & Repasses" breadcrumb="Financeiro">
      <div className="space-y-6">
        {notice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <strong>Faturação semanal à Confiança:</strong> {notice}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Semana Atual (Domingo a Sábado)</h2>
          </div>
          {groups.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">
              Sem serviços concluídos nesta semana até ao momento.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.targetId} className="p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-semibold text-slate-900">
                      {g.weekStart} a {g.weekEnd}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      (Pagamento previsto sexta-feira {g.dueDate})
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => exportWeeklyPayoutXLSX(g)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      <span>Excel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => exportWeeklyPayoutPDF(g, notice)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>PDF (NIF 518646696)</span>
                    </button>
                    <div className="font-display text-xl font-bold text-emerald-700 tabular-nums">
                      {formatEUR(g.totalAmount)}
                    </div>
                  </div>
                </div>

                <table className="w-full text-left text-xs">
                  <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Ref.</th>
                      <th className="px-3 py-2">Serviço & Morada</th>
                      <th className="px-3 py-2">Concluído</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.orders.map((ord) => (
                      <tr key={ord.id}>
                        <td className="px-3 py-2 font-mono">{ord.reference_code}</td>
                        <td className="px-3 py-2">
                          {ord.service_name} · {ord.service_address}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{formatDatePT(ord.completed_at)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {formatEUR(ord.technician_payout)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Histórico de Fechamentos</h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Período</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
                    Nenhum fechamento anterior registado.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {h.week_start} a {h.week_end}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">{h.due_date}</td>
                    <td className="px-4 py-3 text-xs font-medium">
                      {h.status === 'paid' ? 'Pago' : 'Relatório Recebido'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatEUR(h.total_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
}
