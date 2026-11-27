import assert from 'node:assert/strict';
import WebSocket from 'ws';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

interface SessionJar {
  token: string;
  cookieHeader: string;
  user: any;
}

async function apiJson(
  path: string,
  options: { method?: string; body?: any; jar?: SessionJar } = {}
): Promise<any> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'ConfiancaApp',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.jar) {
    headers['Authorization'] = `Bearer ${options.jar.token}`;
    if (options.jar.cookieHeader) {
      headers['Cookie'] = options.jar.cookieHeader;
    }
  }

  const resp = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function demoLogin(userId: string): Promise<SessionJar> {
  const resp = await fetch(`${BASE_URL}/api/auth/demo-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ConfiancaApp',
    },
    body: JSON.stringify({ userId }),
  });
  const setCookies = (resp.headers as any).getSetCookie?.() || [];
  const cookieHeader = setCookies.map((c: string) => c.split(';')[0]).join('; ');
  const data: any = await resp.json();
  assert.equal(resp.ok, true, `Demo login failed for ${userId}: ${JSON.stringify(data)}`);
  assert.ok(data.token, 'Token must be returned on login');
  return { token: data.token, cookieHeader, user: data.user };
}

async function runE2E() {
  console.log(`\n🚀 Iniciando Bateria E2E Confiança Repara contra ${BASE_URL}...\n`);

  // 1. 5-Role Logins
  const [admin, company, partner, tech, customer] = await Promise.all([
    demoLogin('user-admin-diego'),
    demoLogin('user-company-ricardo'),
    demoLogin('user-partner-berens'),
    demoLogin('user-tech-joao'),
    demoLogin('user-customer-maria'),
  ]);
  console.log('✓ 1. Login multi-perfil validado para os 5 papéis (Admin, Empresa, Parceiro, Técnico, Cliente).');

  // 2. Customer creates an order -> Tech accepts -> GPS / ETA -> Quote -> Customer approves
  const catRes = await apiJson('/api/catalog', { jar: customer });
  const regularItem = catRes.catalog.find((c: any) => c.is_active && !c.is_subscription);
  assert.ok(regularItem, 'Active catalog item must exist');

  const createdOrderRes = await apiJson('/api/orders', {
    method: 'POST',
    jar: customer,
    body: {
      catalog_id: regularItem.id,
      customer_name: customer.user.full_name,
      customer_phone: '+351 911 222 333',
      service_address: 'Avenida da Liberdade, 210, Lisboa',
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      description: 'Teste E2E esquentador com perda de pressão',
      urgency: 'normal',
    },
  });
  const orderId = createdOrderRes.order.id;
  assert.ok(orderId, 'Order ID must exist');
  assert.ok(createdOrderRes.order.reference_code.startsWith('WO-'), 'Must start with WO-');

  // RBAC Privacy Check for Customer & Partner
  assert.equal('company_gross_margin' in createdOrderRes.order, false, 'Customer must NOT see company_gross_margin');
  assert.equal('technician_payout' in createdOrderRes.order, false, 'Customer must NOT see technician_payout');

  const partnerOrdersRes = await apiJson('/api/orders', { jar: partner });
  if (partnerOrdersRes.orders.length > 0) {
    assert.equal('company_gross_margin' in partnerOrdersRes.orders[0], false, 'Partner must NOT see company_gross_margin');
    assert.equal('technician_payout' in partnerOrdersRes.orders[0], false, 'Partner must NOT see technician_payout');
  }

  // Tech accepts
  await apiJson(`/api/orders/${orderId}`, {
    method: 'PATCH',
    jar: tech,
    body: { status: 'accepted' },
  });

  // Tech marks on_the_way with GPS coordinates (Almada -> Lisboa)
  const mileageRes = await apiJson('/api/mileage/record', {
    method: 'POST',
    jar: tech,
    body: {
      action: 'on_the_way',
      serviceOrderId: orderId,
      originLat: 38.6415,
      originLng: -9.1558,
    },
  });
  assert.ok(Number(mileageRes.trip.distance_km) > 0, 'Distance km must be positive');

  // Live GPS ping & ETA update
  const etaRes = await apiJson(`/api/orders/${orderId}/location`, {
    method: 'POST',
    jar: tech,
    body: { lat: 38.712, lng: -9.139 },
  });
  assert.ok(etaRes.eta_minutes > 0, 'ETA minutes must be computed');

  // Tech submits quote with 1 item
  await apiJson(`/api/orders/${orderId}/quote`, {
    method: 'POST',
    jar: tech,
    body: {
      labor_cost: 60,
      extra_fee: 0,
      items: [
        {
          description: 'Válvula de Segurança E2E',
          quantity: 1,
          customer_unit_price: 40,
        },
      ],
      send_to_customer: true,
    },
  });

  // Tech views order: must NOT see supplier_unit_cost or company_gross_margin
  const techOrderView = await apiJson(`/api/orders/${orderId}`, { jar: tech });
  assert.equal('company_gross_margin' in techOrderView.order, false, 'Tech must NOT see company_gross_margin');
  assert.equal('supplier_unit_cost' in (techOrderView.order.items[0] || {}), false, 'Tech must NOT see supplier_unit_cost');

  // Customer approves quote
  await apiJson(`/api/orders/${orderId}/quote-decision`, {
    method: 'POST',
    jar: customer,
    body: { decision: 'accepted' },
  });
  console.log('✓ 2. Fluxo completo de OS (Criação → Aceite → GPS/ETA → Orçamento → Aprovação) e privacidade RBAC verificados.');

  // 3. Real-time WebSocket Chat Delivery Check
  const wsPromise = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(customer.token)}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket chat:message timeout'));
    }, 6000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe_order', orderId }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'ws:connected') {
        void apiJson(`/api/orders/${orderId}/messages`, {
          method: 'POST',
          jar: tech,
          body: { message: 'Chego dentro de 12 minutos (E2E WS test).' },
        }).catch(reject);
      } else if (msg.type === 'chat:message' && msg.orderId === orderId) {
        assert.ok(String(msg.message.message).includes('E2E WS test'));
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await wsPromise;
  console.log('✓ 3. WebSocket em tempo real (/ws) entregou chat:message instantaneamente na sala da OS.');

  // 4. Stripe Webhook Idempotency + Pending Payment Check
  const checkout = await apiJson('/api/payments/checkout', {
    method: 'POST',
    jar: customer,
    body: { serviceOrderId: orderId, paymentType: 'full' },
  });
  assert.ok(checkout.sessionId && checkout.amountToCharge > 0);

  const webhookPayload = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkout.sessionId,
        payment_status: 'paid',
        amount_total: Math.round(checkout.amountToCharge * 100),
        payment_intent: `pi_e2e_${Date.now()}`,
        metadata: {
          service_order_id: orderId,
          payment_type: 'full',
        },
      },
    },
  };

  // Deliver twice to assert idempotency
  const wh1 = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
  });
  assert.equal(wh1.ok, true);

  const wh2 = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
  });
  assert.equal(wh2.ok, true);

  const cfCheck = await apiJson('/api/cash-flow', { jar: admin });
  const orderPayments = cfCheck.entries.filter((e: any) => e.service_order_id === orderId);
  assert.equal(orderPayments.length, 1, 'Webhook delivery 2x MUST create exactly 1 cash flow entry');

  const verifyPending = await apiJson('/api/payments/verify-pending', {
    method: 'POST',
    jar: admin,
    body: { serviceOrderId: orderId },
  });
  assert.equal(verifyPending.settled, 0);
  console.log('✓ 4. Webhook Stripe idempotente (2 entregas = 1 movimento de caixa) e rotina verify-pending validados.');

  // 5. CashFlow 3x Installments + Partial Pay
  const instRes = await apiJson('/api/cash-flow', {
    method: 'POST',
    jar: admin,
    body: {
      entry_type: 'expense',
      category: 'tools_equipment',
      description: 'Compra Equipamento E2E',
      amount: 300,
      due_date: '2026-12-01',
      total_installments: 3,
      recurrence_frequency: 'none',
    },
  });
  assert.equal(instRes.createdCount, 3, 'Should create 3 installments');
  const firstInstId = instRes.entry.id;

  const partialRes = await apiJson(`/api/cash-flow/${firstInstId}/partial-pay`, {
    method: 'POST',
    jar: admin,
    body: { amount: 40 },
  });
  assert.equal(partialRes.entry.status, 'partial');
  assert.equal(Number(partialRes.entry.paid_amount), 40);
  console.log('✓ 5. Contas a Pagar parcelado (3x) e pagamento parcial validados.');

  // 6. Subscriptions CRUD
  const subCreate = await apiJson('/api/subscriptions', {
    method: 'POST',
    jar: customer,
    body: {
      catalog_id: 'cat-limpeza-sub',
      service_address: 'Rua da Prata, 50, Lisboa',
      preferred_day: 12,
    },
  });
  assert.equal(subCreate.subscription.status, 'active');
  assert.equal(Number(subCreate.subscription.monthly_price), 49.99);

  const subPause = await apiJson(`/api/subscriptions/${subCreate.subscription.id}`, {
    method: 'PATCH',
    jar: customer,
    body: { status: 'paused' },
  });
  assert.equal(subPause.subscription.status, 'paused');
  console.log('✓ 6. Subscrição mensal (€49,99/mês) criada e pausada via API.');

  // 7. Admin General Reports + Broadcast + Email Logs
  const repRes = await apiJson('/api/admin/reports/orders?scope=WO', { jar: admin });
  assert.ok(repRes.orders.some((o: any) => o.id === orderId));

  const bcastRes = await apiJson('/api/admin/broadcast', {
    method: 'POST',
    jar: admin,
    body: {
      audience: 'technicians',
      subject: 'Aviso E2E Equipa',
      message: 'Teste de disparo em massa.',
    },
  });
  assert.ok(bcastRes.sentCount >= 1);

  const logsRes = await apiJson('/api/admin/email-logs', { jar: admin });
  assert.ok(logsRes.logs.some((l: any) => l.template === 'admin_broadcast'));
  console.log('✓ 7. Relatório Geral (WO), Broadcast em massa e email_logs verificados.');

  // 8. PDF & Excel Export Buffer Sanity Check
  const PdfCtor = (jsPDF as any).jsPDF || jsPDF;
  const doc = new PdfCtor();
  autoTable(doc, {
    head: [['Ref.', 'Cliente', 'NIF Confiança']],
    body: [[createdOrderRes.order.reference_code, customer.user.full_name, '518646696']],
  });
  const pdfBuf = doc.output('arraybuffer');
  assert.ok(pdfBuf.byteLength > 500, 'PDF buffer must be non-empty');

  const ws = XLSX.utils.json_to_sheet([{ Ref: createdOrderRes.order.reference_code, Total: 100 }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teste');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.ok(xlsxBuf.byteLength > 500, 'XLSX buffer must be non-empty');
  console.log('✓ 8. Geração real de buffers PDF (jsPDF) e Excel (XLSX) verificada.');

  // Soft-delete E2E order so workspace remains clean
  await apiJson(`/api/orders/${orderId}`, { method: 'DELETE', jar: admin });
  console.log('\n✅ Bateria E2E completa passou 100% sem falhas!\n');
}

runE2E().catch((err) => {
  console.error('\n❌ E2E FAILED:', err);
  process.exit(1);
});
