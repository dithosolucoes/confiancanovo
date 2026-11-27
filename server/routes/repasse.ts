import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';
import { CONFIANCA_COMPANY } from '../../src/core/constants/company.ts';
import { getWeeklyPayoutCycle } from '../../src/core/finance/weekly-cycle.ts';
import { getParamAt } from '../params.ts';

// Repasse semanal (ciclo de pagamento de técnicos e centros técnicos), movido de server.ts sem alteração de comportamento.
// Cinco rotas (painel semanal, previsão por técnico, fechamento, pagamento e reenvio). A rota de visibilidade
// (GET /api/settings/visibility) continua em server.ts, no mesmo lugar, e usa techSeesPayouts(db) deste módulo.
// Dependências de server.ts entram por ctx: createNotification e sendTransactionalEmail.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

interface AuthUser {
  id: string;
  role: UserRole;
  organization_id: string | null;
  full_name: string;
}

export interface RepasseRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
  sendTransactionalEmail: (params: {
    to: string;
    subject: string;
    html: string;
    template: string;
    recipientUserId?: string | null;
  }) => Promise<unknown>;
}

// Regra de liberação do repasse (pedido da Elaine: "ao receber, libera o técnico").
// Uma ordem só entra no repasse depois de recebida: baixa registada, orçamento pago
// ou taxa de serviço paga. A data de liberação é a mais tardia entre conclusão e recebimento.
// Cancelamento com valor para o técnico já está liberado (a regra é do parâmetro de cancelamento)
export const isOrderReceived = (o: any): boolean =>
  o.status === 'cancelled' || Boolean(o.baixa_received_at || o.quote_paid || o.service_fee_paid);

export const payoutReleaseDate = (o: any): string | null => {
  if (!o.completed_at) return null;
  const done = String(o.completed_at).slice(0, 10);
  const recv = String(o.baixa_received_at || o.service_fee_paid_at || o.completed_at).slice(0, 10);
  return recv > done ? recv : done;
};

// Parâmetro "Técnico vê repasses e dados bancários" (editável pela gestão)
export const techSeesPayouts = (db: Db): boolean => Number(getParamAt(db, 'tech_sees_payouts')) === 1;

