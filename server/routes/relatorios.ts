import type express from 'express';
import type { UserRole } from '../../src/types/domain.ts';
import { calculateServiceFinancials } from '../../src/core/finance/calculator.ts';
import { getParamAt } from '../params.ts';

// Relatórios, exportação (JSON) e reconciliação, movidos de server.ts sem alteração de comportamento.
// São cinco funções de registro, cada uma chamada no ponto em que as rotas estavam, para manter a ordem:
// - registerDashboardRoutes: dashboard executivo.
// - registerPartnerReportsRoutes: relatório do parceiro.
// - registerReconciliacaoRoutes: pré-visualização e execução da reconciliação (altera valores a pagar).
// - registerAvaliacoesRoutes: avaliações (ratings).
// - registerRelatoriosAdminRoutes: relatório de ordens, logs de e-mail, broadcast e threads de chat.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

interface AuthUser {
  id: string;
  role: UserRole;
  organization_id: string | null;
  full_name: string;
}

export interface RelatoriosBaseContext {
  db: Db;
  requireAuth: RequireAuth;
}

export function registerDashboardRoutes(app: express.Express, ctx: RelatoriosBaseContext) {
  const { db, requireAuth } = ctx;

  app.get('/api/dashboard/executive', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { period, customFrom, customTo, technicianId, partnerOrgId } = req.query as Record<string, string>;

    let where = 'deleted_at IS NULL';
    const params: any[] = [];

    if (user.role === 'company_admin') {
      where += ' AND provider_org_id = ?';
      params.push(user.organization_id);
    }
    if (technicianId && technicianId !== 'all') {
      where += ' AND technician_id = ?';
      params.push(technicianId);
    }
    if (partnerOrgId && partnerOrgId !== 'all') {
      where += ' AND requester_org_id = ?';
      params.push(partnerOrgId);
    }
    // Recortes da Elaine: hoje, semana (domingo a hoje, como o ciclo de repasse) e mês corrente
    const nowDate = new Date();
    const todayIso = nowDate.toISOString().slice(0, 10);
    if (period === 'today') {
      where += ' AND date(COALESCE(scheduled_at, created_at)) = date(?)';
      params.push(todayIso);
    } else if (period === 'week') {
      const weekStart = new Date(nowDate);
      weekStart.setUTCDate(nowDate.getUTCDate() - nowDate.getUTCDay());
      where += ' AND date(COALESCE(scheduled_at, created_at)) >= date(?) AND date(COALESCE(scheduled_at, created_at)) <= date(?)';
      params.push(weekStart.toISOString().slice(0, 10), todayIso);
    } else if (period === 'month') {
      where += " AND strftime('%Y-%m', COALESCE(scheduled_at, created_at)) = strftime('%Y-%m', 'now')";
    } else if (period === '7d') {
      where += " AND datetime(COALESCE(scheduled_at, created_at)) >= datetime('now', '-7 days')";
    } else if (period === '30d') {
      where += " AND datetime(COALESCE(scheduled_at, created_at)) >= datetime('now', '-30 days')";
    } else if (period === 'custom') {
      if (customFrom) {
        where += ' AND date(COALESCE(scheduled_at, created_at)) >= date(?)';
        params.push(customFrom);
      }
      if (customTo) {
        where += ' AND date(COALESCE(scheduled_at, created_at)) <= date(?)';
        params.push(customTo);
      }
    }

    const orders = db
      .prepare(`SELECT * FROM service_orders WHERE ${where}`)
      .all(...params) as any[];

    const completed = orders.filter((o) => o.status === 'completed');
    const openOrders = orders.filter((o) => !['completed', 'cancelled'].includes(o.status));

    const grossBilling = completed.reduce((s, o) => s + Number(o.total_customer_amount), 0);
    const netRevenue = completed.reduce((s, o) => s + Number(o.subtotal_without_vat), 0);
    const techPayoutTotal = completed.reduce((s, o) => s + Number(o.technician_payout), 0);
    const supplierCostTotal = completed.reduce((s, o) => s + Number(o.parts_supplier_total), 0);
    const realProfit =
      user.role === 'super_admin'
        ? completed.reduce((s, o) => s + Number(o.company_gross_margin), 0)
        : techPayoutTotal;
    const avgTicket = completed.length > 0 ? grossBilling / completed.length : 0;

    // Breakdown by status
    const byStatus: Record<string, number> = {};
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    }

    // Recent cash flow summary & expenses by category for super_admin
    let pendingPayables = 0;
    let totalCashBalance = 0;
    const expenseCatMap = new Map<string, number>();
    if (user.role === 'super_admin') {
      const cf = db.prepare('SELECT entry_type, category, amount, status, due_date FROM cash_flow_entries').all() as any[];
      for (const e of cf) {
        if (e.status === 'paid') {
          totalCashBalance += e.entry_type === 'income' ? Number(e.amount) : -Number(e.amount);
        } else if (e.entry_type === 'expense') {
          pendingPayables += Number(e.amount);
        }
        if (e.entry_type === 'expense') {
          const cat = e.category || 'outros';
          expenseCatMap.set(cat, (expenseCatMap.get(cat) || 0) + Number(e.amount));
        }
      }
    }

    // Monthly 6-month series for executive charts
    const monthBuckets: Array<{ key: string; label: string }> = [];
    const now = new Date();
    const monthFmt = new Intl.DateTimeFormat('pt-PT', { month: 'short' });
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = monthFmt.format(d).replace('.', '');
      monthBuckets.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    const bucketMap = new Map(
      monthBuckets.map((b) => [
        b.key,
        { month: b.key, label: b.label, billed: 0, received: 0, realProfit: 0, techPayout: 0 },
      ])
    );
    for (const o of completed) {
      const dateStr = String(o.completed_at || o.scheduled_at || o.created_at || '');
      const key = dateStr.slice(0, 7);
      const bucket = bucketMap.get(key);
      if (bucket) {
        const amt = Number(o.total_customer_amount || 0);
        bucket.billed += amt;
        if (o.baixa_received_at || o.quote_paid || o.service_fee_paid) {
          bucket.received += amt;
        }
        bucket.techPayout += Number(o.technician_payout || 0);
        if (user.role === 'super_admin') {
          bucket.realProfit += Number(o.company_gross_margin || 0);
        }
      }
    }
    const monthlySeries = monthBuckets.map((b) => {
      const item = bucketMap.get(b.key)!;
      return {
        month: item.month,
        label: item.label,
        billed: Math.round(item.billed * 100) / 100,
        received: Math.round(item.received * 100) / 100,
        techPayout: Math.round(item.techPayout * 100) / 100,
        realProfit: user.role === 'super_admin' ? Math.round(item.realProfit * 100) / 100 : undefined,
      };
    });

    const expensesByCategory = Array.from(expenseCatMap.entries())
      .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    // Technician ranking across filtered completed orders
    const techNames = new Map<string, string>(
      (db.prepare("SELECT id, full_name FROM profiles WHERE role = 'technician'").all() as any[]).map((t) => [
        t.id,
        t.full_name,
      ])
    );
    const rankMap = new Map<
      string,
      { technicianId: string; technicianName: string; completedCount: number; grossBilling: number; techPayout: number; ratingSum: number; ratingCount: number }
    >();
    for (const o of completed) {
      if (!o.technician_id) continue;
      const cur = rankMap.get(o.technician_id) || {
        technicianId: o.technician_id,
        technicianName: techNames.get(o.technician_id) || 'Técnico',
        completedCount: 0,
        grossBilling: 0,
        techPayout: 0,
        ratingSum: 0,
        ratingCount: 0,
      };
      cur.completedCount += 1;
      cur.grossBilling += Number(o.total_customer_amount || 0);
      cur.techPayout += Number(o.technician_payout || 0);
      if (o.rating) {
        cur.ratingSum += Number(o.rating);
        cur.ratingCount += 1;
      }
      rankMap.set(o.technician_id, cur);
    }
    const techRanking = Array.from(rankMap.values())
      .map((r) => ({
        technicianId: r.technicianId,
        technicianName: r.technicianName,
        completedCount: r.completedCount,
        grossBilling: Math.round(r.grossBilling * 100) / 100,
        techPayout: Math.round(r.techPayout * 100) / 100,
        avgRating: r.ratingCount > 0 ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : null,
      }))
      .sort((a, b) => b.completedCount - a.completedCount || b.grossBilling - a.grossBilling)
      .slice(0, 8);

    res.json({
      kpis: {
        grossBilling: Math.round(grossBilling * 100) / 100,
        netRevenue: Math.round(netRevenue * 100) / 100,
        realProfit: Math.round(realProfit * 100) / 100,
        techPayoutTotal: Math.round(techPayoutTotal * 100) / 100,
        supplierCostTotal: user.role === 'super_admin' ? Math.round(supplierCostTotal * 100) / 100 : undefined,
        openCount: openOrders.length,
        completedCount: completed.length,
        totalCount: orders.length,
        avgTicket: Math.round(avgTicket * 100) / 100,
        pendingPayables: Math.round(pendingPayables * 100) / 100,
        totalCashBalance: Math.round(totalCashBalance * 100) / 100,
      },
      byStatus,
      charts: {
        monthlySeries,
        expensesByCategory,
        techRanking,
      },
    });
  });
}

