import type express from 'express';
import type { UserRole } from '../../src/types/domain.ts';
import { getParamHistory, PARAM_DEFS, PARAM_KEYS, setParam, type ParamKey } from '../params.ts';

// Parâmetros de negócio (com vigência) e taxas base de repasse, movidos de server.ts sem alteração de comportamento.
// As regras de vigência, limites e motivo ficam em server/params.ts (setParam): este módulo só chama essas funções.
// Duas funções, cada uma registrada no ponto original de server.ts:
// - registerBusinessParametersRoutes: era depois das rotas de mileage e antes de partner reports.
// - registerPayoutRatesRoutes: era depois de partner reports e antes de buildReconciliationPreview.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

export interface ParametrosRouteContext {
  db: Db;
  requireAuth: RequireAuth;
}

interface AuthUser {
  id: string;
  role: UserRole;
  full_name: string;
}

export function registerBusinessParametersRoutes(app: express.Express, ctx: ParametrosRouteContext) {
  const { db, requireAuth } = ctx;

  const serializeParams = () =>
    PARAM_KEYS.map((key) => {
      const def = PARAM_DEFS[key];
      const history = getParamHistory(db, key);
      const now = new Date().toISOString();
      const current = history.find((h) => h.effective_from <= now) ?? null;
      const scheduled = history.filter((h) => h.effective_from > now).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      return {
        key,
        label: def.label,
        description: def.description,
        unit: def.unit,
        min: def.min,
        max: def.max,
        current_value: current ? Number(current.value) : def.defaultValue,
        current_effective_from: current?.effective_from ?? null,
        scheduled,
        history,
      };
    });

  app.get('/api/business-parameters', requireAuth(['super_admin']), (_req, res) => {
    res.json({ parameters: serializeParams() });
  });

  app.put('/api/business-parameters/:key', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const key = req.params.key as ParamKey;
    if (!PARAM_KEYS.includes(key)) return res.status(404).json({ error: 'Parâmetro desconhecido.' });
    const { value, effective_from, reason } = req.body ?? {};
    const result = setParam(db, key, { value, effectiveFrom: effective_from, reason }, user.full_name || user.id);
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, parameters: serializeParams() });
  });
}

export function registerPayoutRatesRoutes(app: express.Express, ctx: ParametrosRouteContext) {
  const { db, requireAuth } = ctx;

  app.get('/api/settings/payout-rates', requireAuth(['super_admin', 'company_admin']), (_req, res) => {
    const rates = db
      .prepare(`
        SELECT r.*, p.full_name as updated_by_name
        FROM payout_rate_settings r
        LEFT JOIN profiles p ON p.id = r.updated_by
        ORDER BY r.code
      `)
      .all();
    res.json({ rates });
  });

  app.patch('/api/settings/payout-rates/:code', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { amount, label, description } = req.body ?? {};
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0) {
      return res.status(400).json({ error: 'Valor inválido para a taxa base.' });
    }
    const existing = db
      .prepare('SELECT * FROM payout_rate_settings WHERE code = ?')
      .get(req.params.code) as any;
    if (!existing) return res.status(404).json({ error: 'Regra de taxa não encontrada.' });

    db.prepare(`
      UPDATE payout_rate_settings SET
        amount = ?,
        label = COALESCE(?, label),
        description = COALESCE(?, description),
        updated_by = ?,
        updated_at = datetime('now')
      WHERE code = ?
    `).run(numAmount, label ?? null, description ?? null, user.id, req.params.code);

    const updated = db
      .prepare(`
        SELECT r.*, p.full_name as updated_by_name
        FROM payout_rate_settings r
        LEFT JOIN profiles p ON p.id = r.updated_by
        WHERE r.code = ?
      `)
      .get(req.params.code);
    res.json({ rate: updated });
  });
}
