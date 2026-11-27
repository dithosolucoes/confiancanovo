import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';
import { ServiceStatusLabel } from '../../components/StatusLabel';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type { ServiceOrder } from '../../types/domain';

export function CompanyDashboardPage() {
  const { user } = useAuth();
  const [kpis, setKpis] = useState<any>(null);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<{ kpis: any }>('/api/dashboard/executive'),
      apiFetch<{ orders: ServiceOrder[] }>('/api/orders'),
    ]).then(([d, o]) => {
      setKpis(d.kpis);
      setOrders(o.orders.slice(0, 6));
    });
  }, []);

  return (
    <PortalLayout title="Dashboard do Centro Técnico" breadcrumb={user?.organization_name || 'Empresa'}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Serviços em Andamento</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {kpis?.openCount ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Serviços Concluídos</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {kpis?.completedCount ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">
              Total a Receber da Confiança ({user?.effective_payout_percentage ?? 50}%)
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(kpis?.techPayoutTotal ?? 0)}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Ordens Atribuídas à Empresa
            </h2>
            <Link to="/empresa/servicos" className="text-xs font-medium text-slate-600 hover:text-slate-900">
              Gerir equipa e ordens
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ref.</th>
                  <th className="px-4 py-3">Serviço</th>
                  <th className="px-4 py-3">Técnico Interno</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Repasse Empresa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      <Link to={`/empresa/servicos/${o.id}`} className="hover:underline">
                        {o.reference_code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{o.service_name}</div>
                      <div className="text-xs text-slate-500">
                        {o.service_address} · {formatDatePT(o.scheduled_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {o.technician_name || 'Por distribuir'}
                    </td>
                    <td className="px-4 py-3">
                      <ServiceStatusLabel status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">
                      {formatEUR(o.technician_payout)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
