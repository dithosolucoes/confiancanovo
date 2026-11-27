import type express from 'express';
import crypto from 'node:crypto';
import type Stripe from 'stripe';
import type { UserRole } from '../../src/types/domain.ts';
import {
  calculateServiceFinancials,
  computeAdditionalChargesSummary,
  computeProportionalPayout,
} from '../../src/core/finance/calculator.ts';
import { getParamAt } from '../params.ts';

// Pagamentos de ordens (checkout, confirmação local sem Stripe e verificação de pendentes), movidos de server.ts
// sem alteração de comportamento. O webhook assinado fica em stripe-webhook.ts (registrado antes do express.json).
// Dependências de server.ts entram por ctx: db, requireAuth, cliente Stripe, função de liquidação,
// controle de acesso à ordem, projeção por papel e configuração de métodos.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

interface AuthUser {
  id: string;
  role: UserRole;
  organization_id: string | null;
  full_name: string;
  email: string;
  is_active: boolean;
}

export interface PagamentosRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  stripeClient: Stripe | null;
  settle: (
    orderId: string,
    sessionId: string,
    paymentType: string,
    amountPaid: number,
    paymentIntentId?: string | null
  ) => boolean;
  canUserAccessOrder: (user: AuthUser, order: any) => boolean;
  projectOrderForRole: (order: any, role: UserRole) => any;
  paymentMethodLabels: () => string[];
  stripePaymentMethods: string[];
}

