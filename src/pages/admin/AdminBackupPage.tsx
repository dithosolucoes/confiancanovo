import { useState } from 'react';
import * as XLSX from 'xlsx';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch } from '../../lib/api';

// Cópias de segurança: arquivo da base (.db) e Excel com as tabelas principais.
// Só o super admin vê. O servidor já deixa de fora hashes de senha e tokens.
export function AdminBackupPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreWord, setRestoreWord] = useState('');
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  async function restoreBackup() {
    if (!restoreFile || restoreWord !== 'RESTAURAR') return;
    setBusy(true);
    setError(null);
    setDone(null);
    setRestoreMsg(null);
    try {
      const resp = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Restore-Confirm': 'RESTAURAR',
        },
        body: restoreFile,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Não foi possível enviar a cópia.');
      setRestoreMsg(
        `Cópia recebida. Para restaurar, reinicie o servidor. A base atual foi guardada como ${data.previousBackup}.`
      );
      setRestoreFile(null);
      setRestoreWord('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível restaurar.');
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiFetch<{ generatedAt: string; tables: Record<string, Record<string, unknown>[]> }>(
        '/api/admin/backup/tables'
      );
      const wb = XLSX.utils.book_new();
      for (const [name, rows] of Object.entries(res.tables)) {
        const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ vazio: 'sem registos' }]);
        XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31));
      }
      const day = res.generatedAt.slice(0, 10);
      XLSX.writeFile(wb, `confianca-tabelas-${day}.xlsx`);
      setDone(`Excel gerado com ${Object.keys(res.tables).length} tabelas.`);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível gerar o Excel.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalLayout title="Cópias de Segurança" breadcrumb="Administração">
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</div>
        )}
        {done && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">{done}</div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Cópia completa da base (.db)</h2>
          <p className="text-xs text-slate-600">
            Arquivo SQLite com todos os dados. Serve para restaurar o sistema. Guarde em local seguro: contém dados
            pessoais e financeiros.
          </p>
          <a
            href="/api/admin/backup/database"
            className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Baixar base de dados
          </a>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Excel com as tabelas principais</h2>
          <p className="text-xs text-slate-600">
            Uma aba por tabela: ordens, itens, repasses, caixa, fornecedores, quilometragem, parâmetros, técnicos e
            empresas. Sem senhas.
          </p>
          <button
            type="button"
            onClick={exportExcel}
            disabled={busy}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? 'A gerar...' : 'Exportar Excel'}
          </button>
        </section>

        <section className="rounded-xl border border-rose-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-rose-800">Restaurar uma cópia (.db)</h2>
          <p className="text-xs text-slate-600">
            Isto substitui toda a base pelo arquivo escolhido. Antes, a base atual é guardada automaticamente. A troca
            acontece quando o servidor reinicia, e os dados criados depois da cópia se perdem.
          </p>
          {restoreMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
              {restoreMsg}
            </div>
          )}
          <input
            type="file"
            accept=".db,application/x-sqlite3,application/octet-stream"
            onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
            className="text-xs"
          />
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Escreva RESTAURAR para confirmar</label>
              <input
                type="text"
                value={restoreWord}
                onChange={(e) => setRestoreWord(e.target.value)}
                className="mt-1 w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={restoreBackup}
              disabled={busy || !restoreFile || restoreWord !== 'RESTAURAR'}
              className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              Restaurar esta cópia
            </button>
          </div>
        </section>
      </div>
    </PortalLayout>
  );
}
