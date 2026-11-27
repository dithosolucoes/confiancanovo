import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import { wsClients, broadcastToUser, broadcastToOrder } from './server/infra/ws-state.ts';
import { registerWebSocketServer } from './server/routes/websocket.ts';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initDatabase,
  hashPassword,
  verifyPassword,
  recalculateOrderInDb,
  dbPath,
} from './server/db.ts';
import {
  calculateServiceFinancials,
  computeAdditionalChargesSummary,
  computeProportionalPayout,
} from './src/core/finance/calculator.ts';
import { getWeeklyPayoutCycle } from './src/core/finance/weekly-cycle.ts';
import { initTocTables } from './server/toconline.ts';
import { registerToconlineRoutes } from './server/routes/toconline.ts';
import { registerBackupRoutes } from './server/routes/backup.ts';
import { CONFIANCA_COMPANY } from './src/core/constants/company.ts';
import { getParamAt, setParam } from './server/params.ts';
import { registerBusinessParametersRoutes, registerPayoutRatesRoutes } from './server/routes/parametros.ts';
import { registerFornecedoresRoutes } from './server/routes/fornecedores.ts';
import { registerCaixaRoutes } from './server/routes/caixa.ts';
import {
  registerAvaliacoesRoutes,
  registerDashboardRoutes,
  registerPartnerReportsRoutes,
  registerReconciliacaoRoutes,
  registerRelatoriosAdminRoutes,
} from './server/routes/relatorios.ts';
import { registerQuilometragemRoutes } from './server/routes/quilometragem.ts';
import { registerIaRoutes } from './server/routes/ia.ts';
import { registerAssinaturasRoutes } from './server/routes/assinaturas.ts';
import { registerPessoasRoutes, registerEspelhoTecnicoRoutes } from './server/routes/pessoas.ts';
import { registerRepasseRoutes, techSeesPayouts } from './server/routes/repasse.ts';
import { registerAuthRoutes } from './server/routes/auth.ts';
import { requireAuth, parseCookies, verifyToken, COOKIE_NAME, type AuthUser } from './server/infra/auth-session.ts';
import { settleOrderPayment } from './server/services/pagamentos.ts';
import { registerStripeWebhookRoutes } from './server/routes/stripe-webhook.ts';
import { registerPagamentosRoutes } from './server/routes/pagamentos.ts';
import { registerOrcamentoRoutes, registerLocalizacaoCalendarioRoutes, registerAgendaRoutes } from './server/routes/orcamento.ts';
import type { UserRole } from './src/types/domain.ts';
import { registerCatalogoRoutes, registerTiposERefRoutes } from './server/routes/listas.ts';
import { registerPedidosRoutes, registerPedidoMensagensRoutes, registerPedidoFotosRoutes, registerPedidoExclusaoRoutes } from './server/routes/pedidos.ts';

initDatabase();

const stripeClient = process.env.STRIPE_SECRET_KEY?.trim()
  ? new Stripe(process.env.STRIPE_SECRET_KEY.trim())
  : null;

const PORT = Number(process.env.PORT) || 3000;

// Métodos de pagamento da Stripe, em lista (ativar cada um exige a conta Stripe configurada)
const STRIPE_PAYMENT_METHODS = (process.env.STRIPE_PAYMENT_METHODS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: 'Cartão',
  multibanco: 'Multibanco',
  mb_way: 'MB Way',
  klarna: 'Klarna',
  bancontact: 'Bancontact',
  amazon_pay: 'Amazon Pay',
  eps: 'EPS',
  link: 'Link',
};
function paymentMethodLabels(): string[] {
  if (!STRIPE_PAYMENT_METHODS.length) return ['Cartão', 'Multibanco', 'MB Way'];
  return STRIPE_PAYMENT_METHODS.map((m) => PAYMENT_METHOD_LABELS[m] || m);
}

