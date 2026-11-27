import crypto from 'node:crypto';
import type { db as Db } from '../db.ts';

// Liquidação de pagamento de uma ordem (usada pelo webhook assinado, pela confirmação local e pela verificação
// de pendentes), movida de server.ts sem alteração de comportamento.
// Idempotente por sessão de pagamento: uma segunda chamada com a mesma sessão já paga não faz nada.
// Dependências entram pelo objeto deps (db e funções de notificação e de envio de e-mail de server.ts).

export interface LiquidacaoDeps {
  db: typeof Db;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
  broadcastToOrder: (orderId: string, event: Record<string, unknown>) => void;
  sendTransactionalEmail: (params: {
    to: string;
    subject: string;
    html: string;
    template: string;
    recipientUserId?: string | null;
  }) => Promise<unknown>;
}

export function settleOrderPayment(
  deps: LiquidacaoDeps,
  orderId: string,
  sessionId: string,
  paymentType: string,
  amountPaid: number,
  paymentIntentId?: string | null
): boolean {
  const { db, createNotification, broadcastToOrder, sendTransactionalEmail } = deps;
  let newlySettled = false;
  const tx = db.transaction(() => {
    const existingPay = db
      .prepare('SELECT status FROM payments WHERE stripe_session_id = ?')
      .get(sessionId) as { status: string } | undefined;
    if (existingPay?.status === 'paid') {
      return; // Idempotent guard against duplicate webhook deliveries
    }

    // Só liquida ordem ativa (não cancelada) com orçamento aprovado; caso contrário o pagamento fica pendente
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(orderId) as any;
    if (!order || order.status === 'cancelled' || order.quote_status !== 'accepted') return;

    newlySettled = true;
    db.prepare(`
      UPDATE payments SET status = 'paid', stripe_payment_intent_id = ?, paid_at = datetime('now')
      WHERE stripe_session_id = ?
    `).run(paymentIntentId || `pi_${crypto.randomUUID().slice(0, 10)}`, sessionId);

    db.prepare(`
      INSERT INTO cash_flow_entries (id, entry_type, category, description, amount, paid_amount, status, due_date, paid_at, service_order_id)
      VALUES (?, 'income', 'service_revenue', ?, ?, ?, 'paid', date('now'), datetime('now'), ?)
    `).run(
      `cf-${crypto.randomUUID().slice(0, 8)}`,
      `Pagamento Stripe (${paymentType}) — ${order.reference_code}`,
      amountPaid,
      amountPaid,
      orderId
    );

    if (paymentType === 'service_fee') {
      db.prepare(`
        UPDATE service_orders SET
          service_fee_paid = 1,
          service_fee_paid_at = COALESCE(service_fee_paid_at, datetime('now')),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(orderId);
    } else {
      db.prepare(`
        UPDATE service_orders SET
          service_fee_paid = 1,
          service_fee_paid_at = COALESCE(service_fee_paid_at, datetime('now')),
          quote_paid = 1,
          labor_paid_at = COALESCE(labor_paid_at, datetime('now')),
          materials_paid_at = COALESCE(materials_paid_at, datetime('now')),
          status = CASE WHEN status = 'payment_pending' THEN 'completed' ELSE status END,
          completed_at = CASE WHEN status = 'payment_pending' AND completed_at IS NULL THEN datetime('now') ELSE completed_at END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(orderId);
    }

    if (order.customer_id) {
      createNotification(
        order.customer_id,
        `Pagamento Confirmado (${order.reference_code})`,
        `Recebemos € ${amountPaid.toFixed(2)} via Stripe.`,
        'email'
      );
    }
  });
  tx();

  if (newlySettled) {
    broadcastToOrder(orderId, { type: 'order:updated', orderId });
    const ord = db.prepare('SELECT customer_id, reference_code FROM service_orders WHERE id = ?').get(orderId) as any;
    if (ord?.customer_id) {
      const cust = db.prepare('SELECT email, full_name FROM profiles WHERE id = ?').get(ord.customer_id) as any;
      if (cust?.email) {
        void sendTransactionalEmail({
          to: cust.email,
          recipientUserId: ord.customer_id,
          template: 'payment_receipt',
          subject: `Recibo de Pagamento — ${ord.reference_code}`,
          html: `<p>Olá ${cust.full_name},</p><p>Confirmamos o pagamento de <strong>€ ${amountPaid.toFixed(2)}</strong> referente à ordem <strong>${ord.reference_code}</strong>.</p>`,
        });
      }
    }
  }
  return newlySettled;
}
