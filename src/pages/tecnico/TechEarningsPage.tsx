import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import { exportWeeklyPayoutPDF, exportWeeklyPayoutXLSX } from '../../lib/exports';
import type { ServiceOrder, WeeklyPayoutGroup } from '../../types/domain';

type AwaitingReceipt = { count: number; amount: number };

type WeeklyPayoutsResponse = {
  groups: WeeklyPayoutGroup[];
  history: any[];
  invoiceNotice: string;
  awaitingReceipt?: AwaitingReceipt;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

// Estado de pagamento de cada OS, derivado do estado do repasse semanal que o servidor já devolve
function estadoDaOS(g: WeeklyPayoutGroup): { label: string; cls: string } {
  if (g.status === 'paid') {
    return {
      label: g.paidAt ? `Pago em ${formatDatePT(g.paidAt)}` : 'Pago',
      cls: 'text-emerald-700',
    };
  }
  if (g.existingPayoutId) {
    return { label: 'Fechado, aguarda pagamento', cls: 'text-amber-700' };
  }
  return { label: 'Recebido, previsto para sexta', cls: 'text-sky-700' };
}

export function TechEarningsPage() {
  const [groups, setGroups] = useState<WeeklyPayoutGroup[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [awaiting, setAwaiting] = useState<AwaitingReceipt>({ count: 0, amount: 0 });
  const [ordersById, setOrdersById] = useState<Record<string, ServiceOrder>>({});
  const [notice, setNotice] = useState('');

  useEffect(() => {
    apiFetch<WeeklyPayoutsResponse>('/api/payouts/weekly').then((res) => {
      setGroups(res.groups);
      setHistory(res.history);
      setNotice(res.invoiceNotice);
      setAwaiting(res.awaitingReceipt ?? { count: 0, amount: 0 });
    });
    // Divisão por OS (M.O., taxa, peças) vem dos campos da própria OS
    apiFetch<{ orders: ServiceOrder[] }>('/api/orders?scope=mine')
      .then((res) => {
        const map: Record<string, ServiceOrder> = {};
        for (const o of res.orders) map[o.id] = o;
        setOrdersById(map);
      })
      .catch(() => setOrdersById({}));
  }, []);

  const currentGroup = groups[0];

  // Recebido: semanas já pagas. Previsto: semana atual ainda não paga, semanas fechadas sem pagamento e OS aguardando recebimento
  const recebido = round2(
    history.filter((h) => h.status === 'paid').reduce((s, h) => s + Number(h.total_amount || 0), 0)
  );
  const fechadoNaoPago = history
    .filter((h) => h.status !== 'paid')
    .reduce((s, h) => s + Number(h.total_amount || 0), 0);
  const semanaAberta = groups
    .filter((g) => !g.existingPayoutId)
    .reduce((s, g) => s + Number(g.totalAmount || 0), 0);
  const previsto = round2(fechadoNaoPago + semanaAberta + awaiting.amount);

  return (
    <PortalLayout
      title="Meus Ganhos & Repasses Semanais"
      breadcrumb="Portal do Técnico"
      primaryAction={
        currentGroup ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportWeeklyPayoutXLSX(currentGroup)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={() => exportWeeklyPayoutPDF(currentGroup, notice)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Extrato PDF (NIF 518646696)</span>
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {notice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <strong>Dados para emissão de fatura/recibo verde:</strong> {notice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Recebido (já pago)</div>
            <div className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(recebido)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Soma das semanas já pagas</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Previsto (a receber)</div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatEUR(previsto)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Semanas por pagar
              {awaiting.count > 0 && (
                <>
                  {' '}
                  + {awaiting.count} OS aguardando recebimento ({formatEUR(awaiting.amount)})
                </>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Semana Atual (Domingo a Sábado)
            </h2>
          </div>

          {groups.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">
              Ainda não concluiu serviços nesta semana.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.targetId} className="p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold text-slate-900">
                      Período {g.weekStart} a {g.weekEnd}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      · Pagamento previsto sexta-feira ({g.dueDate})
                    </span>
                  </div>
                  <div className="font-display text-2xl font-bold text-emerald-700 tabular-nums">
                    {formatEUR(g.totalAmount)}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="border-y border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Ref.</th>
                        <th className="px-3 py-2">Serviço & Morada</th>
                        <th className="px-3 py-2">Concluído</th>
                        <th className="px-3 py-2 text-right">M.O.</th>
                        <th className="px-3 py-2 text-right">Taxa</th>
                        <th className="px-3 py-2 text-right">Peças</th>
                        <th className="px-3 py-2">Pagamento</th>
                        <th className="px-3 py-2 text-right">Seu Ganho</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.orders.map((ord) => {
                        const full = ordersById[ord.id];
                        const estado = estadoDaOS(g);
                        return (
                          <tr key={ord.id}>
                            <td className="px-3 py-2 font-mono font-medium">{ord.reference_code}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">{ord.service_name}</div>
                              <div className="text-slate-500">{ord.service_address}</div>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{formatDatePT(ord.completed_at)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {full ? formatEUR(full.labor_cost) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {full ? formatEUR(full.extra_fee) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {full ? formatEUR(full.parts_customer_total) : '—'}
                            </td>
                            <td className={`px-3 py-2 font-medium ${estado.cls}`}>{estado.label}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">
                              {formatEUR(ord.technician_payout)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Histórico de Semanas</h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Semana</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Total da Semana</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {h.week_start} a {h.week_end}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">{h.due_date}</td>
                  <td className="px-4 py-3 text-xs font-medium">
                    {h.status === 'paid' ? (
                      <span className="text-emerald-700">Pago</span>
                    ) : (
                      <span className="text-amber-700">Aguarda Pagamento</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatEUR(h.total_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
}
