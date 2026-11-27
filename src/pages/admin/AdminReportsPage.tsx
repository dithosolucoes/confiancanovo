import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Filter } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import {
  exportGeneralOrdersPDF,
  exportGeneralOrdersXLSX,
  GENERAL_ORDER_COLUMNS,
} from '../../lib/exports';
import type { ServiceOrder, UserProfile } from '../../types/domain';

const DEFAULT_COLUMNS = [
  'reference_code',
  'scheduled_at',
  'service_name',
  'customer_name',
  'technician_name',
  'status',
  'total_customer_amount',
  'technician_payout',
  'company_gross_margin',
  'quote_paid',
];

export function AdminReportsPage() {
  const [scope, setScope] = useState<'ALL' | 'WO' | 'SR' | 'CO' | 'PARTNER'>('ALL');
  const [status, setStatus] = useState('all');
  const [technicianId, setTechnicianId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>(DEFAULT_COLUMNS);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        scope,
        status,
        technicianId,
        dateFrom,
        dateTo,
      });
      const res = await apiFetch<{ orders: ServiceOrder[] }>(
        `/api/admin/reports/orders?${qs.toString()}`
      );
      setOrders(res.orders);
    } finally {
      setLoading(false);
    }
  }, [scope, status, technicianId, dateFrom, dateTo]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    apiFetch<{ technicians: UserProfile[] }>('/api/technicians')
      .then((r) => setTechnicians(r.technicians))
      .catch(() => {});
  }, []);

  function toggleCol(key: string) {
    setSelectedCols((prev) =>
      prev.includes(key)
        ? prev.length > 1
          ? prev.filter((k) => k !== key)
          : prev
        : [...prev, key]
    );
  }

  const totalRevenue = orders.reduce((s, o) => s + Number(o.total_customer_amount), 0);
  const totalPayout = orders.reduce((s, o) => s + Number(o.technician_payout ?? 0), 0);
  const totalMargin = orders.reduce((s, o) => s + Number(o.company_gross_margin ?? 0), 0);

  return (
    <PortalLayout
      title="Relatório Geral de Serviços & Exportação"
      breadcrumb="Relatórios"
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportGeneralOrdersXLSX(orders, selectedCols, scope)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span>Exportar Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => exportGeneralOrdersPDF(orders, selectedCols, scope)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Exportar PDF Profissional</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Scope Tabs (WO / SR / CO / PARTNER / ALL) */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            {(
              [
                { id: 'ALL', label: 'Todos os Escopos' },
                { id: 'WO', label: 'WO (Gerais)' },
                { id: 'SR', label: 'SR (Residenciais)' },
                { id: 'CO', label: 'CO (Canalização/Eletr.)' },
                { id: 'PARTNER', label: 'Parceiros B2B' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === s.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            >
              <option value="all">Todos os Estados</option>
              <option value="pending">Aguardando</option>
              <option value="accepted">Aceite</option>
              <option value="on_the_way">A Caminho</option>
              <option value="in_progress">Em Curso</option>
              <option value="payment_pending">Aguarda Pagamento</option>
              <option value="completed">Concluído</option>
            </select>

            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            >
              <option value="all">Todos os Técnicos</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Data inicial"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Data final"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Totals Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Ordens Filtradas</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {orders.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Faturação Total (c/ IVA)</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatEUR(totalRevenue)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Repasses Técnicos</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatEUR(totalPayout)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Margem Bruta Confiança</div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(totalMargin)}
            </div>
          </div>
        </div>

        {/* Column Selector */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <span>Colunas Selecionadas para Exportação PDF / Excel</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {GENERAL_ORDER_COLUMNS.map((col) => {
              const active = selectedCols.includes(col.key);
              return (
                <label
                  key={col.key}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleCol(col.key)}
                    className="hidden"
                  />
                  <span>{col.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Preview Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ref.</th>
                  <th className="px-4 py-3">Serviço</th>
                  <th className="px-4 py-3">Cliente / Parceiro</th>
                  <th className="px-4 py-3">Técnico</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Total Cliente</th>
                  <th className="px-4 py-3 text-right">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      A carregar dados do relatório...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhuma ordem encontrada para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                        {o.reference_code}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-900">
                        {o.service_name}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {o.customer_name}
                        {o.requester_org_name ? ` (${o.requester_org_name})` : ''}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {o.technician_name || 'Por atribuir'}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-600">
                        {formatDatePT(o.scheduled_at)}
                      </td>
                      <td className="px-4 py-3">
                        <ServiceStatusLabel status={o.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatEUR(o.total_customer_amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">
                        {formatEUR(o.company_gross_margin)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
