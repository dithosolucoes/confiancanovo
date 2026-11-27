// Restauração de cópia de segurança em duas etapas (a base em uso nunca é trocada com o servidor aberto):
//  1) a gestão envia o arquivo; ele é validado e fica em "<base>.restore-pending";
//     a base atual é guardada em "<base>.antes-restauro-<data>" antes de qualquer troca;
//  2) na próxima inicialização, antes de abrir a base, o arquivo pendente passa a ser a base.
import fs from 'node:fs';
import Database from 'better-sqlite3';

const SQLITE_MAGIC = 'SQLite format 3\u0000';
const REQUIRED_TABLES = ['organizations', 'profiles', 'service_orders', 'weekly_payouts', 'cash_flow_entries'];

export function pendingRestorePath(dbPath: string): string {
  return `${dbPath}.restore-pending`;
}

// Confere se o arquivo é uma base SQLite do sistema, com as tabelas principais.
export function validateBackupFile(file: string): { ok: true } | { ok: false; error: string } {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString('binary') !== SQLITE_MAGIC) return { ok: false, error: 'O arquivo não é uma base SQLite.' };
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
    const missing = REQUIRED_TABLES.filter((t) => !names.includes(t));
    if (missing.length) return { ok: false, error: `Base incompleta: faltam as tabelas ${missing.join(', ')}.` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Não foi possível ler o arquivo: ${err?.message || 'erro'}.` };
  } finally {
    db?.close();
  }
}

// Chamado no arranque, antes de abrir a base. Devolve o caminho da cópia guardada, se houve troca.
export function applyPendingRestore(dbPath: string): string | null {
  const pending = pendingRestorePath(dbPath);
  if (!fs.existsSync(pending)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = `${dbPath}.substituida-${stamp}`;
  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, archive);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.renameSync(dbPath + ext, archive + ext);
  }
  fs.renameSync(pending, dbPath);
  console.info(`[restauro] base restaurada. Base anterior guardada em ${archive}`);
  return archive;
}
