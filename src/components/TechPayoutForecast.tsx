import { useEffect, useState } from 'react';
import { apiFetch, formatDatePT, formatEUR } from '../lib/api';

interface TechForecast {
  technicianId: string;
  name: string;
  aLiberar: number;
  aguardandoRecebimento: number;
  fechadoNaoPago: number;
  totalPago: number;
  previsto: number;
  ultimoPagamento: string | null;
}

// Previsão por técnico: o que já pode ser pago, o que aguarda recebimento, o fechado sem pagamento e o total já pago.
export function TechPayoutForecast() {
  const [rows, setRows] = useState<TechForecast[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ technicians: TechForecast[] }>('/api/payouts/by-technician')
      .then((r) => setRows(r.technicians))
      .catch((err: any) => setError(err?.message || 'Não foi possível carregar a previsão.'));
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Previsão por técnico</h2>
        <p className="text-xs text-slate-500">
          Valores acumulados, sem contar o que já foi pago em semanas anteriores como pendente.
        </p>
      </div>
      {error && <div className="px-5 py-3 text-xs text-rose-700">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Técnico</th>
              <th className="px-4 py-2.5 text-right">Liberado para pagar</th>
              <th className="px-4 py-2.5 text-right">Aguarda recebimento</th>
              <th className="px-4 py-2.5 text-right">Fechado, não pago</th>
              <th className="px-4 py-2.5 text-right">Total já pago</th>
              <th className="px-4 py-2.5">Último pagamento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.technicianId}>
                <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatEUR(r.aLiberar)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatEUR(r.aguardandoRecebimento)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatEUR(r.fechadoNaoPago)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{formatEUR(r.totalPago)}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.ultimoPagamento ? formatDatePT(r.ultimoPagamento, false) : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">Sem técnicos ativos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