async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  template: string;
  recipientUserId?: string | null;
}) {
  const { to, subject, html, template, recipientUserId = null } = params;
  const cleanEmail = String(to || '').trim();
  if (!cleanEmail) return;

  const logId = `eml-${crypto.randomUUID().slice(0, 8)}`;
  const bodyPreview = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || 'Confiança Repara <onboarding@resend.dev>';

  if (!resendKey) {
    db.prepare(`
      INSERT INTO email_logs (id, recipient_user_id, recipient_email, template, subject, body_preview, provider, status)
      VALUES (?, ?, ?, ?, ?, ?, 'preview_log', 'logged_preview')
    `).run(logId, recipientUserId, cleanEmail, template, subject, bodyPreview);
    return;
  }

  try {
    const resendBase = process.env.RESEND_BASE_URL?.trim() || 'https://api.resend.com';
    const resp = await fetch(`${resendBase}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [cleanEmail],
        subject,
        html,
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (resp.ok) {
      db.prepare(`
        INSERT INTO email_logs (id, recipient_user_id, recipient_email, template, subject, body_preview, provider, provider_message_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'resend', ?, 'sent')
      `).run(logId, recipientUserId, cleanEmail, template, subject, bodyPreview, data.id || null);
    } else {
      db.prepare(`
        INSERT INTO email_logs (id, recipient_user_id, recipient_email, template, subject, body_preview, provider, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, 'resend', 'failed', ?)
      `).run(logId, recipientUserId, cleanEmail, template, subject, bodyPreview, data?.message || `HTTP ${resp.status}`);
    }
  } catch (err: any) {
    db.prepare(`
      INSERT INTO email_logs (id, recipient_user_id, recipient_email, template, subject, body_preview, provider, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, 'resend', 'failed', ?)
    `).run(logId, recipientUserId, cleanEmail, template, subject, bodyPreview, err?.message || 'Erro de rede');
  }
}

// Código de referência: prefixo do tipo (WO, SR, CO...) + número sequencial único em toda a base.
function nextReferenceCode(prefix: string): string {
  const row = db
    .prepare('SELECT MAX(CAST(substr(reference_code, -4) AS INTEGER)) AS m FROM service_orders')
    .get() as { m: number | null };
  const next = Math.max(101, (row?.m ?? 100) + 1);
  return `${prefix}-2026-${String(next).padStart(4, '0')}`;
}

function referencePrefixFor(serviceKind: string): string {
  const row = db
    .prepare('SELECT prefix FROM reference_prefixes WHERE service_kind = ?')
    .get(serviceKind) as { prefix: string } | undefined;
  return row?.prefix || 'WO';
}

// Avisa o técnico (in-app e e-mail) de alterações de valor na ordem dele.
function notifyTechnicianOfValueChange(order: any, changes: string[], actorId: string) {
  if (!order.technician_id || order.technician_id === actorId) return;
  const title = `Valores alterados (${order.reference_code})`;
  const body = changes.join(' · ');
  createNotification(order.technician_id, title, body, 'email');
  const tech = db.prepare('SELECT email, full_name FROM profiles WHERE id = ?').get(order.technician_id) as any;
  if (tech?.email) {
    void sendTransactionalEmail({
      to: tech.email,
      recipientUserId: order.technician_id,
      template: 'order_value_changed',
      subject: `Valores alterados — ${order.reference_code}`,
      html: `<p>Olá ${tech.full_name},</p><p>Os valores da ordem <strong>${order.reference_code}</strong> (${order.service_name}) foram atualizados:</p><ul>${changes
        .map((c) => `<li>${c}</li>`)
        .join('')}</ul>`,
    });
  }
}

// NIF português: 9 dígitos. Devolve null se estiver vazio ou for inválido.
function normalizeNif(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\s+/g, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

function createNotification(userId: string, title: string, body: string, channel: 'in_app' | 'email' = 'in_app') {
  const id = `notif-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, user_id, title, body, channel, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, title, body, channel, createdAt);
  broadcastToUser(userId, {
    type: 'notification:new',
    notification: { id, user_id: userId, title, body, channel, is_read: false, created_at: createdAt },
  });
}

// Privacy-enforced projection per role (never leaks supplier cost or company margin to tech/partner/customer)
function projectOrderForRole(order: any, role: UserRole) {
  const base = {
    ...order,
    is_warranty: Boolean(order.is_warranty),
    legacy_parts_markup: Boolean(order.legacy_parts_markup),
    technician_payout_overridden: Boolean(order.technician_payout_overridden),
    technician_payout_locked: Boolean(order.technician_payout_locked),
    service_fee_paid: Boolean(order.service_fee_paid),
    quote_paid: Boolean(order.quote_paid),
  };

  if (role === 'super_admin') {
    return base;
  }

  // Strip internal company margins & supplier costs from non-super_admin
  const { parts_supplier_total: _pst, company_gross_margin: _cgm, ...withoutMargin } = base;

  if (role === 'partner_requester' || role === 'customer') {
    const { technician_payout: _tp, ...publicView } = withoutMargin;
    return publicView;
  }

  return withoutMargin;
}

function projectItemsForRole(items: any[], role: UserRole) {
  return items.map((item) => {
    const base = {
      ...item,
      is_paid_to_supplier: Boolean(item.is_paid_to_supplier),
    };
    if (role === 'super_admin') return base;
    const { supplier_unit_cost: _suc, is_paid_to_supplier: _ips, ...clean } = base;
    return clean;
  });
}

function canUserAccessOrder(user: AuthUser, order: any): boolean {
  if (user.role === 'super_admin') return true;
  if (user.role === 'company_admin') {
    return Boolean(user.organization_id && order.provider_org_id === user.organization_id);
  }
  if (user.role === 'partner_requester') {
    return Boolean(user.organization_id && order.requester_org_id === user.organization_id);
  }
  if (user.role === 'technician') {
    return (
      order.technician_id === user.id ||
      (order.technician_id === null &&
        order.provider_org_id === (user.organization_id || 'org-matrix'))
    );
  }
  if (user.role === 'customer') {
    return order.customer_id === user.id;
  }
  return false;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function findPortugalAddressCoords(addr: string) {
  const hubs: Array<{ match: string; lat: number; lng: number }> = [
    { match: 'corroios', lat: 38.6415, lng: -9.1558 },
    { match: 'almada', lat: 38.6791, lng: -9.1567 },
    { match: 'caparica', lat: 38.6446, lng: -9.2356 },
    { match: 'seixal', lat: 38.6401, lng: -9.1014 },
    { match: 'setúbal', lat: 38.5244, lng: -8.8926 },
    { match: 'setubal', lat: 38.5244, lng: -8.8926 },
    { match: 'parque das nações', lat: 38.7681, lng: -9.0942 },
    { match: 'saldanha', lat: 38.7369, lng: -9.1456 },
    { match: 'chiado', lat: 38.7107, lng: -9.1404 },
    { match: 'alecrim', lat: 38.7094, lng: -9.1436 },
    { match: 'liberdade', lat: 38.7201, lng: -9.1462 },
    { match: 'oeiras', lat: 38.691, lng: -9.3108 },
    { match: 'cascais', lat: 38.6979, lng: -9.4215 },
    { match: 'lisboa', lat: 38.7223, lng: -9.1393 },
  ];
  const low = (addr || '').toLowerCase();
  for (const h of hubs) {
    if (low.includes(h.match)) return { lat: h.lat, lng: h.lng };
  }
  return { lat: 38.7167, lng: -9.1333 };
}

// Compute realistic distance between Portuguese coordinates / addresses
function estimatePortugalRoute(
  origin: string,
  destination: string,
  originCoords?: { lat: number; lng: number } | null,
  destCoords?: { lat: number; lng: number } | null
) {
  const a = originCoords ?? findPortugalAddressCoords(origin);
  const b = destCoords ?? findPortugalAddressCoords(destination);
  const straightKm = haversineKm(a, b);
  const distanceKm = Math.max(1.2, Math.round((straightKm * 1.35 + Number.EPSILON) * 10) / 10);
  const durationMinutes = Math.max(6, Math.round(distanceKm * 1.45 + 5));
  return { distanceKm, durationMinutes, destCoords: b };
}

async function computeRouteDistance(
  origin: string,
  destination: string,
  originCoords?: { lat: number; lng: number } | null,
  destCoords?: { lat: number; lng: number } | null
) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey && apiKey.trim().length > 5) {
    try {
      const originPayload = originCoords
        ? { location: { latLng: { latitude: originCoords.lat, longitude: originCoords.lng } } }
        : { address: origin };
      const destPayload = destCoords
        ? { location: { latLng: { latitude: destCoords.lat, longitude: destCoords.lng } } }
        : { address: destination };

      const response = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
          },
          body: JSON.stringify({
            origin: originPayload,
            destination: destPayload,
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
          }),
        }
      );
      if (response.ok) {
        const data: any = await response.json();
        const route = data.routes?.[0];
        if (route) {
          const distanceKm =
            Math.round((route.distanceMeters / 1000 + Number.EPSILON) * 100) / 100;
          const seconds = parseInt(String(route.duration).replace('s', ''), 10) || 0;
          return {
            distanceKm,
            durationMinutes: Math.max(1, Math.round(seconds / 60)),
            destCoords: destCoords ?? findPortugalAddressCoords(destination),
          };
        }
      }
    } catch {
      // Fallback safely to regional distance calculation
    }
  }
  return estimatePortugalRoute(origin, destination, originCoords, destCoords);
}