export function registerPartnerReportsRoutes(app: express.Express, ctx: RelatoriosBaseContext) {
  const { db, requireAuth } = ctx;

  app.get('/api/partner/reports', requireAuth(['partner_requester', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const orgId = user.role === 'partner_requester' ? user.organization_id : (req.query.orgId as string) || 'org-partner-berens';
    const orders = db
      .prepare(`
        SELECT id, reference_code, service_name, category, service_address, scheduled_at, completed_at,
               status, quote_status, vat_rate, service_fee, labor_cost, extra_fee, additional_cost,
               parts_customer_total, subtotal_without_vat, vat_amount, total_customer_amount, quote_paid, service_fee_paid
        FROM service_orders
        WHERE requester_org_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
      `)
      .all(orgId);
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    res.json({ organization: org, orders });
  });
}

export interface ReconciliacaoRouteContext extends RelatoriosBaseContext {
  recalculateOrderInDb: (orderId: string) => unknown;
}

export function registerReconciliacaoRoutes(app: express.Express, ctx: ReconciliacaoRouteContext) {
  const { db, requireAuth, recalculateOrderInDb } = ctx;

  function buildReconciliationPreview() {
    const items: Array<{
      kind: 'order_payout_mismatch' | 'weekly_payout_total_mismatch' | 'cash_flow_mismatch';
      entityId: string;
      referenceCode: string;
      label: string;
      storedValue: number;
      expectedValue: number;
      difference: number;
    }> = [];

    // 1. Check open/unlocked non-deleted orders
    const openOrders = db
      .prepare(`
        SELECT * FROM service_orders
        WHERE deleted_at IS NULL AND technician_payout_locked = 0 AND technician_payout_overridden = 0
      `)
      .all() as any[];

    for (const order of openOrders) {
      const orderItems = db
        .prepare('SELECT quantity, customer_unit_price, supplier_unit_cost FROM service_order_items WHERE service_order_id = ?')
        .all(order.id) as any[];
      const partsBaseCost = orderItems.reduce((s, i) => s + Number(i.quantity) * Number(i.customer_unit_price), 0);
      const partsSupplierCost = orderItems.reduce((s, i) => s + Number(i.quantity) * Number(i.supplier_unit_cost), 0);

      const defaultPct = getParamAt(db, 'payout_default_pct', order.created_at);
      let customPct = defaultPct;
      if (order.technician_id) {
        const tech = db.prepare('SELECT custom_payout_percentage, organization_id FROM profiles WHERE id = ?').get(order.technician_id) as any;
        const org = db.prepare('SELECT custom_payout_percentage FROM organizations WHERE id = ?').get(tech?.organization_id || order.provider_org_id) as any;
        customPct = tech?.custom_payout_percentage ?? org?.custom_payout_percentage ?? defaultPct;
      } else {
        const org = db.prepare('SELECT custom_payout_percentage FROM organizations WHERE id = ?').get(order.provider_org_id) as any;
        customPct = org?.custom_payout_percentage ?? defaultPct;
      }

      const calc = calculateServiceFinancials({
        serviceFee: Number(order.service_fee),
        laborCost: Number(order.labor_cost),
        extraFee: Number(order.extra_fee),
        additionalCost: Number(order.additional_cost),
        partsBaseCost,
        partsSupplierCost,
        vatRate: Number(order.vat_rate) === 6 ? 6 : 23,
        quoteStatus: order.quote_status,
        isWarranty: Boolean(order.is_warranty),
        legacyPartsMarkup: Boolean(order.legacy_parts_markup),
      partsMarkupMultiplier: getParamAt(db, 'berens_parts_markup', order.created_at),
        legacyPayoutRule: Boolean(order.legacy_payout_rule),
        fixedPayoutAmount: Number(order.fixed_payout_amount || 0),
        createdAt: order.created_at,
        customPayoutPercentage: customPct,
      });

      const stored = Math.round(Number(order.technician_payout) * 100) / 100;
      const expected = calc.technicianPayout;
      if (Math.abs(stored - expected) > 0.005) {
        items.push({
          kind: 'order_payout_mismatch',
          entityId: order.id,
          referenceCode: order.reference_code,
          label: `${order.service_name} — divergência de repasse calculado`,
          storedValue: stored,
          expectedValue: expected,
          difference: Math.round((expected - stored) * 100) / 100,
        });
      }
    }

    // 2. Check unpaid weekly payouts vs sum of their orders and cash_flow_entries
    const openPayouts = db
      .prepare("SELECT * FROM weekly_payouts WHERE status != 'paid'")
      .all() as any[];

    for (const wp of openPayouts) {
      const sumRow = db
        .prepare('SELECT COALESCE(SUM(technician_payout), 0) as total FROM service_orders WHERE weekly_payout_id = ? AND deleted_at IS NULL')
        .get(wp.id) as { total: number };
      const expectedTotal = Math.round(Number(sumRow.total) * 100) / 100;
      const storedTotal = Math.round(Number(wp.total_amount) * 100) / 100;

      if (Math.abs(storedTotal - expectedTotal) > 0.005) {
        items.push({
          kind: 'weekly_payout_total_mismatch',
          entityId: wp.id,
          referenceCode: `${wp.week_start}..${wp.week_end}`,
          label: 'Fechamento semanal pendente vs soma das ordens vinculadas',
          storedValue: storedTotal,
          expectedValue: expectedTotal,
          difference: Math.round((expectedTotal - storedTotal) * 100) / 100,
        });
      }

      const cfRow = db
        .prepare("SELECT id, amount FROM cash_flow_entries WHERE weekly_payout_id = ? AND status != 'paid' LIMIT 1")
        .get(wp.id) as any;
      if (cfRow && Math.abs(Number(cfRow.amount) - expectedTotal) > 0.005) {
        items.push({
          kind: 'cash_flow_mismatch',
          entityId: cfRow.id,
          referenceCode: `${wp.week_start}..${wp.week_end}`,
          label: 'Lançamento em Contas a Pagar divergente do fechamento semanal',
          storedValue: Math.round(Number(cfRow.amount) * 100) / 100,
          expectedValue: expectedTotal,
          difference: Math.round((expectedTotal - Number(cfRow.amount)) * 100) / 100,
        });
      }
    }

    return items;
  }

  app.get('/api/admin/reconciliation/preview', requireAuth(['super_admin']), (_req, res) => {
    const items = buildReconciliationPreview();
    const totalDelta = Math.round(items.reduce((s, i) => s + i.difference, 0) * 100) / 100;
    res.json({ items, totalDelta });
  });

  app.post('/api/admin/reconciliation/execute', requireAuth(['super_admin']), (_req, res) => {
    const preview = buildReconciliationPreview();
    let ordersFixed = 0;
    let payoutsUpdated = 0;
    let cashFlowUpdated = 0;

    const tx = db.transaction(() => {
      for (const item of preview) {
        if (item.kind === 'order_payout_mismatch') {
          recalculateOrderInDb(item.entityId);
          ordersFixed += 1;
        } else if (item.kind === 'weekly_payout_total_mismatch') {
          db.prepare('UPDATE weekly_payouts SET total_amount = ? WHERE id = ? AND status != \'paid\'').run(
            item.expectedValue,
            item.entityId
          );
          payoutsUpdated += 1;
        } else if (item.kind === 'cash_flow_mismatch') {
          db.prepare('UPDATE cash_flow_entries SET amount = ? WHERE id = ? AND status != \'paid\'').run(
            item.expectedValue,
            item.entityId
          );
          cashFlowUpdated += 1;
        }
      }
    });
    tx();

    const totalDelta = Math.round(preview.reduce((s, i) => s + i.difference, 0) * 100) / 100;
    res.json({
      ordersFixed,
      payoutsUpdated,
      cashFlowUpdated,
      totalDelta,
      remaining: buildReconciliationPreview(),
    });
  });
}

export function registerAvaliacoesRoutes(app: express.Express, ctx: RelatoriosBaseContext) {
  const { db, requireAuth } = ctx;

  app.get('/api/admin/ratings', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    let where = 'so.deleted_at IS NULL AND so.rating IS NOT NULL';
    const params: any[] = [];
    if (user.role === 'company_admin') {
      where += ' AND so.provider_org_id = ?';
      params.push(user.organization_id);
    }

    const ratings = db
      .prepare(`
        SELECT so.id, so.reference_code, so.service_name, so.customer_name,
               so.technician_id, p.full_name as technician_name,
               so.rating, so.rating_comment, so.completed_at
        FROM service_orders so
        LEFT JOIN profiles p ON p.id = so.technician_id
        WHERE ${where}
        ORDER BY so.completed_at DESC, so.updated_at DESC
      `)
      .all(...params) as any[];

    const total = ratings.length;
    const avg = total > 0 ? Math.round((ratings.reduce((s, r) => s + Number(r.rating), 0) / total) * 10) / 10 : 0;
    const distribution = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: ratings.filter((r) => Number(r.rating) === stars).length,
    }));

    res.json({ ratings, total, average: avg, distribution });
  });
}

