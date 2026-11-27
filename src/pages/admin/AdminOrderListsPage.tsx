import { useCallback, useEffect, useState } from 'react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch } from '../../lib/api';

interface ApplianceRow {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

interface PrefixRow {
  service_kind: string;
  prefix: string;
  label: string;
}

// Listas que o gestor mantém sem programação: tipos de aparelho e prefixos dos códigos de referência.
export function AdminOrderListsPage() {
  const [appliances, setAppliances] = useState<ApplianceRow[]>([]);
  const [prefixes, setPrefixes] = useState<PrefixRow[]>([]);
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [prefixDrafts, setPrefixDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        apiFetch<{ appliance_types: ApplianceRow[] }>('/api/appliance-types?all=1'),
        apiFetch<{ prefixes: PrefixRow[] }>('/api/reference-prefixes'),
      ]);
      setAppliances(a.appliance_types);
      setPrefixes(p.prefixes);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar as listas.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      notify(ok);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Operação não concluída.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalLayout title="Tipos & Referências" breadcrumb="Configuração">
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</div>
        )}
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">{toast}</div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tipos de aparelho</h2>
            <p className="mt-1 text-xs text-slate-600">
              Lista que aparece nos pedidos. Desativar um tipo tira ele da lista, mas as ordens antigas mantêm o nome.
            </p>
          </div>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              void run(
                () => apiFetch('/api/appliance-types', { method: 'POST', body: JSON.stringify({ name }) }),
                'Tipo de aparelho adicionado.'
              ).then(() => setNewName(''));
            }}
          >
            <div className="min-w-[240px] flex-1">
              <label className="block text-xs font-medium text-slate-700">Novo tipo</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Ex: Ar condicionado"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Adicionar
            </button>
          </form>

          <ul className="divide-y divide-slate-100">
            {appliances.map((a) => {
              const draft = drafts[a.id] ?? a.name;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                    maxLength={80}
                    className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={a.active}
                      disabled={busy}
                      onChange={(e) =>
                        run(
                          () =>
                            apiFetch(`/api/appliance-types/${a.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ active: e.target.checked }),
                            }),
                          e.target.checked ? 'Tipo ativado.' : 'Tipo desativado.'
                        )
                      }
                    />
                    Ativo
                  </label>
                  <button
                    type="button"
                    disabled={busy || draft.trim() === a.name || !draft.trim()}
                    onClick={() =>
                      run(
                        () =>
                          apiFetch(`/api/appliance-types/${a.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ name: draft.trim() }),
                          }),
                        'Nome guardado.'
                      )
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Guardar nome
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Códigos de referência</h2>
            <p className="mt-1 text-xs text-slate-600">
              Prefixo de cada tipo de serviço. O número é sequencial e único em toda a base. Exemplo: com o prefixo
              <span className="font-mono"> WO</span>, a ordem sai como <span className="font-mono">WO-2026-0101</span>.
              Mudar o prefixo vale só para as ordens novas.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {prefixes.map((p) => {
              const draft = prefixDrafts[p.service_kind] ?? p.prefix;
              return (
                <li key={p.service_kind} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-[200px] flex-1 text-sm text-slate-900">{p.label}</div>
                  <input
                    type="text"
                    value={draft}
                    maxLength={3}
                    onChange={(e) =>
                      setPrefixDrafts((d) => ({ ...d, [p.service_kind]: e.target.value.toUpperCase() }))
                    }
                    className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-sm uppercase"
                  />
                  <button
                    type="button"
                    disabled={busy || draft === p.prefix || !/^[A-Z]{2,3}$/.test(draft)}
                    onClick={() =>
                      run(
                        () =>
                          apiFetch(`/api/reference-prefixes/${p.service_kind}`, {
                            method: 'PUT',
                            body: JSON.stringify({ prefix: draft }),
                          }),
                        'Prefixo guardado.'
                      )
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Guardar
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </PortalLayout>
  );
}