export function registerPagamentosRoutes(app: express.Express, ctx: PagamentosRouteContext) {
  const { db, requireAuth, stripeClient, settle, canUserAccessOrder, projectOrderForRole, paymentMethodLabels, stripePaymentMethods } = ctx;

  app.post('/api/payments/checkout', requireAuth(), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { serviceOrderId, paymentType = 'full' } = req.body ?? {};
    const order = db
      .prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL')
      .get(serviceOrderId) as any;
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, order)) return res.status(403).json({ error: 'Sem permissão.' });
    if (order.status === 'cancelled') return res.status(400).json({ error: 'Esta ordem está cancelada.' });
    if (order.quote_status !== 'accepted') {
      return res.status(400).json({ error: 'Só é possível pagar depois de o orçamento ser aprovado.' });
    }

    const items = db
      .prepare('SELECT quantity, customer_unit_price, supplier_unit_cost FROM service_order_items WHERE service_order_id = ?')
      .all(order.id) as any[];

    const vatRate: 6 | 23 = Number(order.vat_rate) === 6 ? 6 : 23;
    const financials = calculateServiceFinancials({
      serviceFee: Number(order.service_fee),
      laborCost: Number(order.labor_cost),
      extraFee: Number(order.extra_fee),
      additionalCost: Number(order.additional_cost),
      partsBaseCost: items.reduce((s, i) => s + Number(i.quantity) * Number(i.customer_unit_price), 0),
      partsSupplierCost: items.reduce((s, i) => s + Number(i.quantity) * Number(i.supplier_unit_cost), 0),
      vatRate,
      quoteStatus: order.quote_status,
      isWarranty: Boolean(order.is_warranty),
      legacyPartsMarkup: Boolean(order.legacy_parts_markup),
      partsMarkupMultiplier: getParamAt(db, 'berens_parts_markup', order.created_at),
      legacyPayoutRule: Boolean(order.legacy_payout_rule),
      fixedPayoutAmount: Number(order.fixed_payout_amount || 0),
      createdAt: order.created_at,
    });

    const chargeSummary = computeAdditionalChargesSummary({
      serviceFee: Number(order.service_fee),
      laborCost: Number(order.labor_cost),
      extraFee: Number(order.extra_fee),
      additionalCost: Number(order.additional_cost),
      partsCustomerTotal: financials.customerPartsTotal,
      vatRate,
      quoteStatus: order.quote_status,
      serviceFeePaid: Boolean(order.service_fee_paid),
      serviceFeePaidAt: order.service_fee_paid_at,
      quotePaid: Boolean(order.quote_paid),
      laborPaidAt: order.labor_paid_at,
      materialsPaidAt: order.materials_paid_at,
    });

    let amountToCharge = chargeSummary.totalPendingWithVat;
    let vatAmount = Math.round((amountToCharge - amountToCharge / (1 + vatRate / 100) + Number.EPSILON) * 100) / 100;
    if (paymentType === 'service_fee') {
      const feeComp = chargeSummary.components.find((c) => c.id === 'service_fee');
      amountToCharge = feeComp && !feeComp.paid ? feeComp.amountWithVat : 0;
      vatAmount = Math.round((amountToCharge - Number(order.service_fee) + Number.EPSILON) * 100) / 100;
    }

    const eligibleReceived = chargeSummary.totalPaidWithVat + amountToCharge;
    const proportionalPreview = computeProportionalPayout({
      eligibleBase: chargeSummary.totalWithVat,
      eligibleReceived,
      customPayoutPercentage: 50,
    });

    if (amountToCharge <= 0) {
      return res.status(400).json({ error: 'Não há valor pendente para liquidação.' });
    }

    let sessionId = `cs_pt_${crypto.randomUUID().slice(0, 12)}`;
    let checkoutUrl: string | null = null;

    if (stripeClient) {
      const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      const rolePath = user.role === 'partner_requester' ? 'parceiro' : 'cliente';
      const stripeSession = await stripeClient.checkout.sessions.create({
        mode: 'payment',
        // Métodos configuráveis (STRIPE_PAYMENT_METHODS, ex.: card,multibanco,mb_way). Sem valor: padrão da Stripe.
        ...(stripePaymentMethods.length ? { payment_method_types: stripePaymentMethods as any } : {}),
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: {
                name: `${order.reference_code} — ${order.service_name}`,
                description: `IVA PT (${vatRate}%) incluído · Confiança Repara`,
              },
              unit_amount: Math.round(amountToCharge * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          service_order_id: order.id,
          payment_type: paymentType,
        },
        success_url: `${appUrl}/${rolePath}/servicos/${order.id}?stripe_status=success`,
        cancel_url: `${appUrl}/${rolePath}/servicos/${order.id}?stripe_status=cancelled`,
      });
      sessionId = stripeSession.id;
      checkoutUrl = stripeSession.url;
    }

    db.prepare(`
      INSERT INTO payments (id, service_order_id, stripe_session_id, payment_type, amount, vat_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(`pay-${crypto.randomUUID().slice(0, 8)}`, order.id, sessionId, paymentType, amountToCharge, vatAmount);

    res.json({
      sessionId,
      checkoutUrl,
      amountToCharge,
      vatAmount,
      vatRate: order.vat_rate,
      referenceCode: order.reference_code,
      paymentMethods: paymentMethodLabels(),
      stripeConfigured: Boolean(stripeClient),
      proportionalPreview,
    });
  });

  app.post('/api/payments/confirm-preview', requireAuth(), (req, res) => {
    // Confirmação manual só existe em desenvolvimento sem Stripe. Em produção nunca.
    if (process.env.NODE_ENV === 'production' || stripeClient) {
      return res.status(403).json({
        error: 'Em produção com Stripe ativo, a confirmação ocorre exclusivamente por webhook assinado ou verificação Stripe.',
      });
    }
    const user: AuthUser = (req as any).authUser;
    const { sessionId } = req.body ?? {};
    const payment = db.prepare('SELECT * FROM payments WHERE stripe_session_id = ?').get(sessionId) as any;
    if (!payment) return res.status(404).json({ error: 'Sessão de pagamento não encontrada.' });
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(payment.service_order_id) as any;
    if (!order || !canUserAccessOrder(user, order)) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    if (order.status === 'cancelled' || order.quote_status !== 'accepted') {
      return res.status(400).json({ error: 'Só é possível confirmar pagamento de ordem ativa com orçamento aprovado.' });
    }
    settle(order.id, sessionId, payment.payment_type, Number(payment.amount));
    res.json({ ok: true, order: projectOrderForRole(db.prepare('SELECT * FROM service_orders WHERE id = ?').get(order.id), user.role) });
  });

  // Verify Pending Stripe Payments Routine (fixes legacy bug where client closed tab before webhook)
  app.post('/api/payments/verify-pending', requireAuth(), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { serviceOrderId } = req.body ?? {};

    let query = "SELECT * FROM payments WHERE status = 'pending'";
    const params: any[] = [];
    if (serviceOrderId) {
      query += ' AND service_order_id = ?';
      params.push(serviceOrderId);
    }

    const pending = db.prepare(query).all(...params) as any[];
    let checked = 0;
    let settled = 0;

    for (const pay of pending) {
      const ord = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(pay.service_order_id) as any;
      if (!ord || !canUserAccessOrder(user, ord)) continue;
      checked += 1;

      if (stripeClient && !String(pay.stripe_session_id).startsWith('cs_pt_')) {
        try {
          const sess = await stripeClient.checkout.sessions.retrieve(pay.stripe_session_id);
          if (sess.payment_status === 'paid') {
            const didSettle = settle(
              pay.service_order_id,
              pay.stripe_session_id,
              pay.payment_type,
              Number(sess.amount_total || pay.amount * 100) / 100,
              typeof sess.payment_intent === 'string' ? sess.payment_intent : null
            );
            if (didSettle) settled += 1;
          }
        } catch {
          // Ignore transient Stripe API errors for individual sessions
        }
      }
    }

    res.json({
      checked,
      settled,
      stillPending: checked - settled,
      stripeConfigured: Boolean(stripeClient),
    });
  });
}
