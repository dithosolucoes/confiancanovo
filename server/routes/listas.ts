import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';

// Rotas de listas configuráveis, movidas de server.ts sem alteração de comportamento.
// Duas funções, cada uma registrada no ponto original de server.ts:
// - registerCatalogoRoutes: catálogo de serviços (era após o dashboard executivo).
// - registerTiposERefRoutes: tipos de aparelho e prefixos de referência (era após o backup).

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

export interface ListasRouteContext {
  db: Db;
  requireAuth: RequireAuth;
}

interface AuthUser {
  role: UserRole;
}

export function registerCatalogoRoutes(app: express.Express, ctx: ListasRouteContext) {
  const { db, requireAuth } = ctx;

  // =========================================================================
  // CATALOG
  // =========================================================================
  app.get('/api/catalog', (_req, res) => {
    const items = db
      .prepare('SELECT * FROM service_catalog ORDER BY category, name')
      .all()
      .map((i: any) => ({
        ...i,
        is_active: Boolean(i.is_active),
        is_subscription: Boolean(i.is_subscription),
      }));
    res.json({ catalog: items });
  });

  app.post('/api/catalog', requireAuth(['super_admin']), (req, res) => {
    const {
      category,
      name,
      description,
      base_service_fee,
      default_vat_rate,
      is_subscription,
      subscription_price,
      warranty_months,
    } = req.body ?? {};
    if (!category || !name) {
      return res.status(400).json({ error: 'Categoria e nome obrigatórios.' });
    }
    const id = `cat-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO service_catalog (
        id, category, name, description, base_service_fee, default_vat_rate,
        is_subscription, subscription_price, warranty_months, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      category,
      name,
      description || '',
      Number(base_service_fee) || 55,
      Number(default_vat_rate) === 6 ? 6 : 23,
      is_subscription ? 1 : 0,
      is_subscription ? Number(subscription_price || base_service_fee || 49.99) : null,
      Number(warranty_months ?? 6)
    );
    const created = db.prepare('SELECT * FROM service_catalog WHERE id = ?').get(id) as any;
    res.status(201).json({
      item: {
        ...created,
        is_active: Boolean(created.is_active),
        is_subscription: Boolean(created.is_subscription),
      },
    });
  });

  app.patch('/api/catalog/:id', requireAuth(['super_admin']), (req, res) => {
    const {
      base_service_fee,
      default_vat_rate,
      is_active,
      name,
      category,
      description,
      is_subscription,
      subscription_price,
      warranty_months,
    } = req.body ?? {};
    db.prepare(`
      UPDATE service_catalog SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        base_service_fee = COALESCE(?, base_service_fee),
        default_vat_rate = COALESCE(?, default_vat_rate),
        is_subscription = COALESCE(?, is_subscription),
        subscription_price = COALESCE(?, subscription_price),
        warranty_months = COALESCE(?, warranty_months),
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      name ?? null,
      category ?? null,
      description ?? null,
      base_service_fee !== undefined ? Number(base_service_fee) : null,
      default_vat_rate !== undefined ? (Number(default_vat_rate) === 6 ? 6 : 23) : null,
      is_subscription !== undefined ? (is_subscription ? 1 : 0) : null,
      subscription_price !== undefined ? Number(subscription_price) : null,
      warranty_months !== undefined ? Number(warranty_months) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM service_catalog WHERE id = ?').get(req.params.id) as any;
    res.json({
      item: {
        ...updated,
        is_active: Boolean(updated.is_active),
        is_subscription: Boolean(updated.is_subscription),
      },
    });
  });

}

export function registerTiposERefRoutes(app: express.Express, ctx: ListasRouteContext) {
  const { db, requireAuth } = ctx;

  // =========================================================================
  // LISTAS CONFIGURÁVEIS: TIPOS DE APARELHO E PREFIXOS DOS CÓDIGOS DE REFERÊNCIA
  // =========================================================================
  app.get('/api/appliance-types', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const all = user.role === 'super_admin' && req.query.all === '1';
    const rows = db
      .prepare(`SELECT id, name, active, sort_order FROM appliance_types ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, name`)
      .all() as any[];
    res.json({ appliance_types: rows.map((r) => ({ ...r, active: Boolean(r.active) })) });
  });

  app.post('/api/appliance-types', requireAuth(['super_admin']), (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    if (db.prepare('SELECT id FROM appliance_types WHERE name = ?').get(name)) {
      return res.status(409).json({ error: 'Já existe um tipo com este nome.' });
    }
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM appliance_types').get() as { m: number };
    db.prepare('INSERT INTO appliance_types (id, name, active, sort_order) VALUES (?, ?, 1, ?)').run(
      `apt-${crypto.randomUUID().slice(0, 8)}`,
      name,
      max.m + 1
    );
    res.status(201).json({ ok: true });
  });

  app.patch('/api/appliance-types/:id', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT * FROM appliance_types WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Tipo não encontrado.' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    if (name !== existing.name && db.prepare('SELECT id FROM appliance_types WHERE name = ?').get(name)) {
      return res.status(409).json({ error: 'Já existe um tipo com este nome.' });
    }
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
    db.prepare('UPDATE appliance_types SET name = ?, active = ? WHERE id = ?').run(name, active, existing.id);
    res.json({ ok: true });
  });

  app.get('/api/reference-prefixes', requireAuth(), (_req, res) => {
    res.json({ prefixes: db.prepare('SELECT service_kind, prefix, label FROM reference_prefixes ORDER BY label').all() });
  });

  app.put('/api/reference-prefixes/:kind', requireAuth(['super_admin']), (req, res) => {
    const prefix = String(req.body?.prefix ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(prefix)) return res.status(400).json({ error: 'Prefixo deve ter 2 ou 3 letras.' });
    const result = db.prepare('UPDATE reference_prefixes SET prefix = ? WHERE service_kind = ?').run(prefix, req.params.kind);
    if (result.changes === 0) return res.status(404).json({ error: 'Tipo de serviço não encontrado.' });
    res.json({ ok: true });
  });
}