const UPLOADS_BASE_DIR = path.resolve(process.cwd(), 'uploads', 'orders');
fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });

function saveOrderPhotoFile(
  orderId: string,
  userId: string,
  input: { phase?: string; caption?: string; fileName?: string; dataUrl: string }
) {
  const validPhases = ['before', 'during', 'after', 'invoice'];
  const safePhase = validPhases.includes(input.phase || '') ? (input.phase as string) : 'before';
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!match) {
    throw new Error('Formato permitido: JPEG, PNG ou WEBP.');
  }
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > 5 * 1024 * 1024) {
    throw new Error('A imagem deve ter no máximo 5 MB.');
  }
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const photoId = `pho-${crypto.randomUUID().slice(0, 10)}`;
  const storedName = `${photoId}.${ext}`;
  const resolvedPath = path.resolve(UPLOADS_BASE_DIR, storedName);
  if (!resolvedPath.startsWith(UPLOADS_BASE_DIR + path.sep)) {
    throw new Error('Caminho de ficheiro inválido.');
  }
  fs.writeFileSync(resolvedPath, buffer);
  const cleanOriginalName = path.basename(String(input.fileName || 'foto.jpg')).slice(0, 120) || storedName;
  db.prepare(`
    INSERT INTO order_photos (id, service_order_id, uploaded_by, phase, file_name, mime_type, file_path, caption)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    photoId,
    orderId,
    userId,
    safePhase,
    cleanOriginalName,
    mimeType,
    storedName,
    String(input.caption || '').trim() || null
  );
  return db
    .prepare(`
      SELECT op.id, op.service_order_id, op.uploaded_by, op.phase, op.file_name, op.mime_type, op.caption, op.created_at,
             p.full_name as uploader_name
      FROM order_photos op
      LEFT JOIN profiles p ON p.id = op.uploaded_by
      WHERE op.id = ?
    `)
    .get(photoId);
}

function getProfilePayload(userId: string) {
  const p = db
    .prepare(
      `SELECT p.id, p.organization_id, o.name as organization_name, o.org_type as organization_type,
              o.custom_payout_percentage as org_payout_pct,
              p.role, p.full_name, p.email, p.phone, p.nif, p.iban, p.address, p.city, p.postal_code,
              p.emergency_contact, p.is_paused, p.is_partner, p.billing_name, p.billing_nif, p.billing_address,
              p.custom_payout_percentage, p.is_active, p.avatar_url, p.created_at
       FROM profiles p
       LEFT JOIN organizations o ON o.id = p.organization_id
       WHERE p.id = ?`
    )
    .get(userId) as any;

  if (!p) return null;
  return {
    ...p,
    is_active: Boolean(p.is_active),
    is_paused: Boolean(p.is_paused),
    is_partner: Boolean(p.is_partner),
    effective_payout_percentage: p.custom_payout_percentage ?? p.org_payout_pct ?? getParamAt(db, 'payout_default_pct'),
  };
}

// Liquidação de pagamento Stripe (webhook, confirmação local e verificação): dependências de server.ts
function settleStripeOrder(
  orderId: string,
  sessionId: string,
  paymentType: string,
  amountPaid: number,
  paymentIntentId?: string | null
): boolean {
  return settleOrderPayment(
    { db, createNotification, broadcastToOrder, sendTransactionalEmail },
    orderId,
    sessionId,
    paymentType,
    amountPaid,
    paymentIntentId
  );
}

// Dependências dos módulos de orçamento, agenda e visitas (server/routes/orcamento.ts)
const contextoOrcamento = {
  db,
  requireAuth,
  canUserAccessOrder,
  projectOrderForRole,
  createNotification,
  broadcastToOrder,
  sendTransactionalEmail,
  recalculateOrderInDb,
  notifyTechnicianOfValueChange,
  computeRouteDistance,
  findPortugalAddressCoords,
};

// Contexto das rotas de pedidos (server/routes/pedidos.ts)
const contextoPedidos = {
  db, requireAuth, canUserAccessOrder, projectOrderForRole, projectItemsForRole, createNotification,
  broadcastToOrder, broadcastToUser, recalculateOrderInDb, notifyTechnicianOfValueChange, normalizeNif,
  nextReferenceCode, referencePrefixFor, saveOrderPhotoFile, UPLOADS_BASE_DIR, sendTransactionalEmail,
};

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Webhook da Stripe: registrado ANTES de express.json (corpo cru para a assinatura) (server/routes/stripe-webhook.ts)
  registerStripeWebhookRoutes(app, { stripeClient, settle: settleStripeOrder });

  app.use(express.json({ limit: '10mb' }));

  // =========================================================================
  registerAuthRoutes(app, { db, requireAuth, hashPassword, verifyPassword, getProfilePayload, createNotification, sendTransactionalEmail });

  // =========================================================================
  // EXECUTIVE & COMPANY DASHBOARD
  // =========================================================================
  registerDashboardRoutes(app, { db, requireAuth });

  // Catálogo de serviços (server/routes/listas.ts)
  registerCatalogoRoutes(app, { db, requireAuth });

  // =========================================================================
  // ORGANIZATIONS (B2B, TECHNICAL CENTERS, PARTNERS)
  // =========================================================================
  registerPessoasRoutes(app, { db, requireAuth, hashPassword, getProfilePayload, projectOrderForRole });

  // =========================================================================
  // SERVICE ORDERS (MULTI-ROLE FILTERED & PROJECTED)
  // =========================================================================
  registerPedidosRoutes(app, contextoPedidos);

  // TOConline: faturação oficial (FT). A gestão autoriza uma vez; depois o sistema emite pelas ordens.
  initTocTables(db);

  registerToconlineRoutes(app, { db, requireAuth });

  // Cópias de segurança e restauração (server/routes/backup.ts)
  registerBackupRoutes(app, { db, requireAuth, dbPath });

  // Listas configuráveis: tipos de aparelho e prefixos de referência (server/routes/listas.ts)
  registerTiposERefRoutes(app, { db, requireAuth });

  registerOrcamentoRoutes(app, contextoOrcamento);

  // Order Chat Messages (persists to DB & broadcasts real-time via WebSocket)
  registerPedidoMensagensRoutes(app, contextoPedidos);

  registerLocalizacaoCalendarioRoutes(app, contextoOrcamento);

  // =========================================================================
  // STRIPE PAYMENTS (UNIFIED FINANCIAL ENGINE + HARDENED RECONCILIATION)
  // =========================================================================

  // Pagamentos de ordens: checkout, confirmação local e verificação de pendentes (server/routes/pagamentos.ts)
  registerPagamentosRoutes(app, { db, requireAuth, stripeClient, settle: settleStripeOrder, canUserAccessOrder, projectOrderForRole, paymentMethodLabels, stripePaymentMethods: STRIPE_PAYMENT_METHODS });

  // =========================================================================
  // WEEKLY PAYOUTS (DOMINGO -> SÁBADO -> SEXTA)
  // =========================================================================
  app.get('/api/settings/visibility', requireAuth(), (_req, res) => {
    res.json({ techSeesPayouts: techSeesPayouts(db) });
  });

  registerRepasseRoutes(app, { db, requireAuth, createNotification, sendTransactionalEmail });

  // =========================================================================
  // SUPPLIERS & PARTS FORECAST
  // =========================================================================
  // =========================================================================
  // ASSISTENTE IA (Gemini): atendimento e dúvidas sobre a app.
  // Quando não consegue resolver, marca a conversa como "encaminhada" e avisa o gestor.
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id),
      status TEXT NOT NULL DEFAULT 'ai_handling',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Assistente de IA (Gemini): status, atendimento, escalonamentos e resolucao (server/routes/ia.ts)
  registerIaRoutes(app, { db, requireAuth, createNotification });

  // Fornecedores e peças (server/routes/fornecedores.ts)
  registerFornecedoresRoutes(app, { db, requireAuth, sendTransactionalEmail });

  // Caixa: lançamentos, recorrência, parcelas, pagamento parcial e comprovativos (server/routes/caixa.ts)
  registerCaixaRoutes(app, { db, requireAuth });

  // =========================================================================
  // MILEAGE & FLEET
  // =========================================================================
  registerQuilometragemRoutes(app, { db, requireAuth, computeRouteDistance, findPortugalAddressCoords, createNotification, broadcastToOrder });

  // Parâmetros de negócio com vigência (server/routes/parametros.ts)
  registerBusinessParametersRoutes(app, { db, requireAuth });

  // =========================================================================
  // PARTNER REPORTS
  // =========================================================================
  registerPartnerReportsRoutes(app, { db, requireAuth });

  // Taxas base de repasse (server/routes/parametros.ts)
  registerPayoutRatesRoutes(app, { db, requireAuth });

  // =========================================================================
  // FASE 1: PAYOUT BASE RATES & RECONCILIATION CENTER
  // =========================================================================
  registerReconciliacaoRoutes(app, { db, requireAuth, recalculateOrderInDb });

  // =========================================================================
  // FASE 2: PRIVATE ORDER PHOTOS, AGENDA & RETURN VISITS, MIRROR VIEW, RATINGS, TRASH
  // =========================================================================
  registerPedidoFotosRoutes(app, contextoPedidos);

  registerAgendaRoutes(app, contextoOrcamento);

  registerEspelhoTecnicoRoutes(app, { db, requireAuth, hashPassword, getProfilePayload, projectOrderForRole });

  registerAvaliacoesRoutes(app, { db, requireAuth });

  registerPedidoExclusaoRoutes(app, contextoPedidos);

  // =========================================================================
  // FASE 3, 4 & 5: GENERAL REPORTS, RESEND BROADCAST & LOGS, SUBSCRIPTIONS
  // =========================================================================
  registerRelatoriosAdminRoutes(app, { db, requireAuth, projectOrderForRole, createNotification, sendTransactionalEmail });

  // Assinaturas: plano mensal de limpeza (server/routes/assinaturas.ts)
  registerAssinaturasRoutes(app, { db, requireAuth, nextReferenceCode, referencePrefixFor, recalculateOrderInDb, projectOrderForRole, createNotification });

  // =========================================================================
  // VITE / STATIC SERVING + WEBSOCKET SERVER
  // =========================================================================
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  registerWebSocketServer(httpServer, { canUserAccessOrder });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Confiança Repara server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
