import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';
import { getParamAt } from '../params.ts';

// Administração de pessoas e organizações (organizações, técnicos, clientes e espelho do técnico),
// movida de server.ts sem alteração de comportamento.
// registerPessoasRoutes: 8 rotas (organizações, técnicos e clientes), no bloco original (de ORGANIZATIONS até CUSTOMERS).
// registerEspelhoTecnicoRoutes: 1 rota (espelho do técnico), no ponto original (depois de ratings / ... / TECHNICIANS).
// Dependências de server.ts entram por ctx: getProfilePayload, projectOrderForRole, e hashPassword (de db.ts).

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

interface AuthUser {
  id: string;
  role: UserRole;
  organization_id: string | null;
  full_name: string;
}

export interface PessoasRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  hashPassword: (password: string) => string;
  getProfilePayload: (userId: string) => any;
  projectOrderForRole: (order: any, role: UserRole) => any;
}

export function registerPessoasRoutes(app: express.Express, ctx: PessoasRouteContext) {
  const { db, requireAuth, hashPassword, getProfilePayload } = ctx;

  app.get('/api/organizations', requireAuth(['super_admin', 'company_admin', 'partner_requester']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    let rows: any[];
    if (user.role === 'super_admin') {
      rows = db.prepare('SELECT * FROM organizations ORDER BY org_type, name').all();
    } else {
      rows = db.prepare('SELECT * FROM organizations WHERE id = ?').all(user.organization_id);
    }
    res.json({
      organizations: rows.map((o) => ({ ...o, is_active: Boolean(o.is_active) })),
    });
  });

  app.post('/api/organizations', requireAuth(['super_admin']), (req, res) => {
    const { name, nif, org_type, email, phone, address, custom_payout_percentage } = req.body ?? {};
    if (!name || !org_type) {
      return res.status(400).json({ error: 'Nome e tipo de organização obrigatórios.' });
    }
    const id = `org-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO organizations (id, name, nif, org_type, email, phone, address, custom_payout_percentage, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      name.trim(),
      nif || null,
      org_type,
      email || null,
      phone || null,
      address || null,
      Number(custom_payout_percentage ?? getParamAt(db, 'payout_default_pct'))
    );
    const created = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as any;
    res.status(201).json({ organization: { ...created, is_active: Boolean(created.is_active) } });
  });

  app.patch('/api/organizations/:id', requireAuth(['super_admin']), (req, res) => {
    const { name, nif, custom_payout_percentage, is_active, email, phone, address } = req.body ?? {};
    db.prepare(`
      UPDATE organizations SET
        name = COALESCE(?, name),
        nif = COALESCE(?, nif),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        custom_payout_percentage = COALESCE(?, custom_payout_percentage),
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? null,
      nif ?? null,
      email ?? null,
      phone ?? null,
      address ?? null,
      custom_payout_percentage !== undefined ? Number(custom_payout_percentage) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id) as any;
    res.json({ organization: { ...updated, is_active: Boolean(updated.is_active) } });
  });

  // TECHNICIANS (SUPER ADMIN & COMPANY ADMIN)
  app.get('/api/technicians', requireAuth(['super_admin', 'company_admin', 'customer']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    if (user.role === 'customer') {
      // Customers only see their previously completed technicians for "Quero o mesmo técnico"
      const prevTechs = db
        .prepare(`
          SELECT DISTINCT p.id, p.full_name, p.avatar_url
          FROM service_orders so
          JOIN profiles p ON p.id = so.technician_id
          WHERE so.customer_id = ? AND so.status = 'completed' AND so.deleted_at IS NULL
        `)
        .all(user.id);
      return res.json({ technicians: prevTechs });
    }

    let query = `
      SELECT p.id, p.organization_id, o.name as organization_name, o.custom_payout_percentage as org_payout_pct,
             p.role, p.full_name, p.email, p.phone, p.nif, p.iban, p.address, p.city, p.postal_code,
             p.emergency_contact, p.is_paused, p.mileage_enabled,
             p.custom_payout_percentage, p.is_active, p.avatar_url, p.created_at
      FROM profiles p
      LEFT JOIN organizations o ON o.id = p.organization_id
      WHERE p.role = 'technician'
    `;
    const params: any[] = [];
    if (user.role === 'company_admin') {
      query += ' AND p.organization_id = ?';
      params.push(user.organization_id);
    }
    query += ' ORDER BY p.full_name';
    const rows = db.prepare(query).all(...params).map((t: any) => ({
      ...t,
      is_active: Boolean(t.is_active),
      is_paused: Boolean(t.is_paused),
      mileage_enabled: Boolean(t.mileage_enabled ?? 1),
      effective_payout_percentage: t.custom_payout_percentage ?? t.org_payout_pct ?? getParamAt(db, 'payout_default_pct'),
    }));
    res.json({ technicians: rows });
  });

  app.post('/api/technicians', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { full_name, email, phone, nif, iban, emergency_contact, organization_id, custom_payout_percentage } = req.body ?? {};
    if (!full_name || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
    }
    const existing = db.prepare('SELECT id FROM profiles WHERE lower(email) = lower(?)').get(email.trim());
    if (existing) {
      return res.status(409).json({ error: 'Já existe um utilizador com este e-mail.' });
    }
    const id = `user-tech-${crypto.randomUUID().slice(0, 6)}`;
    const orgId = user.role === 'company_admin' ? user.organization_id : (organization_id || 'org-matrix');
    // C-06: senha inicial aleatória, mostrada uma única vez a quem criou; o técnico troca no primeiro acesso
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const passHash = hashPassword(tempPassword);

    db.prepare(`
      INSERT INTO profiles (id, organization_id, role, full_name, email, password_hash, phone, nif, iban, emergency_contact, custom_payout_percentage, is_active, must_change_password)
      VALUES (?, ?, 'technician', ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
    `).run(
      id,
      orgId,
      full_name.trim(),
      email.trim().toLowerCase(),
      passHash,
      phone || null,
      nif || null,
      iban || null,
      emergency_contact || null,
      user.role === 'super_admin' && custom_payout_percentage !== undefined && custom_payout_percentage !== ''
        ? Number(custom_payout_percentage)
        : null
    );
    res.status(201).json({ technician: getProfilePayload(id), temporary_password: tempPassword });
  });

  app.patch('/api/technicians/:id', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const target = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id) as any;
    if (!target) return res.status(404).json({ error: 'Técnico não encontrado.' });
    if (user.role === 'company_admin' && target.organization_id !== user.organization_id) {
      return res.status(403).json({ error: 'Sem permissão para editar técnico de outra empresa.' });
    }

    const {
      full_name,
      phone,
      nif,
      iban,
      emergency_contact,
      is_paused,
      organization_id,
      custom_payout_percentage,
      is_active,
      mileage_enabled,
    } = req.body ?? {};

    db.prepare(`
      UPDATE profiles SET
        full_name = COALESCE(?, full_name),
        phone = ?,
        nif = ?,
        iban = ?,
        emergency_contact = ?,
        is_paused = COALESCE(?, is_paused),
        organization_id = ?,
        custom_payout_percentage = ?,
        is_active = COALESCE(?, is_active),
        mileage_enabled = COALESCE(?, mileage_enabled),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      full_name !== undefined && String(full_name).trim() ? String(full_name).trim() : null,
      phone !== undefined ? (phone || null) : target.phone,
      nif !== undefined ? (nif || null) : target.nif,
      iban !== undefined ? (iban || null) : target.iban,
      emergency_contact !== undefined ? (emergency_contact || null) : target.emergency_contact,
      is_paused !== undefined ? (is_paused ? 1 : 0) : null,
      user.role === 'super_admin' ? (organization_id ?? target.organization_id) : target.organization_id,
      user.role === 'super_admin'
        ? custom_payout_percentage === '' || custom_payout_percentage === null
          ? null
          : custom_payout_percentage !== undefined
          ? Number(custom_payout_percentage)
          : target.custom_payout_percentage
        : target.custom_payout_percentage,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      mileage_enabled !== undefined ? (mileage_enabled ? 1 : 0) : null,
      req.params.id
    );

    res.json({ technician: getProfilePayload(req.params.id) });
  });

  // CUSTOMERS B2C DIRECTORY (SUPER ADMIN)
  app.get('/api/customers', requireAuth(['super_admin']), (_req, res) => {
    const customers = db
      .prepare(`
        SELECT p.id, p.organization_id, p.role, p.full_name, p.email, p.phone, p.nif, p.address, p.city, p.postal_code,
               p.is_partner, p.billing_name, p.billing_nif, p.billing_address, p.is_active, p.avatar_url, p.created_at,
               COUNT(so.id) as orders_count,
               COALESCE(SUM(CASE WHEN so.status = 'completed' THEN so.total_customer_amount ELSE 0 END), 0) as total_spent
        FROM profiles p
        LEFT JOIN service_orders so ON so.customer_id = p.id AND so.deleted_at IS NULL
        WHERE p.role = 'customer'
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `)
      .all()
      .map((c: any) => ({
        ...c,
        is_active: Boolean(c.is_active),
        is_partner: Boolean(c.is_partner),
        orders_count: Number(c.orders_count || 0),
        total_spent: Math.round(Number(c.total_spent || 0) * 100) / 100,
      }));
    res.json({ customers });
  });

  app.patch('/api/customers/:id', requireAuth(['super_admin']), (req, res) => {
    const target = db.prepare("SELECT * FROM profiles WHERE id = ? AND role = 'customer'").get(req.params.id) as any;
    if (!target) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const {
      full_name,
      phone,
      nif,
      address,
      city,
      postal_code,
      is_partner,
      billing_name,
      billing_nif,
      billing_address,
      is_active,
    } = req.body ?? {};

    db.prepare(`
      UPDATE profiles SET
        full_name = ?,
        phone = ?,
        nif = ?,
        address = ?,
        city = ?,
        postal_code = ?,
        is_partner = COALESCE(?, is_partner),
        billing_name = ?,
        billing_nif = ?,
        billing_address = ?,
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      full_name !== undefined && String(full_name).trim() ? String(full_name).trim() : target.full_name,
      phone !== undefined ? (phone || null) : target.phone,
      nif !== undefined ? (nif || null) : target.nif,
      address !== undefined ? (address || null) : target.address,
      city !== undefined ? (city || null) : target.city,
      postal_code !== undefined ? (postal_code || null) : target.postal_code,
      is_partner !== undefined ? (is_partner ? 1 : 0) : null,
      billing_name !== undefined ? (billing_name || null) : target.billing_name,
      billing_nif !== undefined ? (billing_nif || null) : target.billing_nif,
      billing_address !== undefined ? (billing_address || null) : target.billing_address,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      target.id
    );

    res.json({ customer: getProfilePayload(target.id) });
  });
}