export interface RelatoriosAdminContext extends RelatoriosBaseContext {
  projectOrderForRole: (order: any, role: UserRole) => any;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
  sendTransactionalEmail: (params: {
    to: string;
    subject: string;
    html: string;
    template: string;
    recipientUserId?: string | null;
  }) => Promise<unknown>;
}

export function registerRelatoriosAdminRoutes(app: express.Express, ctx: RelatoriosAdminContext) {
  const { db, requireAuth, projectOrderForRole, createNotification, sendTransactionalEmail } = ctx;

  app.get('/api/admin/reports/orders', requireAuth(['super_admin']), (req, res) => {
    const { scope = 'ALL', status = 'all', technicianId = 'all', dateFrom = '', dateTo = '' } =
      req.query as Record<string, string>;

    let where = 'so.deleted_at IS NULL';
    const params: any[] = [];

    if (scope === 'WO' || scope === 'SR' || scope === 'CO') {
      where += ' AND so.reference_code LIKE ?';
      params.push(`${scope}-%`);
    } else if (scope === 'PARTNER') {
      where += ' AND so.requester_org_id IS NOT NULL';
    }

    if (status && status !== 'all') {
      where += ' AND so.status = ?';
      params.push(status);
    }
    if (technicianId && technicianId !== 'all') {
      where += ' AND so.technician_id = ?';
      params.push(technicianId);
    }
    if (dateFrom) {
      where += ' AND date(so.scheduled_at) >= date(?)';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND date(so.scheduled_at) <= date(?)';
      params.push(dateTo);
    }

    const orders = db
      .prepare(`
        SELECT so.*, p.full_name as technician_name,
               req_org.name as requester_org_name,
               prov_org.name as provider_org_name
        FROM service_orders so
        LEFT JOIN profiles p ON p.id = so.technician_id
        LEFT JOIN organizations req_org ON req_org.id = so.requester_org_id
        LEFT JOIN organizations prov_org ON prov_org.id = so.provider_org_id
        WHERE ${where}
        ORDER BY so.scheduled_at DESC
      `)
      .all(...params)
      .map((o: any) => projectOrderForRole(o, 'super_admin'));

    res.json({ orders });
  });

  app.get('/api/admin/email-logs', requireAuth(['super_admin']), (_req, res) => {
    const logs = db
      .prepare('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 100')
      .all();
    res.json({ logs, resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()) });
  });

  app.post('/api/admin/broadcast', requireAuth(['super_admin']), async (req, res) => {
    const { audience = 'all', subject, message } = req.body ?? {};
    if (!subject || !message) {
      return res.status(400).json({ error: 'Assunto e mensagem são obrigatórios.' });
    }

    let roleFilter = '';
    const params: any[] = [];
    if (audience === 'technicians') {
      roleFilter = "AND role = 'technician'";
    } else if (audience === 'customers') {
      roleFilter = "AND role = 'customer'";
    } else if (audience === 'partners') {
      roleFilter = "AND role = 'partner_requester'";
    } else if (audience === 'company_admins') {
      roleFilter = "AND role = 'company_admin'";
    }

    const recipients = db
      .prepare(`SELECT id, full_name, email FROM profiles WHERE is_active = 1 ${roleFilter}`)
      .all(...params) as Array<{ id: string; full_name: string; email: string }>;

    for (const r of recipients) {
      createNotification(r.id, String(subject).trim(), String(message).trim(), 'email');
      await sendTransactionalEmail({
        to: r.email,
        recipientUserId: r.id,
        template: 'admin_broadcast',
        subject: String(subject).trim(),
        html: `<p>Olá ${r.full_name},</p><p>${String(message).trim().replace(/\n/g, '<br/>')}</p><hr/><small>Confiança e Versatilidade Unipessoal Lda · NIF 518646696</small>`,
      });
    }

    res.json({ ok: true, sentCount: recipients.length });
  });

  app.get('/api/admin/chat/threads', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    let where = 'so.deleted_at IS NULL';
    const params: any[] = [];
    if (user.role === 'company_admin') {
      where += ' AND so.provider_org_id = ?';
      params.push(user.organization_id);
    }

    const threads = db
      .prepare(`
        SELECT so.id as service_order_id,
               so.reference_code,
               so.service_name,
               so.customer_name,
               tech.full_name as technician_name,
               so.status,
               (SELECT COUNT(*) FROM order_messages om WHERE om.service_order_id = so.id) as message_count,
               (SELECT om.message FROM order_messages om WHERE om.service_order_id = so.id ORDER BY om.created_at DESC LIMIT 1) as last_message,
               (SELECT p.full_name FROM order_messages om JOIN profiles p ON p.id = om.sender_id WHERE om.service_order_id = so.id ORDER BY om.created_at DESC LIMIT 1) as last_sender_name,
               (SELECT om.created_at FROM order_messages om WHERE om.service_order_id = so.id ORDER BY om.created_at DESC LIMIT 1) as last_message_at
        FROM service_orders so
        LEFT JOIN profiles tech ON tech.id = so.technician_id
        WHERE ${where}
        ORDER BY COALESCE(last_message_at, so.updated_at) DESC
        LIMIT 80
      `)
      .all(...params);

    res.json({ threads });
  });
}
