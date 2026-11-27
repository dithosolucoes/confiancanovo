import type Database from 'better-sqlite3';

/**
 * Parâmetros do negócio com vigência.
 * Cada alteração cria uma nova versão com "effective_from".
 * Uma ordem/semana usa o valor que estava vigente na data de criação da ordem,
 * então alterar um parâmetro nunca mexe em ordens já criadas.
 */

export type ParamKey =
  | 'payout_default_pct'
  | 'mileage_rate_per_km'
  | 'berens_parts_markup'
  | 'parts_markup_pct'
  | 'cancel_after_accept_tech_pct'
  | 'tech_sees_payouts';

export interface ParamDef {
  key: ParamKey;
  label: string;
  description: string;
  unit: '%' | '€/km' | '×' | 'sim/não';
  min: number;
  max: number;
  defaultValue: number;
}

export const PARAM_DEFS: Record<ParamKey, ParamDef> = {
  payout_default_pct: {
    key: 'payout_default_pct',
    label: 'Repasse padrão ao técnico / parceiro',
    description:
      'Percentagem da Taxa de Serviço, M.O. e Taxa Extra que vai para o técnico quando não há regra própria no técnico ou na organização. Peças e adicional continuam 0%.',
    unit: '%',
    min: 0,
    max: 100,
    defaultValue: 50,
  },
  mileage_rate_per_km: {
    key: 'mileage_rate_per_km',
    label: 'Valor do quilómetro (reembolso)',
    description:
      'Valor pago por km aos técnicos que recebem quilometragem. Técnicos com valor próprio mantêm o deles.',
    unit: '€/km',
    min: 0,
    max: 5,
    defaultValue: 0.4,
  },
  berens_parts_markup: {
    key: 'berens_parts_markup',
    label: 'Multiplicador de peças do parceiro Berens',
    description:
      'Regra antiga da Berens: o custo das peças é multiplicado por este valor. Aplica-se só a serviços antigos marcados com a regra (antes de 15/06/2026). Confirmar o valor com a Elaine.',
    unit: '×',
    min: 1,
    max: 2,
    defaultValue: 1.3,
  },
  parts_markup_pct: {
    key: 'parts_markup_pct',
    label: 'Markup de peças (preço ao cliente sobre o custo)',
    description:
      'Percentagem somada ao custo da peça para o preço ao cliente, aplicada no servidor (ex.: 15 = custo x 1,15). Não é aceite preço informado abaixo do custo.',
    unit: '%',
    min: 0,
    max: 100,
    defaultValue: 15,
  },
  cancel_after_accept_tech_pct: {
    key: 'cancel_after_accept_tech_pct',
    label: 'Técnico em cancelamento depois de aceite',
    description:
      'Quando o cliente cancela uma ordem já aceite pelo técnico, esta percentagem da taxa de serviço vai para o técnico. 0% significa que ele não recebe nada por esse cancelamento.',
    unit: '%',
    min: 0,
    max: 100,
    defaultValue: 0,
  },
  tech_sees_payouts: {
    key: 'tech_sees_payouts',
    label: 'Técnico vê repasses e dados bancários',
    description:
      'Se estiver "Sim", o técnico vê os seus ganhos e repasses e pode editar o IBAN. Se estiver "Não", essas telas ficam escondidas para ele.',
    unit: 'sim/não',
    min: 0,
    max: 1,
    defaultValue: 1,
  },
};

export const PARAM_KEYS = Object.keys(PARAM_DEFS) as ParamKey[];

export const EPOCH_ISO = '2000-01-01T00:00:00.000Z';