export function registerEspelhoTecnicoRoutes(app: express.Express, ctx: PessoasRouteContext) {
  const { db, requireAuth, getProfilePayload, projectOrderForRole } = ctx;

  app.get('/api/technicians/:id/mirror', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const tech = getProfilePayload(req.params.id);
    if (!tech || tech.role !== 'technician') {
      return res.status(404).json({ error: 'Técnico não encontrado.' });
    }
    if (user.role === 'company_admin' && tech.organization_id !== user.organization_id) {
      return res.status(403).json({ error: 'Sem permissão para espelhar técnico de outra empresa.' });
    }

    const availableOrders = db
      .prepare(`
        SELECT * FROM service_orders
        WHERE deleted_at IS NULL AND status = 'pending' AND technician_id IS NULL AND provider_org_id = ?
        ORDER BY scheduled_at ASC
      `)
      .all(tech.organization_id || 'org-matrix')
      .map((o: any) => projectOrderForRole(o, 'technician'));

    const assignedOrders = db
      .prepare(`
        SELECT * FROM service_orders
        WHERE deleted_at IS NULL AND technician_id = ?
        ORDER BY scheduled_at DESC
      `)
      .all(tech.id)
      .map((o: any) => projectOrderForRole(o, 'technician'));

    const payouts = db
      .prepare('SELECT * FROM weekly_payouts WHERE technician_id = ? ORDER BY week_start DESC LIMIT 12')
      .all(tech.id);

    const trips = db
      .prepare('SELECT * FROM mileage_trips WHERE technician_id = ? ORDER BY started_at DESC LIMIT 20')
      .all(tech.id);

    const notifications = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 15')
      .all(tech.id)
      .map((n: any) => ({ ...n, is_read: Boolean(n.is_read) }));

    const returnVisits = db
      .prepare(`
        SELECT rv.*, so.reference_code, so.service_name, so.service_address
        FROM warranty_return_visits rv
        JOIN service_orders so ON so.id = rv.service_order_id
        WHERE so.deleted_at IS NULL AND COALESCE(rv.technician_id, so.technician_id) = ?
        ORDER BY rv.scheduled_at ASC
      `)
      .all(tech.id);

    res.json({
      technician: tech,
      availableOrders,
      assignedOrders,
      returnVisits,
      payouts,
      trips,
      notifications,
    });
  });
}
