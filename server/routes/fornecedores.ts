import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';

// Fornecedores e peças, movidos de server.ts sem alteração de comportamento.
// Ordem de registro igual à original (dez rotas, todas no mesmo bloco).

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

type SendTransactionalEmail = (params: {
  to: string;
  subject: string;
  html: string;
  template: string;
  recipientUserId?: string | null;
}) => Promise<unknown>;

export interface FornecedoresRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  sendTransactionalEmail: SendTransactionalEmail;
}

export function registerFornecedoresRoutes(app: express.Express, ctx: FornecedoresRouteContext) {
  const { db, requireAuth, sendTransactionalEmail } = ctx;

  app.get('/api/suppliers', requireAuth(['super_admin', 'company_admin', 'technician']), (_req, res) => {
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
    res.json({ suppliers });
  });

  app.post('/api/suppliers', requireAuth(['super_admin']), (req, res) => {
    const { name, nif, phone, email, notes } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
    const id = `sup-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO suppliers (id, name, nif, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), nif || null, phone || null, email || null, notes || null);
    res.status(201).json({ supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
  });

  app.patch('/api/suppliers/:id', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    const { name, nif, phone, email, notes } = req.body ?? {};
    db.prepare(`
      UPDATE suppliers SET
        name = ?,
        nif = ?,
        phone = ?,
        email = ?,
        notes = ?
      WHERE id = ?
    `).run(
      name !== undefined && String(name).trim() ? String(name).trim() : existing.name,
      nif !== undefined ? (nif || null) : existing.nif,
      phone !== undefined ? (phone || null) : existing.phone,
      email !== undefined ? (email || null) : existing.email,
      notes !== undefined ? (notes || null) : existing.notes,
      existing.id
    );
    res.json({ supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(existing.id) });
  });

  app.get('/api/suppliers/forecast', requireAuth(['super_admin']), (_req, res) => {
    const rows = db
      .prepare(`
        SELECT i.*, so.reference_code, so.service_name, so.quote_status, so.completed_at,
               s.name as supplier_name, s.nif as supplier_nif
        FROM service_order_items i
        JOIN service_orders so ON so.id = i.service_order_id
        LEFT JOIN suppliers s ON s.id = i.supplier_id
        WHERE so.deleted_at IS NULL AND so.quote_status = 'accepted' AND i.supplier_unit_cost > 0
        ORDER BY i.is_paid_to_supplier ASC, i.created_at DESC
      `)
      .all()
      .map((r: any) => ({
        ...r,
        is_paid_to_supplier: Boolean(r.is_paid_to_supplier),
        total_supplier_cost: Math.round(Number(r.quantity) * Number(r.supplier_unit_cost) * 100) / 100,
      }));
    res.json({ forecast: rows });
  });

  // Logística de peças: data de encomenda, prazo em dias (gera a previsão) e chegada efetiva
  app.patch('/api/suppliers/items/:itemId/logistics', requireAuth(['super_admin']), (req, res) => {
    const item = db.prepare(`
      SELECT i.*, so.reference_code FROM service_order_items i
      JOIN service_orders so ON so.id = i.service_order_id
      WHERE i.id = ?
    `).get(req.params.itemId) as any;
    if (!item) return res.status(404).json({ error: 'Peça não encontrada.' });

    const { ordered_at, lead_days, arrived_at } = req.body ?? {};
    const isDateOrEmpty = (v: unknown) =>
      v === undefined || v === null || v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
    if (!isDateOrEmpty(ordered_at) || !isDateOrEmpty(arrived_at)) {
      return res.status(400).json({ error: 'Datas no formato AAAA-MM-DD.' });
    }

    let lead: number | null = item.lead_days ?? null;
    if (lead_days !== undefined) {
      if (lead_days === null || lead_days === '') {
        lead = null;
      } else {
        const n = Math.round(Number(lead_days));
        if (!Number.isFinite(n) || n < 0 || n > 365) {
          return res.status(400).json({ error: 'Prazo em dias inválido (0 a 365).' });
        }
        lead = n;
      }
    }

    const ordered: string | null = ordered_at !== undefined ? ordered_at || null : item.ordered_at ?? null;
    const arrived: string | null = arrived_at !== undefined ? arrived_at || null : item.arrived_at ?? null;

    let expected: string | null = null;
    if (ordered && lead !== null) {
      const d = new Date(`${ordered}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + lead);
      expected = d.toISOString().slice(0, 10);
    }

    db.prepare(`
      UPDATE service_order_items
      SET ordered_at = ?, lead_days = ?, expected_arrival_at = ?, arrived_at = ?
      WHERE id = ?
    `).run(ordered, lead, expected, arrived, item.id);

    res.json({ ok: true, item: db.prepare('SELECT * FROM service_order_items WHERE id = ?').get(item.id) });
  });

  // Painel de peças: atrasadas, a chegar, a encomendar e orçamentos em espera (alerta a partir de 15 dias)
  app.get('/api/suppliers/parts-panel', requireAuth(['super_admin']), (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const daysBetween = (fromIso: string, toIso: string) =>
      Math.round(
        (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86400000
      );

    const parts = db.prepare(`
      SELECT i.id, i.description, i.quantity, i.supplier_unit_cost, i.ordered_at, i.lead_days,
             i.expected_arrival_at, i.arrived_at, i.is_paid_to_supplier,
             i.supplier_quote_status, i.supplier_quote_requested_at, i.chased_at,
             so.id AS order_id, so.reference_code, so.service_name, so.customer_name,
             so.quote_decided_at, s.name AS supplier_name, s.email AS supplier_email
      FROM service_order_items i
      JOIN service_orders so ON so.id = i.service_order_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE so.deleted_at IS NULL AND so.quote_status = 'accepted' AND i.supplier_unit_cost > 0
        AND i.arrived_at IS NULL
    `).all() as any[];

    const toOrder: any[] = [];
    const waitingSupplier: any[] = [];
    const late: any[] = [];
    const arriving: any[] = [];
    for (const p of parts) {
      const row = { ...p, total_supplier_cost: Math.round(Number(p.quantity) * Number(p.supplier_unit_cost) * 100) / 100 };
      if (!p.ordered_at && p.supplier_quote_status === 'requested') {
        waitingSupplier.push({
          ...row,
          days_waiting_supplier: p.supplier_quote_requested_at ? daysBetween(p.supplier_quote_requested_at, today) : null,
        });
      } else if (!p.ordered_at) {
        toOrder.push({ ...row, days_waiting: p.quote_decided_at ? daysBetween(p.quote_decided_at, today) : null });
      } else if (p.expected_arrival_at && p.expected_arrival_at < today) {
        late.push({ ...row, days_late: daysBetween(p.expected_arrival_at, today) });
      } else {
        arriving.push({ ...row, days_to_arrival: p.expected_arrival_at ? daysBetween(today, p.expected_arrival_at) : null });
      }
    }

    const waitingQuotes = (db.prepare(`
      SELECT id, reference_code, service_name, customer_name, total_customer_amount, quote_sent_at, created_at
      FROM service_orders
      WHERE deleted_at IS NULL AND quote_status = 'sent'
    `).all() as any[]).map((o) => {
      const since = o.quote_sent_at || o.created_at;
      return { ...o, days_waiting: daysBetween(since, today) };
    });
    waitingQuotes.sort((a, b) => b.days_waiting - a.days_waiting);

    const waits = waitingQuotes.map((o) => o.days_waiting);
    res.json({
      today,
      summary: {
        toOrder: toOrder.length,
        waitingSupplier: waitingSupplier.length,
        late: late.length,
        arriving: arriving.length,
        quotesWaiting: waitingQuotes.length,
        quotesOver15Days: waitingQuotes.filter((o) => o.days_waiting > 15).length,
        longestWaitDays: waits.length ? Math.max(...waits) : 0,
        shortestWaitDays: waits.length ? Math.min(...waits) : 0,
      },
      toOrder,
      waitingSupplier,
      late,
      arriving,
      quotesWaiting: waitingQuotes,
    });
  });

  // Estado do orçamento pedido ao fornecedor: null -> requested -> received
  app.patch('/api/suppliers/items/:itemId/supplier-quote', requireAuth(['super_admin']), async (req, res) => {
    const item = db.prepare(`
      SELECT i.*, so.reference_code, s.name AS supplier_name, s.email AS supplier_email
      FROM service_order_items i
      JOIN service_orders so ON so.id = i.service_order_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.id = ?
    `).get(req.params.itemId) as any;
    if (!item) return res.status(404).json({ error: 'Peça não encontrada.' });

    const status = req.body?.status;
    if (status !== 'requested' && status !== 'received' && status !== null) {
      return res.status(400).json({ error: 'Estado inválido (requested, received ou null).' });
    }
    if (status === 'requested') {
      db.prepare(`
        UPDATE service_order_items SET supplier_quote_status = 'requested',
          supplier_quote_requested_at = COALESCE(supplier_quote_requested_at, datetime('now'))
        WHERE id = ?
      `).run(item.id);
      if (item.supplier_email) {
        void sendTransactionalEmail({
          to: item.supplier_email,
          template: 'supplier_quote_request',
          subject: `Pedido de orçamento — ${item.reference_code}`,
          html: `<p>Olá ${item.supplier_name || ''},</p><p>Pedimos um orçamento para a peça <strong>${String(item.description).replace(/</g, '&lt;')}</strong> (quantidade ${Number(item.quantity)}), referente à ordem ${item.reference_code}.</p><p>Obrigado.</p>`,
        });
      }
    } else if (status === 'received') {
      db.prepare("UPDATE service_order_items SET supplier_quote_status = 'received' WHERE id = ?").run(item.id);
    } else {
      db.prepare('UPDATE service_order_items SET supplier_quote_status = NULL, supplier_quote_requested_at = NULL WHERE id = ?').run(item.id);
    }
    res.json({ ok: true, emailed: status === 'requested' && Boolean(item.supplier_email) });
  });

  // Cobrar o fornecedor por peça atrasada ou ainda não entregue (e-mail; no máximo uma vez por dia)
  app.post('/api/suppliers/items/:itemId/chase', requireAuth(['super_admin']), (req, res) => {
    const item = db.prepare(`
      SELECT i.*, so.reference_code, s.name AS supplier_name, s.email AS supplier_email
      FROM service_order_items i
      JOIN service_orders so ON so.id = i.service_order_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.id = ?
    `).get(req.params.itemId) as any;
    if (!item) return res.status(404).json({ error: 'Peça não encontrada.' });
    if (!item.ordered_at) return res.status(400).json({ error: 'A peça ainda não foi encomendada.' });
    if (item.arrived_at) return res.status(400).json({ error: 'A peça já chegou.' });
    if (!item.supplier_email) return res.status(422).json({ error: 'Este fornecedor não tem e-mail registado.' });
    if (item.chased_at && Date.now() - Date.parse(`${item.chased_at.replace(' ', 'T')}Z`) < 24 * 60 * 60 * 1000) {
      return res.status(429).json({ error: 'Já cobrado nas últimas 24 horas.' });
    }

    const late = item.expected_arrival_at && item.expected_arrival_at < new Date().toISOString().slice(0, 10);
    void sendTransactionalEmail({
      to: item.supplier_email,
      template: 'supplier_chase',
      subject: `${late ? 'Entrega em atraso' : 'Confirmação de entrega'} — ${item.reference_code}`,
      html: `<p>Olá ${item.supplier_name || ''},</p><p>Encomendámos <strong>${String(item.description).replace(/</g, '&lt;')}</strong> (ordem ${item.reference_code}) em ${item.ordered_at}${
        item.expected_arrival_at ? `, com entrega prevista para ${item.expected_arrival_at}` : ''
      }.</p><p>${late ? 'A entrega está em atraso. Pedimos confirmação da data de envio.' : 'Pedimos confirmação da data de envio.'}</p>`,
    });
    db.prepare("UPDATE service_order_items SET chased_at = datetime('now') WHERE id = ?").run(item.id);
    res.json({ ok: true });
  });

  app.post('/api/suppliers/items/:itemId/mark-paid', requireAuth(['super_admin']), (req, res) => {
    const item = db.prepare(`
      SELECT i.*, so.reference_code FROM service_order_items i
      JOIN service_orders so ON so.id = i.service_order_id
      WHERE i.id = ?
    `).get(req.params.itemId) as any;
    if (!item) return res.status(404).json({ error: 'Peça não encontrada.' });

    const tx = db.transaction(() => {
      db.prepare('UPDATE service_order_items SET is_paid_to_supplier = 1 WHERE id = ?').run(item.id);
      const cf = db
        .prepare("SELECT id FROM cash_flow_entries WHERE service_order_id = ? AND category = 'supplier_parts' AND status = 'pending'")
        .get(item.service_order_id) as any;
      if (cf) {
        db.prepare("UPDATE cash_flow_entries SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(cf.id);
      } else {
        db.prepare(`
          INSERT INTO cash_flow_entries (id, entry_type, category, description, amount, status, due_date, paid_at, service_order_id, supplier_id)
          VALUES (?, 'expense', 'supplier_parts', ?, ?, 'paid', date('now'), datetime('now'), ?, ?)
        `).run(
          `cf-${crypto.randomUUID().slice(0, 8)}`,
          `Pagamento Fornecedor (${item.description}) — ${item.reference_code}`,
          Number(item.quantity) * Number(item.supplier_unit_cost),
          item.service_order_id,
          item.supplier_id || null
        );
      }
    });
    tx();
    res.json({ ok: true });
  });

  app.post('/api/suppliers/items/:itemId/undo-paid', requireAuth(['super_admin']), (req, res) => {
    const item = db.prepare(`
      SELECT i.*, so.reference_code FROM service_order_items i
      JOIN service_orders so ON so.id = i.service_order_id
      WHERE i.id = ?
    `).get(req.params.itemId) as any;
    if (!item) return res.status(404).json({ error: 'Peça não encontrada.' });

    const tx = db.transaction(() => {
      db.prepare('UPDATE service_order_items SET is_paid_to_supplier = 0 WHERE id = ?').run(item.id);
      const cf = db
        .prepare("SELECT id FROM cash_flow_entries WHERE service_order_id = ? AND category = 'supplier_parts' AND status = 'paid' ORDER BY created_at DESC LIMIT 1")
        .get(item.service_order_id) as any;
      if (cf) {
        db.prepare("UPDATE cash_flow_entries SET status = 'pending', paid_at = NULL WHERE id = ?").run(cf.id);
      }
    });
    tx();
    res.json({ ok: true });
  });
}
