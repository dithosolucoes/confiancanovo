import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import { exportPartnerMonthlyPDF, exportPartnerMonthlyXLSX } from '../../lib/exports';
import type { ServiceOrder } from '../../types/domain';

export function PartnerReportsPage() {
  const [orgName, setOrgName] = useState('');
  const [orders, setOrders] = useState<ServiceOrder[]>([]);

  useEffect(() => {
    apiFetch<{ organization: any; orders: ServiceOrder[] }>('/api/partner/reports').then((res) => {
      setOrgName(res.organization?.name || 'Parceiro');
      setOrders(res.orders);
    });
  }, []);

  const totalWithVat = orders.reduce((s, o) => s + Number(o.total_customer_amount), 0);
  const totalPaid = orders
    .filter((o) => o.quote_paid)
    .reduce((s, o) => s + Number(o.total_customer_amount), 0);

  return (
    <PortalLayout
      title={`Relatório Consolidado · ${orgName}`}
      breadcrumb="Relatórios & Faturação"
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportPartnerMonthlyXLSX(orgName || 'Parceiro', orders)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span>Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => exportPartnerMonthlyPDF(orgName || 'Parceiro', orders)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Relatório PDF</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Total de Intervenções</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {orders.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Valor Consolidado (c/ IVA)</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {formatEUR(totalWithVat)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Liquidado</div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(totalPaid)}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Ref.</th>
                <th className="px-4 py-3">Serviço & Imóvel</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">IVA</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Pagamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{o.reference_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{o.service_name}</div>
                    <div className="text-xs text-slate-500">{o.service_address}</div>
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">{formatDatePT(o.scheduled_at)}</td>
                  <td className="px-4 py-3 text-right text-xs tabular-nums">
                    {formatEUR(o.subtotal_without_vat)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs tabular-nums">
                    {formatEUR(o.vat_amount)} ({o.vat_rate}%)
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatEUR(o.total_customer_amount)}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-medium">
                    {o.quote_paid ? (
                      <span className="text-emerald-700">Pago</span>
                    ) : (
                      <span className="text-amber-700">Em Aberto</span>
                    )}
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
