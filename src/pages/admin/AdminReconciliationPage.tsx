import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetch, formatEUR } from '../../lib/api';
import type { ReconciliationItem } from '../../types/domain';

const KIND_LABELS: Record<ReconciliationItem['kind'], string> = {
  order_payout_mismatch: 'Repasse de Ordem vs Motor',
  weekly_payout_total_mismatch: 'Fechamento Pendente vs Soma Ordens',
  cash_flow_mismatch: 'Contas a Pagar vs Fechamento',
};

export function AdminReconciliationPage() {
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [totalDelta, setTotalDelta] = useState(0);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ReconciliationItem[]; totalDelta: number }>(
        '/api/admin/reconciliation/preview'
      );
      setItems(res.items);
      setTotalDelta(res.totalDelta);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  async function handleExecute() {
    setExecuting(true);
    setSummaryMsg(null);
    setError('');
    try {
      const res = await apiFetch<{
        ordersFixed: number;
        payoutsUpdated: number;
        cashFlowUpdated: number;
        totalDelta: number;
        remaining: ReconciliationItem[];
      }>('/api/admin/reconciliation/execute', { method: 'POST' });

      setItems(res.remaining);
      setTotalDelta(
        Math.round(res.remaining.reduce((s, i) => s + i.difference, 0) * 100) / 100
      );
      setConfirmOpen(false);
      setSummaryMsg(
        `Reconciliação concluída: ${res.ordersFixed} ordens recalculadas, ${res.payoutsUpdated} fechamentos e ${res.cashFlowUpdated} lançamentos de caixa alinhados.`
      );
    } catch (err: any) {
      setError(err?.message || 'Erro ao executar reconciliação.');
    } finally {
      setExecuting(false);
    }
  }

  return (
    <PortalLayout
      title="Centro de Administração & Reconciliação"
      breadcrumb="Auditoria Financeira"
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPreview}
            disabled={loading || executing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Reanalisar</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={loading || executing || items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{executing ? 'A reconciliar...' : 'Executar Reconciliação'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {error}
          </div>
        )}
        {summaryMsg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {summaryMsg}
          </div>
        )}

        {/* Protection Policy Banner */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed text-slate-700">
            <div className="font-semibold text-slate-900">
              Proteção de Histórico Consolidado
            </div>
            <p className="mt-0.5">
              A reconciliação audita exclusivamente ordens em aberto (sem repasse travado nem override manual), fechamentos semanais pendentes e contas a pagar não liquidadas.{' '}
              <strong>Nunca altera ciclos semanais já pagos</strong> nem histórico consolidado.
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Divergências Detetadas</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {items.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Diferença Líquida Total</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatEUR(totalDelta)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Estado da Integridade</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
              {items.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>100% Conciliado</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Ajustes Pendentes</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Preview Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-900">
              Pré-visualização de Ajustes
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Referência</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3 text-right">Valor Registado</th>
                  <th className="px-4 py-3 text-right">Valor Motor</th>
                  <th className="px-4 py-3 text-right">Diferença</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      A auditar consistência entre ordens, repasses e caixa...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      Sem divergências. Todos os valores abertos estão alinhados com o motor financeiro.
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr key={`${it.kind}-${it.entityId}`} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">
                        {KIND_LABELS[it.kind]}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {it.referenceCode}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{it.label}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-700 tabular-nums">
                        {formatEUR(it.storedValue)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-slate-900 tabular-nums">
                        {formatEUR(it.expectedValue)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right text-xs font-bold tabular-nums ${
                          it.difference >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {it.difference > 0 ? '+' : ''}
                        {formatEUR(it.difference)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Executar Reconciliação Financeira?"
        description={`Irá recalcular ${items.length} divergências em aberto (diferença líquida ${formatEUR(
          totalDelta
        )}). Ordens travadas e ciclos já pagos permanecem intactos.`}
        confirmLabel="Executar Reconciliação"
        loading={executing}
        onConfirm={handleExecute}
        onCancel={() => setConfirmOpen(false)}
      />
    </PortalLayout>
  );
}
