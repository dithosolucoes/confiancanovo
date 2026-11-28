// Validação de formato de dados de cadastro e perfil (A-08) e auditoria de troca de IBAN (A-16).
// Campos vazios são aceites (opcionais) e devolvem valor nulo; mensagens de erro em português.
import crypto from 'node:crypto';

type Db = typeof import('../db.ts').db;

export interface ResultadoValidacao {
  valor: string | null;
  erro?: string;
}

export function validarNif(raw: unknown): ResultadoValidacao {
  const s = String(raw ?? '').replace(/\s+/g, '');
  if (!s) return { valor: null };
  if (!/^\d{9}$/.test(s)) return { valor: null, erro: 'NIF inválido. Use 9 dígitos.' };
  return { valor: s };
}

export function validarIban(raw: unknown): ResultadoValidacao {
  const s = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!s) return { valor: null };
  const formatoIso = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s);
  const formatoPt = !s.startsWith('PT') || /^PT\d{23}$/.test(s);
  if (!formatoIso || !formatoPt) {
    return {
      valor: null,
      erro: 'IBAN inválido. Use o formato ISO; para Portugal, PT seguido de 23 dígitos (25 caracteres).',
    };
  }
  return { valor: s };
}

export function validarTelefone(raw: unknown): ResultadoValidacao {
  const original = String(raw ?? '').trim();
  const s = original.replace(/[\s.-]/g, '');
  if (!s) return { valor: null };
  if (!/^(\+\d{1,3})?\d{9,12}$/.test(s)) {
    return { valor: null, erro: 'Telefone inválido. Use 9 dígitos (ex.: 912345678), com indicativo opcional.' };
  }
  return { valor: original };
}

export function validarCodigoPostal(raw: unknown): ResultadoValidacao {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return { valor: null };
  const m = /^(\d{4})-?(\d{3})$/.exec(s);
  if (!m) return { valor: null, erro: 'Código postal inválido. Use o formato NNNN-NNN.' };
  return { valor: `${m[1]}-${m[2]}` };
}

// Mantém o valor atual quando a entrada não mudou: dados antigos que não cumprem o formato não bloqueiam
// edições de outros campos.
export function valorAlterado(novo: unknown, atual: unknown): boolean {
  return String(novo ?? '').replace(/\s+/g, '').toUpperCase() !== String(atual ?? '').replace(/\s+/g, '').toUpperCase();
}

export function mascararIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const s = String(iban).replace(/\s+/g, '').toUpperCase();
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}${'*'.repeat(s.length - 8)}${s.slice(-4)}`;
}

// A-16: cada troca de IBAN grava quem, quando e o valor antigo mascarado.
export function registrarAuditoriaIban(
  db: Db,
  params: { profileId: string; actorId: string; actorRole: string; ibanAntigo: string | null | undefined }
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS iban_audit_log (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_by_role TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      old_iban_masked TEXT
    )
  `);
  db.prepare(`
    INSERT INTO iban_audit_log (id, profile_id, changed_by, changed_by_role, old_iban_masked)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `iba-${crypto.randomUUID().slice(0, 8)}`,
    params.profileId,
    params.actorId,
    params.actorRole,
    mascararIban(params.ibanAntigo)
  );
}