/** Converte "2026-08-01", "2026-08-01 10:00:00" ou ISO em ISO UTC normalizado. */
export function toIsoUtc(input: string | Date | null | undefined): string {
  if (!input) return new Date().toISOString();
  if (input instanceof Date) return input.toISOString();
  const raw = String(input).trim();
  // Formato SQLite (datetime('now')) é UTC sem fuso
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? raw.replace(' ', 'T') + 'Z'
    : raw.length === 10
    ? raw + 'T00:00:00.000Z'
    : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function initBusinessParameters(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_parameters (
      param_key TEXT NOT NULL,
      value REAL NOT NULL,
      effective_from TEXT NOT NULL,
      reason TEXT,
      changed_by TEXT,
      changed_at TEXT NOT NULL,
      PRIMARY KEY (param_key, effective_from)
    );
  `);

  // Valores iniciais. Para o km, reaproveita o valor já configurado em mileage_settings.
  const insert = db.prepare(`
    INSERT OR IGNORE INTO business_parameters (param_key, value, effective_from, reason, changed_by, changed_at)
    VALUES (?, ?, ?, 'Valor inicial do sistema', 'sistema', datetime('now'))
  `);
  insert.run('payout_default_pct', PARAM_DEFS.payout_default_pct.defaultValue, EPOCH_ISO);
  insert.run('parts_markup_pct', PARAM_DEFS.parts_markup_pct.defaultValue, EPOCH_ISO);
  const globalRate = db
    .prepare('SELECT rate_per_km FROM mileage_settings WHERE technician_id IS NULL')
    .get() as { rate_per_km: number } | undefined;
  insert.run('mileage_rate_per_km', Number(globalRate?.rate_per_km ?? PARAM_DEFS.mileage_rate_per_km.defaultValue), EPOCH_ISO);
}

/** Valor vigente de um parâmetro numa data (padrão: agora). */
export function getParamAt(db: Database.Database, key: ParamKey, at?: string | Date | null): number {
  const when = toIsoUtc(at ?? new Date());
  const row = db
    .prepare(
      'SELECT value FROM business_parameters WHERE param_key = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1'
    )
    .get(key, when) as { value: number } | undefined;
  return row ? Number(row.value) : PARAM_DEFS[key].defaultValue;
}

export interface ParamVersion {
  value: number;
  effective_from: string;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
}

export function getParamHistory(db: Database.Database, key: ParamKey): ParamVersion[] {
  return db
    .prepare(
      'SELECT value, effective_from, reason, changed_by, changed_at FROM business_parameters WHERE param_key = ? ORDER BY effective_from DESC'
    )
    .all(key) as ParamVersion[];
}

export interface SetParamResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Cria uma nova versão do parâmetro.
 * Regras: valor dentro dos limites; motivo obrigatório (≥ 5 caracteres);
 * vigência não pode ser retroativa (antes de hoje, em UTC); não sobrescreve versão existente.
 */
export function setParam(
  db: Database.Database,
  key: ParamKey,
  input: { value: unknown; effectiveFrom?: string | null; reason: unknown },
  changedBy: string
): SetParamResult {
  const def = PARAM_DEFS[key];
  if (!def) return { ok: false, status: 404, error: 'Parâmetro desconhecido.' };

  const value = Number(input.value);
  if (input.value === '' || input.value === null || input.value === undefined || !Number.isFinite(value)) {
    return { ok: false, status: 400, error: 'Valor inválido.' };
  }
  if (value < def.min || value > def.max) {
    return { ok: false, status: 400, error: `O valor deve estar entre ${def.min} e ${def.max} (${def.unit}).` };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 5) {
    return { ok: false, status: 400, error: 'Indique o motivo da alteração (mínimo 5 caracteres).' };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const effective = input.effectiveFrom ? toIsoUtc(input.effectiveFrom) : new Date().toISOString();
  if (effective < todayStart.toISOString()) {
    return { ok: false, status: 400, error: 'A vigência não pode ser retroativa. Escolha hoje ou uma data futura.' };
  }

  const exists = db
    .prepare('SELECT 1 FROM business_parameters WHERE param_key = ? AND effective_from = ?')
    .get(key, effective);
  if (exists) {
    return { ok: false, status: 409, error: 'Já existe uma alteração com esta vigência. Escolha outra data.' };
  }

  db.prepare(`
    INSERT INTO business_parameters (param_key, value, effective_from, reason, changed_by, changed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(key, value, effective, reason, changedBy);

  return { ok: true };
}
