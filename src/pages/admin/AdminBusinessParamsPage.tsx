import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT } from '../../lib/api';

interface ParamVersion {
  value: number;
  effective_from: string;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
}

interface BusinessParam {
  key: string;
  label: string;
  description: string;
  unit: '%' | '€/km' | '×' | 'sim/não' | 'dias' | 'modo';
  min: number;
  max: number;
  options: Array<{ value: number; label: string }> | null;
  current_value: number;
  current_effective_from: string | null;
  scheduled: ParamVersion[];
  history: ParamVersion[];
}

const FIXED_RULES: Array<{ title: string; detail: string }> = [
  {
    title: 'IVA (6% e 23%)',
    detail: 'Taxas legais. Cada serviço escolhe a taxa no catálogo ou na ordem; a taxa de IVA não é um parâmetro de negócio.',
  },
  {
    title: 'Repasse: peças e adicional = 0%',
    detail:
      'A base do repasse é Taxa de Serviço, M.O. e Taxa Extra. Peças e adicional ficam com a empresa. Mudar isto altera o cálculo de todo o sistema e exige desenvolvimento.',
  },
  {
    title: 'Ciclo semanal',
    detail: 'Semana de domingo a sábado, com pagamento na sexta seguinte. Fechamento e relatórios seguem este ciclo.',
  },
  {
    title: 'Regra histórica de 01/08/2026',
    detail:
      'Serviços anteriores a 01/08/2026 mantêm a regra antiga (70% M.O./Taxa Extra e 50% do lucro de peças). Não é retroativo.',
  },
];

function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatValue(value: number, unit: string, options?: BusinessParam['options']): string {
  if (options) return options.find((o) => o.value === Number(value))?.label ?? String(value);
  if (unit === '%') return `${value}%`;
  if (unit === 'sim/não') return Number(value) === 1 ? 'Sim' : 'Não';
  if (unit === 'dias') return `${value} dias`;
  return `${value.toFixed(2)} ${unit}`;
}

function ParamCard({ param, onSaved }: { param: BusinessParam; onSaved: (params: BusinessParam[]) => void }) {
  const [value, setValue] = useState<string>(String(param.current_value));
  const [effectiveFrom, setEffectiveFrom] = useState<string>(todayLocalISO());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(param.current_value));
  }, [param.current_value]);

  async function handleSave() {
    setError(null);
    if (value.trim() === '' || Number.isNaN(Number(value))) {
      setError('Informe um valor numérico.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Indique o motivo da alteração (mínimo 5 caracteres).');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ parameters: BusinessParam[] }>(`/api/business-parameters/${param.key}`, {
        method: 'PUT',
        body: JSON.stringify({ value: Number(value), effective_from: effectiveFrom, reason: reason.trim() }),
      });
      setReason('');
      onSaved(res.parameters);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível guardar a alteração.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-900">{param.label}</h3>
          <p className="mt-1 text-xs text-slate-600">{param.description}</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Valor vigente</div>
          <div className="font-display text-2xl font-bold text-slate-900 tabular-nums">
            {formatValue(param.current_value, param.unit, param.options)}
          </div>
          {param.current_effective_from && (
            <div className="text-[11px] text-slate-500">
              desde {formatDatePT(param.current_effective_from, false)}
            </div>
          )}
        </div>
      </div>

      {param.scheduled.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold">Alterações já agendadas</div>
          <ul className="mt-1 space-y-0.5">
            {param.scheduled.map((s) => (
              <li key={s.effective_from}>
                {formatValue(Number(s.value), param.unit, param.options)} a partir de {formatDatePT(s.effective_from, false)}
                {s.reason ? ` — ${s.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-12 md:items-end">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700">Novo valor ({param.unit})</label>
          {param.options ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {param.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              step={param.unit === '%' || param.unit === 'sim/não' || param.unit === 'dias' ? '1' : '0.01'}
              min={param.min}
              max={param.max}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
          )}
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700">Vigente a partir de</label>
          <input
            type="date"
            min={todayLocalISO()}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-5">
          <label className="block text-xs font-medium text-slate-700">Motivo (obrigatório)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: Acordo com o parceiro Berens para 2027"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'A guardar...' : 'Registar alteração'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">
          Histórico de alterações ({param.history.length})
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-slate-200 text-[11px] font-medium text-slate-500">
              <tr>
                <th className="py-2 pr-3">Vigente desde</th>
                <th className="py-2 pr-3 text-right">Valor</th>
                <th className="py-2 pr-3">Motivo</th>
                <th className="py-2 pr-3">Registado por</th>
                <th className="py-2">Registado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {param.history.map((h) => (
                <tr key={h.effective_from}>
                  <td className="py-2 pr-3 tabular-nums">{formatDatePT(h.effective_from, false)}</td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">
                    {formatValue(Number(h.value), param.unit, param.options)}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{h.reason || '—'}</td>
                  <td className="py-2 pr-3 text-slate-600">{h.changed_by || '—'}</td>
                  <td className="py-2 tabular-nums text-slate-500">{formatDatePT(h.changed_at, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function AdminBusinessParamsPage() {
  const [params, setParams] = useState<BusinessParam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ parameters: BusinessParam[] }>('/api/business-parameters');
      setParams(res.parameters);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar parâmetros.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSaved(updated: BusinessParam[]) {
    setParams(updated);
    setToast('Alteração registada. Fica vigente na data escolhida; ordens anteriores não mudam.');
    setTimeout(() => setToast(null), 5000);
  }

  return (
    <PortalLayout title="Parâmetros do Negócio" breadcrumb="Administração">
      <div className="space-y-6">
        <p className="max-w-3xl text-xs text-slate-600">
          Regras que a gestão pode alterar sem programação. Cada alteração tem data de vigência e motivo, e fica no
          histórico. Ordens já criadas mantêm a regra que estava vigente na data em que foram criadas.
        </p>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            {toast}
          </div>
        )}

        {loading ? (
          <div className="text-xs text-slate-500">A carregar parâmetros...</div>
        ) : (
          params.map((p) => <ParamCard key={p.key} param={p} onSaved={handleSaved} />)
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Repasse por técnico e por parceiro</h2>
          <p className="text-xs text-slate-600">
            Cada técnico ou organização parceira pode ter a sua própria percentagem. Quando não há valor próprio, vale o
            repasse padrão acima. Esses valores são editados nas fichas de cada um.
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            <Link to="/admin/tecnicos" className="font-medium text-slate-900 underline hover:text-slate-700">
              Técnicos
            </Link>
            <Link to="/admin/empresas" className="font-medium text-slate-900 underline hover:text-slate-700">
              Organizações e parceiros
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Regras fixas do sistema</h2>
            <p className="mt-1 text-xs text-slate-600">
              Estas regras não são editáveis aqui. Ficam no código porque mudam a lógica de cálculo ou são exigências
              legais.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {FIXED_RULES.map((r) => (
              <li key={r.title} className="py-3">
                <div className="text-xs font-semibold text-slate-800">{r.title}</div>
                <div className="mt-0.5 text-xs text-slate-600">{r.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PortalLayout>
  );
}
