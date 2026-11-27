import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';

// Assinaturas (plano mensal de limpeza), movidas de server.ts sem alteração de comportamento.
// Quatro rotas, na mesma ordem, no mesmo ponto. Dependências de funções de módulo de server.ts entram por ctx:
// numeração de referência, prefixo, recálculo da ordem (db.ts), projeção por papel e notificação.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

interface AuthUser {
  id: string;
  role: UserRole;
  full_name: string;
}

export interface AssinaturasRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  nextReferenceCode: (prefix: string) => string;
  referencePrefixFor: (serviceKind: string) => string;
  recalculateOrderInDb: (orderId: string) => any;
  projectOrderForRole: (order: any, role: UserRole) => any;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
}

export function registerAssinaturasRoutes(app: express.Express, ctx: AssinaturasRouteContext) {
  const { db, requireAuth, nextReferenceCode, referencePrefixFor, recalculateOrderInDb, projectOrderForRole, createNotification } = ctx;

  app.get('/api/subscriptions', requireAuth(['customer', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    let query = `
      SELECT s.*, p.full_name as customer_name, p.email as customer_email, p.phone as customer_phone
      FROM service_subscriptions s
      JOIN profiles p ON p.id = s.customer_id
    `;
    const params: any[] = [];
    if (user.role === 'customer') {
      query += ' WHERE s.customer_id = ?';
      params.push(user.id);
    }
    query += ' ORDER BY s.created_at DESC';
    res.json({ subscriptions: db.prepare(query).all(...params) });
  });

  app.post('/api/subscriptions', requireAuth(['customer', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const {
      catalog_id = 'cat-limpeza-sub',
      service_address,
      preferred_day = 15,
      customer_id,
      create_initial_order = false,
    } = req.body ?? {};
    if (!service_address || !String(service_address).trim()) {
      return res.status(400).json({ error: 'Morada obrigatória para subscrição.' });
    }
    const targetCustomerId = user.role === 'super_admin' && customer_id ? customer_id : user.id;
    const customerProfile = db
      .prepare('SELECT id, full_name, phone FROM profiles WHERE id = ?')
      .get(targetCustomerId) as { id: string; full_name: string; phone?: string | null } | undefined;
    if (!customerProfile) {
      return res.status(404).json({ error: 'Cliente selecionado não encontrado.' });
    }

    const cat = db.prepare('SELECT * FROM service_catalog WHERE id = ?').get(catalog_id) as any;
    const planName = cat?.name || 'Plano Mensal Limpeza Residencial (€49,99)';
    const price = Number(cat?.subscription_price || cat?.base_service_fee || 49.99);
    const cleanAddress = String(service_address).trim();
    const safeDay = Math.min(28, Math.max(1, Number(preferred_day) || 15));

    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const id = `sub-${crypto.randomUUID().slice(0, 8)}`;

    let initialOrder: any = null;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO service_subscriptions (id, customer_id, catalog_id, plan_name, monthly_price, service_address, preferred_day, status, next_billing_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        id,
        targetCustomerId,
        catalog_id,
        planName,
        price,
        cleanAddress,
        safeDay,
        nextDate.toISOString().split('T')[0]
      );

      if (create_initial_order) {
        const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
        const referenceCode = nextReferenceCode(referencePrefixFor('avulso'));
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const scheduledIso = new Date(`${todayStr}T10:00:00Z`).toISOString();

        db.prepare(`
          INSERT INTO service_orders (
            id, reference_code, catalog_id, service_name, category, description, urgency,
            customer_id, customer_name, customer_phone, provider_org_id,
            service_address, scheduled_at, status, vat_rate, service_fee
          ) VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, 'org-matrix', ?, ?, 'pending', ?, ?)
        `).run(
          orderId,
          referenceCode,
          catalog_id || null,
          planName,
          cat?.category || 'Limpeza',
          `1.ª visita mensal da subscrição (${id}).`,
          targetCustomerId,
          customerProfile.full_name,
          customerProfile.phone || null,
          cleanAddress,
          scheduledIso,
          cat?.default_vat_rate === 6 ? 6 : 23,
          price
        );

        db.prepare(`
          UPDATE service_subscriptions SET last_order_generated_at = datetime('now') WHERE id = ?
        `).run(id);

        initialOrder = recalculateOrderInDb(orderId);
      }
    })();

    createNotification(
      targetCustomerId,
      'Subscrição Mensal Ativada',
      `${planName} (€ ${price.toFixed(2)}/mês) para ${cleanAddress}.`,
      'email'
    );

    if (initialOrder) {
      createNotification(
        targetCustomerId,
        `1.ª Ordem Mensal Criada (${initialOrder.reference_code})`,
        `A 1.ª visita do plano ${planName} foi criada para ${cleanAddress}.`,
        'in_app'
      );
    }

    res.status(201).json({
      subscription: db
        .prepare(
          `SELECT s.*, p.full_name as customer_name, p.email as customer_email, p.phone as customer_phone
           FROM service_subscriptions s
           JOIN profiles p ON p.id = s.customer_id
           WHERE s.id = ?`
        )
        .get(id),
      initialOrder: initialOrder ? projectOrderForRole(initialOrder, user.role) : null,
    });
  });

  app.patch('/api/subscriptions/:id', requireAuth(['customer', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const sub = db.prepare('SELECT * FROM service_subscriptions WHERE id = ?').get(req.params.id) as any;
    if (!sub) return res.status(404).json({ error: 'Subscrição não encontrada.' });
    if (user.role !== 'super_admin' && sub.customer_id !== user.id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    const valid = ['active', 'paused', 'cancelled'];
    const nextStatus = valid.includes(req.body?.status) ? req.body.status : sub.status;
    db.prepare('UPDATE service_subscriptions SET status = ? WHERE id = ?').run(nextStatus, sub.id);
    res.json({ subscription: db.prepare('SELECT * FROM service_subscriptions WHERE id = ?').get(sub.id) });
  });

  app.post('/api/subscriptions/:id/generate-order', requireAuth(['super_admin']), (req, res) => {
    const sub = db
      .prepare(`
        SELECT s.*, p.full_name as customer_name, p.phone as customer_phone
        FROM service_subscriptions s
        JOIN profiles p ON p.id = s.customer_id
        WHERE s.id = ?
      `)
      .get(req.params.id) as any;
    if (!sub) return res.status(404).json({ error: 'Subscrição não encontrada.' });
    if (sub.status !== 'active') {
      return res.status(400).json({ error: 'Apenas subscrições ativas podem gerar ordens mensais.' });
    }

    const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
    const referenceCode = nextReferenceCode(referencePrefixFor('recorrente'));
    const cat = sub.catalog_id
      ? (db.prepare('SELECT * FROM service_catalog WHERE id = ?').get(sub.catalog_id) as any)
      : null;

    const scheduledIso = sub.next_billing_date
      ? new Date(`${sub.next_billing_date}T10:00:00Z`).toISOString()
      : new Date().toISOString();

    const nextDate = new Date(sub.next_billing_date ? `${sub.next_billing_date}T12:00:00Z` : Date.now());
    nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
    const nextBillingStr = nextDate.toISOString().split('T')[0];

    db.prepare(`
      INSERT INTO service_orders (
        id, reference_code, catalog_id, service_name, category, description, urgency,
        customer_id, customer_name, customer_phone, provider_org_id,
        service_address, scheduled_at, status, vat_rate, service_fee, service_kind
      ) VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, 'org-matrix', ?, ?, 'pending', ?, ?, 'recorrente')
    `).run(
      orderId,
      referenceCode,
      sub.catalog_id || null,
      sub.plan_name,
      cat?.category || 'Limpeza',
      `Ordem gerada automaticamente pela subscrição mensal (${sub.id}).`,
      sub.customer_id,
      sub.customer_name,
      sub.customer_phone || null,
      sub.service_address,
      scheduledIso,
      cat?.default_vat_rate === 6 ? 6 : 23,
      Number(sub.monthly_price)
    );

    db.prepare(`
      UPDATE service_subscriptions SET
        next_billing_date = ?,
        last_order_generated_at = datetime('now')
      WHERE id = ?
    `).run(nextBillingStr, sub.id);

    const updatedOrder = recalculateOrderInDb(orderId);
    createNotification(
      sub.customer_id,
      `Limpeza Mensal Agendada (${referenceCode})`,
      `A sua visita mensal (${sub.plan_name}) foi criada para ${sub.service_address}.`,
      'in_app'
    );

    res.status(201).json({
      order: projectOrderForRole(updatedOrder, 'super_admin'),
      subscription: db.prepare('SELECT * FROM service_subscriptions WHERE id = ?').get(sub.id),
    });
  });
}
