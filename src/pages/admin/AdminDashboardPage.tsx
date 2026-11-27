import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Star } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ServiceStatusLabel, QuoteStatusLabel } from '../../components/StatusLabel';
import {
  BilledVsReceivedChart,
  ExpensesCategoryChart,
  SingleMetricLineOrBarChart,
  type ExpenseCategoryPoint,
  type MonthlyChartPoint,
} from '../../components/AnalyticsCharts';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { Organization, ServiceOrder, UserProfile } from '../../types/domain';

interface TechRankItem {
  technicianId: string;
  technicianName: string;
  completedCount: number;
  grossBilling: number;
  techPayout: number;
  avgRating: number | null;
}

interface DashboardData {
  kpis: {
    grossBilling: number;
    netRevenue: number;
    realProfit: number;
    techPayoutTotal: number;
    supplierCostTotal?: number;
    openCount: number;
    completedCount: number;
    totalCount: number;
    avgTicket: number;
    pendingPayables: number;
    totalCashBalance: number;
  };
  byStatus: Record<string, number>;
  charts?: {
    monthlySeries: MonthlyChartPoint[];
    expensesByCategory: ExpenseCategoryPoint[];
    techRanking: TechRankItem[];
  };
}

export function AdminDashboardPage() {
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month' | '30d' | '7d' | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [technicianId, setTechnicianId] = useState('all');
  const [partnerOrgId, setPartnerOrgId] = useState('all');
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentOrders, setRecentOrders] = useState<ServiceOrder[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [partners, setPartners] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<{ technicians: UserProfile[] }>('/api/technicians'),
      apiFetch<{ organizations: Organization[] }>('/api/organizations'),
    ])
      .then(([t, o]) => {
        setTechnicians(t.technicians);
        setPartners(o.organizations.filter((org) => org.org_type === 'partner_client'));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period, technicianId, partnerOrgId });
    if (period === 'custom') {
      if (customFrom) params.set('customFrom', customFrom);
      if (customTo) params.set('customTo', customTo);
    }
    Promise.all([
      apiFetch<DashboardData>(`/api/dashboard/executive?${params}`),
      apiFetch<{ orders: ServiceOrder[] }>('/api/orders'),
    ])
      .then(([dash, ord]) => {
        setData(dash);
        setRecentOrders(ord.orders.slice(0, 6));
      })
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo, technicianId, partnerOrgId]);

  return (
    <PortalLayout
      title="Dashboard Executivo"
      breadcrumb="Visão Geral"
      primaryAction={
        <Link
          to="/admin/servicos"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <span>Gerir Ordens</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'all', label: 'Todo o Período' },
                  { id: 'today', label: 'Hoje' },
                  { id: 'week', label: 'Esta semana' },
                  { id: 'month', label: 'Este mês' },
                  { id: '30d', label: 'Últimos 30 dias' },
                  { id: '7d', label: 'Últimos 7 dias' },
                  { id: 'custom', label: 'Personalizado' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    period === p.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {period === 'custom' && (
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                />
                <span className="text-slate-400">a</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              <option value="all">Todos os Técnicos</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>

            <select
              value={partnerOrgId}
              onChange={(e) => setPartnerOrgId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
            >
              <option value="all">Todas as Parceiras</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* KPI Grid */}
        {loading || !data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Faturação Bruta (c/ IVA)</div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {formatEUR(data.kpis.grossBilling)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {data.kpis.completedCount} serviços concluídos
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Receita Líquida (s/ IVA)</div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {formatEUR(data.kpis.netRevenue)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Ticket médio: {formatEUR(data.kpis.avgTicket)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Lucro Real Operacional</div>
              <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
                {formatEUR(data.kpis.realProfit)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Após repasses e peças
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Ordens em Aberto</div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {data.kpis.openCount}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Total de {data.kpis.totalCount} ordens
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Contas a Pagar (Prev.)</div>
              <div className="mt-2 font-display text-2xl font-bold text-amber-700 tabular-nums">
                {formatEUR(data.kpis.pendingPayables)}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                Saldo caixa: {formatEUR(data.kpis.totalCashBalance)}
              </div>
            </div>
          </div>
        )}

        {/* Cost Structure & Pipeline Split */}
        {data && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                Distribuição Operacional
              </h2>
              <div className="space-y-2.5 text-sm tabular-nums">
                <div className="flex justify-between text-slate-600">
                  <span>Repasses Técnicos & Centros</span>
                  <span className="font-medium text-slate-900">
                    {formatEUR(data.kpis.techPayoutTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Custo Peças / Fornecedores</span>
                  <span className="font-medium text-slate-900">
                    {formatEUR(data.kpis.supplierCostTotal)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2.5 font-semibold text-emerald-700">
                  <span>Lucro Real Confiança</span>
                  <span>{formatEUR(data.kpis.realProfit)}</span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-2">
                <div className="text-xs font-medium text-slate-500">Atalhos Financeiros</div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/admin/financeiro/repasses"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Fechamento Semanal
                  </Link>
                  <Link
                    to="/admin/financeiro/fornecedores"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Fornecedores
                  </Link>
                  <Link
                    to="/admin/financeiro/caixa"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Fluxo de Caixa
                  </Link>
                </div>
              </div>
            </div>

            {/* Recent Orders Table */}
            <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2 overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Ordens de Serviço Recentes
                </h2>
                <Link
                  to="/admin/servicos"
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Ver todas
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Ref.</th>
                      <th className="px-4 py-3">Serviço · Cliente</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Orçamento</th>
                      <th className="px-4 py-3 text-right">Total c/ IVA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                          <Link to={`/admin/servicos/${o.id}`} className="hover:underline">
                            {o.reference_code}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{o.service_name}</div>
                          <div className="text-xs text-slate-500">
                            {o.customer_name} · {formatDatePT(o.scheduled_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <ServiceStatusLabel status={o.status} />
                        </td>
                        <td className="px-4 py-3">
                          <QuoteStatusLabel status={o.quote_status} />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatEUR(o.total_customer_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Executive Charts (4 panels) */}
        {data?.charts && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Faturado vs Recebido (Últimos 6 Meses)
              </h2>
              <BilledVsReceivedChart data={data.charts.monthlySeries} />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Evolução Lucro Real Operacional
              </h2>
              <SingleMetricLineOrBarChart
                data={data.charts.monthlySeries}
                valueKey="realProfit"
                color="#059669"
                label="Lucro Real Confiança (€)"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Repasses aos Técnicos / Mês
              </h2>
              <SingleMetricLineOrBarChart
                data={data.charts.monthlySeries}
                valueKey="techPayout"
                color="#0f172a"
                label="Repasse Bruto (€)"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Despesas por Categoria (Caixa)
              </h2>
              <ExpensesCategoryChart data={data.charts.expensesByCategory} />
            </div>
          </div>
        )}

        {/* Technician Ranking Leaderboard */}
        {data?.charts && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Ranking de Desempenho Técnico
              </h2>
              <Link
                to="/admin/tecnicos"
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Gerir equipa
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Técnico</th>
                    <th className="px-4 py-3 text-right">Concluídas</th>
                    <th className="px-4 py-3 text-right">Faturado c/ IVA</th>
                    <th className="px-4 py-3 text-right">Repasse</th>
                    <th className="px-4 py-3 text-right">Avaliação Média</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.charts.techRanking.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-400">
                        Sem ordens concluídas no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    data.charts.techRanking.map((r, idx) => (
                      <tr key={r.technicianId} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-500 tabular-nums">
                          {idx + 1}º
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{r.technicianName}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {r.completedCount}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900 tabular-nums">
                          {formatEUR(r.grossBilling)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700 tabular-nums">
                          {formatEUR(r.techPayout)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.avgRating !== null ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-800">
                              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                              {r.avgRating.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
