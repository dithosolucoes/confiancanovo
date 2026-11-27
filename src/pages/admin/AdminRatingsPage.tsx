import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT } from '../../lib/api';
import type { RatingRecord } from '../../types/domain';

export function AdminRatingsPage() {
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [average, setAverage] = useState(0);
  const [total, setTotal] = useState(0);
  const [distribution, setDistribution] = useState<Array<{ stars: number; count: number }>>([]);
  const [techFilter, setTechFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{
      ratings: RatingRecord[];
      average: number;
      total: number;
      distribution: Array<{ stars: number; count: number }>;
    }>('/api/admin/ratings')
      .then((res) => {
        setRatings(res.ratings);
        setAverage(res.average);
        setTotal(res.total);
        setDistribution(res.distribution);
      })
      .finally(() => setLoading(false));
  }, []);

  const technicians = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of ratings) {
      if (r.technician_id && r.technician_name) {
        map.set(r.technician_id, r.technician_name);
      }
    }
    return Array.from(map.entries());
  }, [ratings]);

  const filteredRatings = useMemo(() => {
    if (techFilter === 'all') return ratings;
    return ratings.filter((r) => r.technician_id === techFilter);
  }, [ratings, techFilter]);

  const fiveStarCount = distribution.find((d) => d.stars === 5)?.count ?? 0;
  const fiveStarPct = total > 0 ? Math.round((fiveStarCount / total) * 100) : 0;

  return (
    <PortalLayout title="Avaliações de Clientes" breadcrumb="Qualidade">
      <div className="space-y-6">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Média Geral</div>
            <div className="mt-2 flex items-center gap-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              <span>{average.toFixed(1)}</span>
              <Star className="h-5 w-5 fill-amber-400 text-amber-500" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Total de Avaliações</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {total}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Satisfação Máxima (5★)</div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {fiveStarPct}%
            </div>
          </div>
        </div>

        {/* Distribution + Filter */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Distribuição por Estrelas</h2>
            <div className="space-y-2.5">
              {distribution.map((row) => {
                const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                return (
                  <div key={row.stars} className="flex items-center gap-3 text-xs tabular-nums">
                    <span className="w-8 font-medium text-slate-700">{row.stars}★</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-slate-500">{row.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Comentários & Serviços Avaliados
              </h2>
              <select
                value={techFilter}
                onChange={(e) => setTechFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <option value="all">Todos os Técnicos</option>
                {technicians.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <p className="p-8 text-center text-xs text-slate-500">A carregar avaliações...</p>
            ) : filteredRatings.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-500">
                Sem avaliações registadas para o filtro selecionado.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredRatings.map((r) => (
                  <div key={r.id} className="p-5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <Link
                          to={`/admin/servicos/${r.id}`}
                          className="font-mono font-semibold text-slate-900 hover:underline"
                        >
                          {r.reference_code}
                        </Link>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-medium text-slate-800">{r.service_name}</span>
                      </div>

                      <div className="flex items-center gap-0.5 text-amber-500">
                        {Array.from({ length: r.rating }).map((_, idx) => (
                          <Star key={idx} className="h-3.5 w-3.5 fill-amber-400" />
                        ))}
                      </div>
                    </div>

                    <p className="text-sm text-slate-700">
                      {r.rating_comment || 'Sem comentário escrito.'}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        Cliente: <strong className="text-slate-700">{r.customer_name}</strong> ·
                        Técnico: <strong className="text-slate-700">{r.technician_name || '—'}</strong>
                      </span>
                      <span className="tabular-nums">{formatDatePT(r.completed_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