export function registerRepasseRoutes(app: express.Express, ctx: RepasseRouteContext) {
  const { db, requireAuth, createNotification, sendTransactionalEmail } = ctx;

  app.get('/api/payouts/weekly', requireAuth(['super_admin', 'company_admin', 'technician']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    if (user.role === 'technician' && !techSeesPayouts(db)) {
      return res.status(403).json({ error: 'Os repasses não estão disponíveis para o seu perfil.' });
    }
    const refDateStr = (req.query.date as string) || undefined;
    const refDate = refDateStr ? new Date(`${refDateStr}T12:00:00Z`) : new Date();
    const cycle = getWeeklyPayoutCycle(refDate);

    // Fetch existing payouts for this cycle
    let payoutQuery = 'SELECT * FROM weekly_payouts WHERE week_start = ? AND week_end = ?';
    const payoutParams: any[] = [cycle.weekStart, cycle.weekEnd];
    if (user.role === 'company_admin') {
      payoutQuery += ' AND organization_id = ?';
      payoutParams.push(user.organization_id);
    } else if (user.role === 'technician') {
      payoutQuery += ' AND technician_id = ?';
      payoutParams.push(user.id);
    }
    const existingPayouts = db.prepare(payoutQuery).all(...payoutParams) as any[];

    // Fetch completed orders in this cycle (excluding deleted)
    let ordersQuery = `
      SELECT so.*, p.full_name as tech_name, p.email as tech_email, p.nif as tech_nif, p.iban as tech_iban,
             o.name as org_name, o.email as org_email, o.nif as org_nif, o.org_type
      FROM service_orders so
      LEFT JOIN profiles p ON p.id = so.technician_id
      LEFT JOIN organizations o ON o.id = so.provider_org_id
      WHERE so.deleted_at IS NULL
        AND (so.status = 'completed' OR (so.status = 'cancelled' AND so.technician_payout > 0))
    `;
    const orderParams: any[] = [];
    if (user.role === 'company_admin') {
      ordersQuery += ' AND so.provider_org_id = ?';
      orderParams.push(user.organization_id);
    } else if (user.role === 'technician') {
      ordersQuery += ' AND so.technician_id = ?';
      orderParams.push(user.id);
    }
    const allCompleted = db.prepare(ordersQuery).all(...orderParams) as any[];
    const orders: any[] = [];
    const awaitingReceipt: any[] = [];
    for (const o of allCompleted) {
      if (!isOrderReceived(o)) {
        // Concluída neste ciclo mas ainda não recebida: fica de fora até ser recebida
        const done = String(o.completed_at || '').slice(0, 10);
        if (done >= cycle.weekStart && done <= cycle.weekEnd) awaitingReceipt.push(o);
        continue;
      }
      const release = payoutReleaseDate(o);
      if (release && release >= cycle.weekStart && release <= cycle.weekEnd) orders.push(o);
    }

    const groupsMap = new Map<string, any>();

    for (const o of orders) {
      const isTechCenter = o.org_type === 'technical_center';
      const targetType = isTechCenter ? 'organization' : 'technician';
      const targetId = isTechCenter ? o.provider_org_id : o.technician_id;
      if (!targetId) continue;

      const key = `${targetType}:${targetId}`;
      if (!groupsMap.has(key)) {
        const matchedPayout = existingPayouts.find((wp) =>
          targetType === 'organization'
            ? wp.organization_id === targetId
            : wp.technician_id === targetId
        );
        groupsMap.set(key, {
          targetId,
          targetType,
          targetName: isTechCenter ? o.org_name : o.tech_name,
          targetEmail: isTechCenter ? o.org_email : o.tech_email,
          nif: isTechCenter ? o.org_nif : o.tech_nif,
          iban: isTechCenter ? null : o.tech_iban,
          ordersCount: 0,
          totalAmount: 0,
          existingPayoutId: matchedPayout?.id || null,
          adjustmentAmount: Number(matchedPayout?.adjustment_amount || 0),
          adjustmentKind: matchedPayout?.adjustment_kind || null,
          adjustmentReason: matchedPayout?.adjustment_reason || null,
          status: matchedPayout ? matchedPayout.status : 'open',
          weekStart: cycle.weekStart,
          weekEnd: cycle.weekEnd,
          dueDate: cycle.dueDate,
          reportSentAt: matchedPayout?.report_sent_at || null,
          paidAt: matchedPayout?.paid_at || null,
          orders: [],
        });
      }
      const grp = groupsMap.get(key);
      grp.ordersCount += 1;
      grp.totalAmount = Math.round((grp.totalAmount + Number(o.technician_payout)) * 100) / 100;
      grp.orders.push({
        id: o.id,
        reference_code: o.reference_code,
        service_name: o.service_name,
        service_address: o.service_address,
        completed_at: o.completed_at,
        technician_payout: Number(o.technician_payout),
      });
    }

    // Período já fechado: total oficial = total gravado (inclui desconto/reembolso)
    for (const grp of groupsMap.values()) {
      grp.ordersTotal = Math.round(Number(grp.totalAmount) * 100) / 100;
      if (grp.existingPayoutId) {
        const wp = existingPayouts.find((p) => p.id === grp.existingPayoutId);
        if (wp) grp.totalAmount = Number(wp.total_amount);
      }
    }

    // Historical payouts for technician / company / admin
    let histQuery = `
      SELECT wp.*, p.full_name as tech_name, o.name as org_name
      FROM weekly_payouts wp
      LEFT JOIN profiles p ON p.id = wp.technician_id
      LEFT JOIN organizations o ON o.id = wp.organization_id
      WHERE 1=1
    `;
    const histParams: any[] = [];
    if (user.role === 'company_admin') {
      histQuery += ' AND wp.organization_id = ?';
      histParams.push(user.organization_id);
    } else if (user.role === 'technician') {
      histQuery += ' AND wp.technician_id = ?';
      histParams.push(user.id);
    }
    histQuery += ' ORDER BY wp.week_start DESC';
    const history = db.prepare(histQuery).all(...histParams);

    res.json({
      cycle,
      groups: Array.from(groupsMap.values()),
      history,
      invoiceNotice: CONFIANCA_COMPANY.invoiceNoticeText,
      awaitingReceipt: {
        count: awaitingReceipt.length,
        amount:
          Math.round(awaitingReceipt.reduce((s, o) => s + Number(o.technician_payout || 0), 0) * 100) / 100,
      },
    });
  });

  // Previsão acumulada por técnico: o que já está liberado, o que aguarda recebimento, o fechado sem pagamento e o total já pago
  app.get('/api/payouts/by-technician', requireAuth(['super_admin']), (_req, res) => {
    const techs = db
      .prepare("SELECT id, full_name FROM profiles WHERE role = 'technician' AND is_active = 1 ORDER BY full_name")
      .all() as any[];
    const rows = techs.map((t) => {
      const orders = db
        .prepare(`
          SELECT status, technician_payout, completed_at, baixa_received_at, service_fee_paid_at, quote_paid, service_fee_paid
          FROM service_orders
          WHERE technician_id = ? AND deleted_at IS NULL AND (status = 'completed' OR (status = 'cancelled' AND technician_payout > 0)) AND weekly_payout_id IS NULL
        `)
        .all(t.id) as any[];
      let aLiberar = 0;
      let aguardando = 0;
      for (const o of orders) {
        const amount = Number(o.technician_payout || 0);
        if (isOrderReceived(o)) aLiberar += amount;
        else aguardando += amount;
      }
      const payouts = db
        .prepare('SELECT total_amount, status, paid_at FROM weekly_payouts WHERE technician_id = ?')
        .all(t.id) as any[];
      const fechadoNaoPago = payouts.filter((p) => p.status !== 'paid').reduce((s, p) => s + Number(p.total_amount || 0), 0);
      const pagos = payouts.filter((p) => p.status === 'paid');
      const totalPago = pagos.reduce((s, p) => s + Number(p.total_amount || 0), 0);
      const ultimoPagamento = pagos.map((p) => p.paid_at).filter(Boolean).sort().pop() || null;
      const r = (v: number) => Math.round(v * 100) / 100;
      return {
        technicianId: t.id,
        name: t.full_name,
        aLiberar: r(aLiberar),
        aguardandoRecebimento: r(aguardando),
        fechadoNaoPago: r(fechadoNaoPago),
        totalPago: r(totalPago),
        previsto: r(aLiberar + fechadoNaoPago),
        ultimoPagamento,
      };
    });
    res.json({ technicians: rows });
  });

  app.post('/api/payouts/close-week', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { technicianId, organizationId, weekStart, weekEnd, dueDate, adjustment } = req.body ?? {};
    if ((!technicianId && !organizationId) || !weekStart || !weekEnd || !dueDate) {
      return res.status(400).json({ error: 'Parâmetros de fechamento inválidos.' });
    }

    // Desconto ou reembolso opcional, com motivo obrigatório
    let adjustmentAmount = 0;
    let adjustmentKind: 'desconto' | 'reembolso' | null = null;
    let adjustmentReason: string | null = null;
    if (adjustment && Number(adjustment.amount) !== 0 && adjustment.amount !== undefined && adjustment.amount !== '') {
      const value = Math.round(Math.abs(Number(adjustment.amount)) * 100) / 100;
      const reason = String(adjustment.reason ?? '').trim();
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: 'Valor do ajuste inválido.' });
      }
      if (adjustment.kind !== 'desconto' && adjustment.kind !== 'reembolso') {
        return res.status(400).json({ error: 'Tipo de ajuste inválido (desconto ou reembolso).' });
      }
      if (reason.length < 5) {
        return res.status(400).json({ error: 'Informe o motivo do desconto ou reembolso (mínimo 5 caracteres).' });
      }
      adjustmentKind = adjustment.kind;
      adjustmentReason = reason;
      adjustmentAmount = adjustment.kind === 'reembolso' ? value : -value;
    }

    let query = `
      SELECT id, status, reference_code, service_address, technician_payout, completed_at,
             baixa_received_at, service_fee_paid_at, quote_paid, service_fee_paid
      FROM service_orders
      WHERE deleted_at IS NULL AND (status = 'completed' OR (status = 'cancelled' AND technician_payout > 0)) AND weekly_payout_id IS NULL
    `;
    const params: any[] = [];
    if (technicianId) {
      query += ' AND technician_id = ?';
      params.push(technicianId);
    }
    if (organizationId) {
      query += ' AND provider_org_id = ?';
      params.push(organizationId);
    }

    const wStart = String(weekStart).slice(0, 10);
    const wEnd = String(weekEnd).slice(0, 10);
    const orders = (db.prepare(query).all(...params) as any[]).filter((o) => {
      if (!isOrderReceived(o)) return false;
      const release = payoutReleaseDate(o);
      return Boolean(release && release >= wStart && release <= wEnd);
    });
    if (orders.length === 0) {
      return res.status(400).json({
        error: 'Nenhum serviço recebido e pendente de fechamento nesta semana.',
      });
    }

    const ordersSum = Math.round(orders.reduce((s, o) => s + Number(o.technician_payout), 0) * 100) / 100;
    const totalAmount = Math.round((ordersSum + adjustmentAmount) * 100) / 100;
    if (totalAmount < 0) {
      return res.status(400).json({ error: 'O desconto não pode ser maior que o total do período.' });
    }
    const payoutId = `wp-${crypto.randomUUID().slice(0, 8)}`;

    let targetName = 'Parceiro';
    if (technicianId) {
      const t = db.prepare('SELECT full_name FROM profiles WHERE id = ?').get(technicianId) as any;
      targetName = t?.full_name || 'Técnico';
    } else if (organizationId) {
      const o = db.prepare('SELECT name FROM organizations WHERE id = ?').get(organizationId) as any;
      targetName = o?.name || 'Centro Técnico';
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO weekly_payouts (id, technician_id, organization_id, week_start, week_end, due_date, total_amount, status, report_sent_at, adjustment_amount, adjustment_kind, adjustment_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), ?, ?, ?)
      `).run(
        payoutId,
        technicianId || null,
        organizationId || null,
        weekStart,
        weekEnd,
        dueDate,
        totalAmount,
        adjustmentAmount,
        adjustmentKind,
        adjustmentReason
      );

      const lockStmt = db.prepare(
        'UPDATE service_orders SET weekly_payout_id = ?, technician_payout_locked = 1, updated_at = datetime(\'now\') WHERE id = ?'
      );
      for (const o of orders) {
        lockStmt.run(payoutId, o.id);
      }

      db.prepare(`
        INSERT INTO cash_flow_entries (id, entry_type, category, description, amount, status, due_date, weekly_payout_id, created_by)
        VALUES (?, 'expense', 'tech_payout', ?, ?, 'pending', ?, ?, ?)
      `).run(
        `cf-${crypto.randomUUID().slice(0, 8)}`,
        `Repasse Semanal (${weekStart} a ${weekEnd}) — ${targetName}`,
        totalAmount,
        dueDate,
        payoutId,
        user.id
      );

      if (technicianId) {
        createNotification(
          technicianId,
          `Fechamento Semanal (${weekStart} a ${weekEnd})`,
          `Total € ${totalAmount.toFixed(2)} (pagamento ${dueDate}). ${CONFIANCA_COMPANY.invoiceNoticeText}`,
          'email'
        );
      }
    });

    tx();

    if (technicianId) {
      const t = db.prepare('SELECT email, full_name FROM profiles WHERE id = ?').get(technicianId) as any;
      if (t?.email) {
        void sendTransactionalEmail({
          to: t.email,
          recipientUserId: technicianId,
          template: 'weekly_payout',
          subject: `Fechamento Semanal Confiança (${weekStart} a ${weekEnd})`,
          html: `<p>Olá ${t.full_name},</p><p>O seu repasse semanal foi fechado: <strong>€ ${totalAmount.toFixed(2)}</strong> (${orders.length} ordens). Pagamento previsto: <strong>${dueDate}</strong>.</p><p>${CONFIANCA_COMPANY.invoiceNoticeText}</p>`,
        });
      }
    } else if (organizationId) {
      const o = db.prepare('SELECT email, name FROM organizations WHERE id = ?').get(organizationId) as any;
      if (o?.email) {
        void sendTransactionalEmail({
          to: o.email,
          template: 'weekly_payout',
          subject: `Fechamento Semanal Centro Técnico (${weekStart} a ${weekEnd})`,
          html: `<p>Equipa ${o.name},</p><p>Fechamento semanal apurado: <strong>€ ${totalAmount.toFixed(2)}</strong> (${orders.length} ordens). Pagamento previsto: <strong>${dueDate}</strong>.</p><p>${CONFIANCA_COMPANY.invoiceNoticeText}</p>`,
        });
      }
    }

    res.json({ success: true, payoutId, totalAmount, ordersCount: orders.length });
  });

  app.post('/api/payouts/:id/mark-paid', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const payout = db.prepare('SELECT * FROM weekly_payouts WHERE id = ?').get(req.params.id) as any;
    if (!payout) return res.status(404).json({ error: 'Fechamento não encontrado.' });

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE weekly_payouts SET status = 'paid', paid_at = datetime('now'), paid_by = ? WHERE id = ?
      `).run(user.id, payout.id);

      db.prepare(`
        UPDATE cash_flow_entries SET status = 'paid', paid_at = datetime('now') WHERE weekly_payout_id = ?
      `).run(payout.id);
    });
    tx();
    res.json({ ok: true });
  });

  app.post('/api/payouts/:id/resend-report', requireAuth(['super_admin']), (req, res) => {
    const payout = db.prepare('SELECT * FROM weekly_payouts WHERE id = ?').get(req.params.id) as any;
    if (!payout) return res.status(404).json({ error: 'Fechamento não encontrado.' });

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE weekly_payouts SET report_sent_at = ? WHERE id = ?').run(nowIso, payout.id);

    if (payout.technician_id) {
      createNotification(
        payout.technician_id,
        `Reenvio: Relatório Semanal (${payout.week_start} a ${payout.week_end})`,
        `Total € ${Number(payout.total_amount).toFixed(2)} (pagamento ${payout.due_date}). ${CONFIANCA_COMPANY.invoiceNoticeText}`,
        'email'
      );
      const t = db.prepare('SELECT email, full_name FROM profiles WHERE id = ?').get(payout.technician_id) as any;
      if (t?.email) {
        void sendTransactionalEmail({
          to: t.email,
          recipientUserId: payout.technician_id,
          template: 'weekly_payout_resend',
          subject: `Reenvio Relatório Semanal (${payout.week_start} a ${payout.week_end})`,
          html: `<p>Olá ${t.full_name},</p><p>Reenviamos o seu extrato semanal: <strong>€ ${Number(payout.total_amount).toFixed(2)}</strong> (pagamento ${payout.due_date}).</p><p>${CONFIANCA_COMPANY.invoiceNoticeText}</p>`,
        });
      }
    } else if (payout.organization_id) {
      const companyAdmin = db
        .prepare("SELECT id, email, full_name FROM profiles WHERE organization_id = ? AND role = 'company_admin' LIMIT 1")
        .get(payout.organization_id) as any;
      if (companyAdmin) {
        createNotification(
          companyAdmin.id,
          `Reenvio: Relatório Semanal Centro Técnico (${payout.week_start} a ${payout.week_end})`,
          `Total € ${Number(payout.total_amount).toFixed(2)} (pagamento ${payout.due_date}). ${CONFIANCA_COMPANY.invoiceNoticeText}`,
          'email'
        );
        if (companyAdmin.email) {
          void sendTransactionalEmail({
            to: companyAdmin.email,
            recipientUserId: companyAdmin.id,
            template: 'weekly_payout_resend',
            subject: `Reenvio Relatório Centro Técnico (${payout.week_start} a ${payout.week_end})`,
            html: `<p>Olá ${companyAdmin.full_name},</p><p>Reenviamos o fecho semanal: <strong>€ ${Number(payout.total_amount).toFixed(2)}</strong> (pagamento ${payout.due_date}).</p><p>${CONFIANCA_COMPANY.invoiceNoticeText}</p>`,
          });
        }
      }
    }

    res.json({ ok: true, reportSentAt: nowIso });
  });
}
