import express from 'express';
import type Stripe from 'stripe';

// Webhook da Stripe, movido de server.ts sem alteração de comportamento.
// ATENÇÃO À ORDEM: este registro precisa continuar ANTES de express.json (o corpo tem de chegar cru para a
// verificação da assinatura). Em server.ts, a chamada fica exatamente no mesmo ponto em que o bloco estava.
// Sem segredo do webhook: 503 (só aceita sem assinatura com ALLOW_UNSIGNED_WEBHOOK=1 fora de produção).

export interface StripeWebhookContext {
  stripeClient: Stripe | null;
  settle: (
    orderId: string,
    sessionId: string,
    paymentType: string,
    amountPaid: number,
    paymentIntentId?: string | null
  ) => boolean;
}

export function registerStripeWebhookRoutes(app: express.Express, ctx: StripeWebhookContext) {
  const { stripeClient, settle } = ctx;

  // Stripe webhook requires raw body when verifying signature (MUST precede express.json)
  app.post(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    (req, res) => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
      let event: any;

      // Sem segredo do webhook, qualquer pessoa conseguiria marcar uma ordem como paga.
      // Só aceita eventos sem assinatura em desenvolvimento, com opt-in explícito.
      const allowUnsigned = process.env.NODE_ENV !== 'production' && process.env.ALLOW_UNSIGNED_WEBHOOK === '1';
      if (!(stripeClient && webhookSecret) && !allowUnsigned) {
        return res.status(503).json({ error: 'Webhook Stripe não configurado (STRIPE_WEBHOOK_SECRET).' });
      }

      try {
        if (stripeClient && webhookSecret) {
          const sig = req.headers['stripe-signature'];
          if (!sig || typeof sig !== 'string') {
            return res.status(400).json({ error: 'Assinatura stripe-signature em falta.' });
          }
          event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
        } else {
          const raw = Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : JSON.stringify(req.body);
          event = JSON.parse(raw);
        }
      } catch (err: any) {
        return res.status(400).json({ error: `Webhook inválido: ${err?.message || 'signature'}` });
      }

      if (event?.type === 'checkout.session.completed') {
        const session = event.data?.object;
        const orderId = session?.metadata?.service_order_id;
        const paymentType = session?.metadata?.payment_type || 'full';
        const amountPaid = Number(session?.amount_total || 0) / 100;

        if (orderId && session?.payment_status === 'paid') {
          settle(orderId, session.id, paymentType, amountPaid, session.payment_intent || null);
        }
      }

      return res.json({ received: true });
    }
  );
}
