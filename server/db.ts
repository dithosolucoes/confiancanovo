import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { calculateServiceFinancials } from '../src/core/finance/calculator.ts';
import { getWeeklyPayoutCycle } from '../src/core/finance/weekly-cycle.ts';
import { CONFIANCA_COMPANY } from '../src/core/constants/company.ts';
import { initBusinessParameters, getParamAt } from './params.ts';
import { applyPendingRestore } from './restore.ts';

// DATA_DIR aponta para o volume persistente em produção (ex.: /data na Railway)
const dataDir = process.env.DATA_DIR?.trim()
  ? path.resolve(process.env.DATA_DIR.trim())
  : process.cwd();
fs.mkdirSync(dataDir, { recursive: true });
export const dbPath = path.join(dataDir, 'confianca.db');
// Se a gestão pediu uma restauração, a troca acontece aqui, antes de abrir a base
applyPendingRestore(dbPath);
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nif TEXT,
      org_type TEXT NOT NULL DEFAULT 'partner_client',
      email TEXT,
      phone TEXT,
      address TEXT,
      custom_payout_percentage REAL NOT NULL DEFAULT 50.00,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      nif TEXT,
      iban TEXT,
      address TEXT,
      city TEXT,
      postal_code TEXT,
      custom_payout_percentage REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_catalog (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      base_service_fee REAL NOT NULL DEFAULT 55.00,
      default_vat_rate REAL NOT NULL DEFAULT 23.00,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nif TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_payouts (
      id TEXT PRIMARY KEY,
      technician_id TEXT REFERENCES profiles(id),
      organization_id TEXT REFERENCES organizations(id),
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      due_date TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0.00,
      status TEXT NOT NULL DEFAULT 'pending',
      report_sent_at TEXT,
      paid_at TEXT,
      paid_by TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_orders (
      id TEXT PRIMARY KEY,
      reference_code TEXT UNIQUE NOT NULL,
      catalog_id TEXT REFERENCES service_catalog(id),
      service_name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      urgency TEXT NOT NULL DEFAULT 'normal',
      customer_id TEXT REFERENCES profiles(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      requester_org_id TEXT REFERENCES organizations(id),
      provider_org_id TEXT NOT NULL REFERENCES organizations(id),
      technician_id TEXT REFERENCES profiles(id),
      preferred_technician_id TEXT REFERENCES profiles(id),
      service_address TEXT NOT NULL,
      service_lat REAL,
      service_lng REAL,
      scheduled_at TEXT NOT NULL,
      google_calendar_event_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      quote_status TEXT,
      is_warranty INTEGER NOT NULL DEFAULT 0,
      legacy_parts_markup INTEGER NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 23.00,
      service_fee REAL NOT NULL DEFAULT 55.00,
      labor_cost REAL NOT NULL DEFAULT 0.00,
      extra_fee REAL NOT NULL DEFAULT 0.00,
      additional_cost REAL NOT NULL DEFAULT 0.00,
      parts_customer_total REAL NOT NULL DEFAULT 0.00,
      parts_supplier_total REAL NOT NULL DEFAULT 0.00,
      subtotal_without_vat REAL NOT NULL DEFAULT 0.00,
      vat_amount REAL NOT NULL DEFAULT 0.00,
      total_customer_amount REAL NOT NULL DEFAULT 0.00,
      technician_payout REAL NOT NULL DEFAULT 0.00,
      company_gross_margin REAL NOT NULL DEFAULT 0.00,
      technician_payout_overridden INTEGER NOT NULL DEFAULT 0,
      technician_payout_locked INTEGER NOT NULL DEFAULT 0,
      weekly_payout_id TEXT REFERENCES weekly_payouts(id),
      service_fee_paid INTEGER NOT NULL DEFAULT 0,
      quote_paid INTEGER NOT NULL DEFAULT 0,
      rating INTEGER,
      rating_comment TEXT,
      before_photo_note TEXT,
      after_photo_note TEXT,
      tech_on_the_way_at TEXT,
      tech_arrived_at TEXT,
      completed_at TEXT,
      quote_rejected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_order_items (
      id TEXT PRIMARY KEY,
      service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
      supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      supplier_unit_cost REAL NOT NULL DEFAULT 0.00,
      customer_unit_price REAL NOT NULL DEFAULT 0.00,
      is_paid_to_supplier INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
      stripe_session_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      payment_type TEXT NOT NULL,
      amount REAL NOT NULL,
      vat_amount REAL NOT NULL DEFAULT 0.00,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cash_flow_entries (
      id TEXT PRIMARY KEY,
      entry_type TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT NOT NULL,
      paid_at TEXT,
      service_order_id TEXT REFERENCES service_orders(id) ON DELETE SET NULL,
      weekly_payout_id TEXT REFERENCES weekly_payouts(id) ON DELETE SET NULL,
      supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
      created_by TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mileage_settings (
      id TEXT PRIMARY KEY,
      technician_id TEXT UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      rate_per_km REAL NOT NULL DEFAULT 0.40,
      office_address TEXT NOT NULL DEFAULT 'Avenida Pinhal do Vidal, 30 R/C DRT, 2855-249 Corroios, Portugal',
      office_lat REAL NOT NULL DEFAULT 38.6415,
      office_lng REAL NOT NULL DEFAULT -9.1558,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mileage_trips (
      id TEXT PRIMARY KEY,
      technician_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      service_order_id TEXT REFERENCES service_orders(id) ON DELETE SET NULL,
      trip_type TEXT NOT NULL,
      origin_address TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      distance_km REAL NOT NULL,
      duration_minutes INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      manual_override INTEGER NOT NULL DEFAULT 0,
      override_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS order_messages (
      id TEXT PRIMARY KEY,
      service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES profiles(id),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payout_rate_settings (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 55.00,
      updated_by TEXT REFERENCES profiles(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_photos (
      id TEXT PRIMARY KEY,
      service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
      uploaded_by TEXT NOT NULL REFERENCES profiles(id),
      phase TEXT NOT NULL DEFAULT 'before',
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warranty_return_visits (
      id TEXT PRIMARY KEY,
      service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
      technician_id TEXT REFERENCES profiles(id),
      scheduled_at TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      recipient_user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      recipient_email TEXT NOT NULL,
      template TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_preview TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'preview_log',
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'logged_preview',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_subscriptions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      catalog_id TEXT NOT NULL REFERENCES service_catalog(id),
      plan_name TEXT NOT NULL,
      monthly_price REAL NOT NULL,
      service_address TEXT NOT NULL,
      preferred_day INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'active',
      next_billing_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe column migrations for existing confianca.db instances
  const orderCols = (db.prepare('PRAGMA table_info(service_orders)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  const ensureOrderColumn = (colName: string, ddl: string) => {
    if (!orderCols.includes(colName)) {
      db.exec(`ALTER TABLE service_orders ADD COLUMN ${colName} ${ddl}`);
    }
  };

  ensureOrderColumn('deleted_at', 'TEXT');
  ensureOrderColumn('deleted_by', 'TEXT');
  ensureOrderColumn('service_fee_paid_at', 'TEXT');
  ensureOrderColumn('labor_paid_at', 'TEXT');
  ensureOrderColumn('materials_paid_at', 'TEXT');
  ensureOrderColumn('legacy_payout_rule', 'INTEGER NOT NULL DEFAULT 0');
  ensureOrderColumn('fixed_payout_amount', 'REAL NOT NULL DEFAULT 0');
  ensureOrderColumn('tech_lat', 'REAL');
  ensureOrderColumn('tech_lng', 'REAL');
  ensureOrderColumn('eta_minutes', 'INTEGER');
  ensureOrderColumn('eta_distance_km', 'REAL');
  ensureOrderColumn('eta_updated_at', 'TEXT');
  ensureOrderColumn('address_complement', 'TEXT');
  ensureOrderColumn('postal_code', 'TEXT');
  ensureOrderColumn('localidade', 'TEXT');
  ensureOrderColumn('invoice_number', 'TEXT');
  ensureOrderColumn('invoice_issued_at', 'TEXT');
  ensureOrderColumn('baixa_received_at', 'TEXT');
  ensureOrderColumn('report_text', 'TEXT');
  ensureOrderColumn('suggested_date', 'TEXT');
  ensureOrderColumn('suggested_time', 'TEXT');
  ensureOrderColumn('suggestion_status', 'TEXT');
  ensureOrderColumn('warranty_return_requested_at', 'TEXT');
  ensureOrderColumn('warranty_return_description', 'TEXT');
  // Modo de cobrança da garantia gravado na criação da OS (none | fee_only | as_today); OS antigas ficam NULL
  ensureOrderColumn('warranty_mode', 'TEXT');
  // OS de garantia criada a partir do pedido do cliente: id da OS original (NULL nas OS normais)
  ensureOrderColumn('warranty_of_order_id', 'TEXT');
  // Datas do orçamento (para o painel de peças e a espera dos fornecedores)
  ensureOrderColumn('quote_sent_at', 'TEXT');
  ensureOrderColumn('quote_decided_at', 'TEXT');
  // NIF do cliente para faturação e tipo de aparelho (lista editável pelo gestor)
  ensureOrderColumn('customer_nif', 'TEXT');
  // M.O. e taxa extra lançadas pelo técnico, pendentes de aprovação do gestor (fora de labor_cost/extra_fee até aprovar)
  ensureOrderColumn('pending_labor_cost', 'REAL');
  ensureOrderColumn('pending_extra_fee', 'REAL');
  ensureOrderColumn('appliance_type', 'TEXT');
  // Id do documento na TOConline (fatura oficial)
  ensureOrderColumn('toc_document_id', 'TEXT');
  // Data do cancelamento (cancelamento depois de aceite)
  ensureOrderColumn('cancelled_at', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS appliance_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reference_prefixes (
      service_kind TEXT PRIMARY KEY,
      prefix TEXT NOT NULL,
      label TEXT NOT NULL
    );
  `);
  const appliancesSeed = [
    'Máquina de lavar roupa',
    'Máquina de secar roupa',
    'Lava-loiça',
    'Forno elétrico',
    'Placa de indução / vitrocerâmica',
    'Micro-ondas',
    'Frigorífico / congelador',
    'Exaustor',
    'Esquentador',
    'Termoacumulador',
    'Outro',
  ];
  appliancesSeed.forEach((name, i) => {
    db.prepare('INSERT OR IGNORE INTO appliance_types (id, name, active, sort_order) VALUES (?, ?, 1, ?)').run(
      `apt-${i + 1}`,
      name,
      i + 1
    );
  });
  // Prefixo do código de referência por tipo de serviço (padrão; o gestor pode trocar)
  for (const [kind, prefix, label] of [
    ['avulso', 'WO', 'Avulso'],
    ['sequencia', 'SR', 'Sequência'],
    ['recorrente', 'CO', 'Recorrente (manutenção)'],
  ] as const) {
    db.prepare('INSERT OR IGNORE INTO reference_prefixes (service_kind, prefix, label) VALUES (?, ?, ?)').run(kind, prefix, label);
  }

  // Logística das peças: encomenda, prazo, previsão e chegada efetiva
  const itemCols = (db.prepare('PRAGMA table_info(service_order_items)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  for (const [colName, ddl] of [
    ['ordered_at', 'TEXT'],
    ['lead_days', 'INTEGER'],
    ['expected_arrival_at', 'TEXT'],
    ['arrived_at', 'TEXT'],
    ['chased_at', 'TEXT'],
    ['supplier_quote_status', 'TEXT'],
    ['supplier_quote_requested_at', 'TEXT'],
  ] as const) {
    if (!itemCols.includes(colName)) {
      db.exec(`ALTER TABLE service_order_items ADD COLUMN ${colName} ${ddl}`);
    }
  }

  const profileCols = (db.prepare('PRAGMA table_info(profiles)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  const ensureProfileColumn = (colName: string, ddl: string) => {
    if (!profileCols.includes(colName)) {
      db.exec(`ALTER TABLE profiles ADD COLUMN ${colName} ${ddl}`);
    }
  };
  ensureProfileColumn('emergency_contact', 'TEXT');
  ensureProfileColumn('is_paused', 'INTEGER NOT NULL DEFAULT 0');
  ensureProfileColumn('is_partner', 'INTEGER NOT NULL DEFAULT 0');
  ensureProfileColumn('billing_name', 'TEXT');
  ensureProfileColumn('billing_nif', 'TEXT');
  ensureProfileColumn('billing_address', 'TEXT');
  // Técnico criado por gestão/empresa com senha aleatória: troca obrigatória no primeiro acesso (contas antigas ficam 0)
  ensureProfileColumn('must_change_password', 'INTEGER NOT NULL DEFAULT 0');

  const subCols = (db.prepare('PRAGMA table_info(service_subscriptions)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  if (!subCols.includes('last_order_generated_at')) {
    db.exec('ALTER TABLE service_subscriptions ADD COLUMN last_order_generated_at TEXT');
  }

  // Ensure seeded demo technicians have emergency_contact populated so demo flow stays frictionless
  db.exec(`
    UPDATE profiles
    SET emergency_contact = COALESCE(emergency_contact, '+351 910 000 112 (Contacto Emergência)')
    WHERE id IN ('user-tech-joao', 'user-tech-miguel') AND (emergency_contact IS NULL OR emergency_contact = '');
  `);

  const cfCols = (db.prepare('PRAGMA table_info(cash_flow_entries)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  const ensureCfColumn = (colName: string, ddl: string) => {
    if (!cfCols.includes(colName)) {
      db.exec(`ALTER TABLE cash_flow_entries ADD COLUMN ${colName} ${ddl}`);
    }
  };
  ensureCfColumn('paid_amount', 'REAL NOT NULL DEFAULT 0');
  ensureCfColumn('recurrence_frequency', "TEXT NOT NULL DEFAULT 'none'");
  ensureCfColumn('installment_group_id', 'TEXT');
  ensureCfColumn('installment_number', 'INTEGER');
  ensureCfColumn('total_installments', 'INTEGER');
  ensureCfColumn('receipt_path', 'TEXT');
  ensureCfColumn('receipt_name', 'TEXT');
  ensureCfColumn('receipt_mime', 'TEXT');

  const catCols = (db.prepare('PRAGMA table_info(service_catalog)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  if (!catCols.includes('is_subscription')) {
    db.exec('ALTER TABLE service_catalog ADD COLUMN is_subscription INTEGER NOT NULL DEFAULT 0');
  }
  if (!catCols.includes('subscription_price')) {
    db.exec('ALTER TABLE service_catalog ADD COLUMN subscription_price REAL');
  }
  if (!catCols.includes('warranty_months')) {
    db.exec('ALTER TABLE service_catalog ADD COLUMN warranty_months INTEGER NOT NULL DEFAULT 6');
  }

  // Quilometragem opcional por técnico (1 = recebe km, comportamento atual)
  const profCols = (db.prepare('PRAGMA table_info(profiles)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!profCols.includes('mileage_enabled')) {
    db.exec('ALTER TABLE profiles ADD COLUMN mileage_enabled INTEGER NOT NULL DEFAULT 1');
  }

  // Parâmetros do negócio com vigência (repasse padrão, valor do km)
  initBusinessParameters(db);

  // Desconto / reembolso no fechamento semanal, com motivo obrigatório
  const wpCols = (db.prepare('PRAGMA table_info(weekly_payouts)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!wpCols.includes('adjustment_amount')) {
    db.exec('ALTER TABLE weekly_payouts ADD COLUMN adjustment_amount REAL NOT NULL DEFAULT 0');
  }
  if (!wpCols.includes('adjustment_kind')) {
    db.exec('ALTER TABLE weekly_payouts ADD COLUMN adjustment_kind TEXT');
  }
  if (!wpCols.includes('adjustment_reason')) {
    db.exec('ALTER TABLE weekly_payouts ADD COLUMN adjustment_reason TEXT');
  }

  // Tipo de serviço: avulso (padrão), sequência (várias visitas), recorrente (assinatura)
  const soCols = (db.prepare('PRAGMA table_info(service_orders)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!soCols.includes('service_kind')) {
    db.exec("ALTER TABLE service_orders ADD COLUMN service_kind TEXT NOT NULL DEFAULT 'avulso'");
  }

  // Ensure paid entries reflect full paid_amount
  db.exec(`UPDATE cash_flow_entries SET paid_amount = amount WHERE status = 'paid' AND paid_amount = 0`);

  const orgCount = (db.prepare('SELECT COUNT(*) as cnt FROM organizations').get() as { cnt: number }).cnt;
  if (orgCount === 0) {
    // Dados e contas de demonstração (senha fixa) só com ALLOW_TEST_SHORTCUTS=1 explícito; NODE_ENV não basta.
    if (process.env.ALLOW_TEST_SHORTCUTS === '1') {
      seedInitialData();
    } else {
      bootstrapFirstAdmin();
    }
  }

  // Ensure expanded Phase 5 catalog items exist even on existing confianca.db instances
  const expandedCatalog: Array<[string, string, string, string, number, number, number, number | null, number]> = [
    ['cat-limpeza-sub', 'Limpeza & Subscrições', 'Plano Mensal Limpeza Residencial (€49,99)', 'Subscrição mensal recorrente de limpeza profissional (4h/mês, produtos incluídos).', 49.99, 23.00, 1, 49.99, 0],
    ['cat-pragas', 'Controlo de Pragas', 'Desinfestação & Controlo de Pragas', 'Tratamento certificado contra baratas, formigas, roedores e térmitas.', 65.00, 23.00, 0, null, 6],
    ['cat-jardinagem', 'Jardinagem & Exteriores', 'Manutenção de Jardins & Rega Automática', 'Corte de relva, poda técnica, limpeza de terrenos e programadores de rega.', 55.00, 23.00, 0, null, 3],
    ['cat-estetica', 'Estética & Bem-Estar', 'Estética & Cuidados ao Domicílio', 'Serviços personalizados de bem-estar, fisioterapia ligeira e apoio domiciliário.', 55.00, 23.00, 0, null, 0],
    ['cat-ikea', 'Bricolage & Montagem', 'Montagem de Cozinhas & Mobiliário IKEA', 'Montagem completa de roupeiros PAX, módulos cozinha, estores elétricos e candeeiros.', 55.00, 23.00, 0, null, 6],
  ];
  const insExpanded = db.prepare(`
    INSERT OR IGNORE INTO service_catalog (id, category, name, description, base_service_fee, default_vat_rate, is_subscription, subscription_price, warranty_months, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const row of expandedCatalog) {
    insExpanded.run(...row);
  }

  // Ensure sample subscription exists for Maria Conceição
  const subCount = (db.prepare('SELECT COUNT(*) as cnt FROM service_subscriptions').get() as { cnt: number }).cnt;
  if (subCount === 0) {
    const cust = db.prepare("SELECT id, address FROM profiles WHERE id = 'user-customer-maria'").get() as any;
    if (cust) {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      db.prepare(`
        INSERT INTO service_subscriptions (id, customer_id, catalog_id, plan_name, monthly_price, service_address, preferred_day, status, next_billing_date)
        VALUES ('sub-101', ?, 'cat-limpeza-sub', 'Plano Mensal Limpeza Residencial (€49,99)', 49.99, ?, 15, 'active', ?)
      `).run(cust.id, cust.address || 'Av. da Liberdade, 142, Lisboa', nextMonth.toISOString().split('T')[0]);
    }
  }

  // Ensure default payout rate settings exist even on already-seeded DBs
  const rateCount = (db.prepare('SELECT COUNT(*) as cnt FROM payout_rate_settings').get() as { cnt: number }).cnt;
  if (rateCount === 0) {
    const insRate = db.prepare(`
      INSERT INTO payout_rate_settings (code, label, description, amount)
      VALUES (?, ?, ?, ?)
    `);
    insRate.run('WO', 'Serviços Gerais (WO)', 'Taxa base padrão de deslocação para reparações gerais e eletrodomésticos', 55.00);
    insRate.run('SR', 'Serviços Residenciais (SR)', 'Taxa base para solicitações de assistência técnica residencial', 55.00);
    insRate.run('CO', 'Canalização & Eletricidade (CO)', 'Taxa base para intervenções rápidas de canalização e eletricidade', 55.00);
    insRate.run('ESQ_REP', 'Esquentador Reparação', 'Taxa específica de diagnóstico e reparação de esquentadores/caldeiras', 85.00);
    insRate.run('ESQ_INST', 'Esquentador Instalação', 'Taxa específica para instalação certificada de esquentador', 75.00);
    insRate.run('VISTORIA', 'Vistoria Técnica / Seguradora', 'Taxa base para vistorias imobiliárias e relatórios técnicos', 85.00);
  }

  // Ensure sample warranty return visit exists on existing DBs
  const visitCount = (db.prepare('SELECT COUNT(*) as cnt FROM warranty_return_visits').get() as { cnt: number }).cnt;
  if (visitCount === 0) {
    const ord110 = db.prepare("SELECT id, technician_id FROM service_orders WHERE id = 'ord-110'").get() as any;
    if (ord110) {
      const nextSlot = new Date();
      nextSlot.setUTCDate(nextSlot.getUTCDate() + 2);
      nextSlot.setUTCHours(15, 0, 0, 0);
      db.prepare(`
        INSERT INTO warranty_return_visits (id, service_order_id, technician_id, scheduled_at, notes, status)
        VALUES ('ret-101', 'ord-110', ?, ?, 'Verificação pós-garantia de pressão e vedação de gás', 'scheduled')
      `).run(ord110.technician_id, nextSlot.toISOString());
    }
  }
}

export function recalculateOrderInDb(orderId: string) {
  const order = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(orderId) as any;
  if (!order) return null;

  const items = db
    .prepare('SELECT quantity, customer_unit_price, supplier_unit_cost FROM service_order_items WHERE service_order_id = ?')
    .all(orderId) as Array<{ quantity: number; customer_unit_price: number; supplier_unit_cost: number }>;

  const partsBaseCost = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.customer_unit_price), 0);
  const partsSupplierCost = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.supplier_unit_cost), 0);

  // Padrão vigente na data de criação da ordem (parâmetro do negócio)
  const defaultPayoutPct = getParamAt(db, 'payout_default_pct', order.created_at);
  let customPayoutPercentage = defaultPayoutPct;
  if (order.technician_id) {
    const tech = db
      .prepare('SELECT custom_payout_percentage, organization_id FROM profiles WHERE id = ?')
      .get(order.technician_id) as any;
    const org = db
      .prepare('SELECT custom_payout_percentage FROM organizations WHERE id = ?')
      .get(tech?.organization_id || order.provider_org_id) as any;
    customPayoutPercentage = tech?.custom_payout_percentage ?? org?.custom_payout_percentage ?? defaultPayoutPct;
  } else {
    const org = db
      .prepare('SELECT custom_payout_percentage FROM organizations WHERE id = ?')
      .get(order.provider_org_id) as any;
    customPayoutPercentage = org?.custom_payout_percentage ?? defaultPayoutPct;
  }

  const financials = calculateServiceFinancials({
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
    customPayoutPercentage,
    payoutLocked: Boolean(order.technician_payout_locked),
    payoutOverridden: Boolean(order.technician_payout_overridden),
    manualTechnicianPayout: Number(order.technician_payout),
  });

  db.prepare(`
    UPDATE service_orders SET
      parts_customer_total = ?,
      parts_supplier_total = ?,
      subtotal_without_vat = ?,
      vat_amount = ?,
      total_customer_amount = ?,
      technician_payout = ?,
      company_gross_margin = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    financials.customerPartsTotal,
    partsSupplierCost,
    financials.subtotalWithoutVat,
    financials.vatAmount,
    financials.totalCustomerAmount,
    financials.technicianPayout,
    financials.companyGrossMargin,
    orderId
  );

  return db.prepare('SELECT * FROM service_orders WHERE id = ?').get(orderId);
}

// Produção com base vazia: cria só a empresa e o primeiro gestor, com a senha dada por variável de ambiente.
// Não cria contas de demonstração nem pedidos.
function bootstrapFirstAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email || password.length < 12) {
    console.warn(
      'Base vazia em produção: defina BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD (mínimo 12 caracteres) para criar o primeiro gestor.'
    );
    return;
  }
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, nif, org_type, email, phone, address, custom_payout_percentage)
    VALUES ('org-matrix', ?, ?, 'matrix', ?, '+351 212 555 100', ?, 50.0)
  `).run(CONFIANCA_COMPANY.legalName, CONFIANCA_COMPANY.nif, email, CONFIANCA_COMPANY.fullAddress);
  db.prepare(`
    INSERT INTO profiles (id, organization_id, role, full_name, email, password_hash, is_active)
    VALUES ('user-admin-bootstrap', 'org-matrix', 'super_admin', ?, ?, ?, 1)
  `).run(process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Gestor', email, hashPassword(password));
  console.info('Primeiro gestor criado a partir das variáveis BOOTSTRAP_ADMIN_*.');
}

function seedInitialData() {
  const demoPassHash = hashPassword('Confianca2026!');
  const now = new Date();
  const cycle = getWeeklyPayoutCycle(now);

  // Use dates inside the current Sunday-to-Saturday cycle
  const weekMidDate = new Date(`${cycle.weekStart}T10:30:00.000Z`);
  weekMidDate.setUTCDate(weekMidDate.getUTCDate() + 1);
  const completed1 = weekMidDate.toISOString();
  weekMidDate.setUTCDate(weekMidDate.getUTCDate() + 1);
  const completed2 = weekMidDate.toISOString();

  // Last week completed date
  const prevDate = new Date(`${cycle.weekStart}T14:00:00.000Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 3);
  const prevWeekCompleted = prevDate.toISOString();
  const prevCycle = getWeeklyPayoutCycle(prevDate);

  const tx = db.transaction(() => {
    // 1. Organizations
    const insertOrg = db.prepare(`
      INSERT INTO organizations (id, name, nif, org_type, email, phone, address, custom_payout_percentage, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    insertOrg.run('org-matrix', CONFIANCA_COMPANY.legalName, CONFIANCA_COMPANY.nif, 'matrix', 'geral@confiancamanutencao.com', '+351 212 555 100', CONFIANCA_COMPANY.fullAddress, 50.0);
    insertOrg.run('org-ct-margemsul', 'Centro Técnico Margem Sul Lda', '509112340', 'technical_center', 'faturacao@ctmargemsul.pt', '+351 212 778 200', 'Rua Capitão Leitão, 48, 2800-132 Almada', 65.0);
    insertOrg.run('org-partner-berens', 'Berens Estate Management', '514887210', 'partner_client', 'operations@berensestate.pt', '+351 213 440 900', 'Av. Fontes Pereira de Melo, 14, 1050-121 Lisboa', 50.0);
    insertOrg.run('org-partner-tejo', 'Tejo Condomínios & Gestão Lda', '513224119', 'partner_client', 'gestao@tejocondominios.pt', '+351 265 118 400', 'Av. Luísa Todi, 210, 2900-452 Setúbal', 50.0);
    insertOrg.run('org-saas-atlantico', 'Atlântico Serviços Técnicos', '516908332', 'saas_company', 'equipa@atlanticoservicos.pt', '+351 214 900 321', 'Av. dos Cavaleiros, 70, 2790-045 Carnaxide', 55.0);

    // 2. Profiles
    const insertProfile = db.prepare(`
      INSERT INTO profiles (id, organization_id, role, full_name, email, password_hash, phone, nif, iban, address, city, postal_code, custom_payout_percentage, is_active, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    insertProfile.run('user-admin-diego', 'org-matrix', 'super_admin', 'Diego Silva', 'diego@confiancamanutencao.com', demoPassHash, '+351 912 345 678', '219440112', null, 'Av. Pinhal do Vidal, 30', 'Corroios', '2855-249', null, '/src/assets/images/avatar_diego_admin_1795289338598.jpg');
    insertProfile.run('user-admin-elaine', 'org-matrix', 'super_admin', 'Elaine Costa', 'elaine@confiancamanutencao.com', demoPassHash, '+351 912 345 679', '221883019', null, 'Av. Pinhal do Vidal, 30', 'Corroios', '2855-249', null, null);
    insertProfile.run('user-company-ricardo', 'org-ct-margemsul', 'company_admin', 'Ricardo Mendes', 'ricardo@ctmargemsul.pt', demoPassHash, '+351 934 112 890', '208991234', 'PT50003501200004412398120', 'Rua Capitão Leitão, 48', 'Almada', '2800-132', null, null);
    insertProfile.run('user-partner-berens', 'org-partner-berens', 'partner_requester', 'Ana Berens', 'ana@berensestate.pt', demoPassHash, '+351 918 220 410', '231009445', null, 'Av. Fontes Pereira de Melo, 14', 'Lisboa', '1050-121', null, null);
    insertProfile.run('user-tech-joao', 'org-matrix', 'technician', 'João Ferreira', 'joao@confiancamanutencao.com', demoPassHash, '+351 961 884 210', '234891023', 'PT50003300004529108831205', 'Rua da Liberdade, 18, Amora', 'Seixal', '2845-120', null, '/src/assets/images/avatar_tech_carlos_1795289338369.jpg');
    insertProfile.run('user-tech-miguel', 'org-ct-margemsul', 'technician', 'Miguel Tavares', 'miguel@ctmargemsul.pt', demoPassHash, '+351 927 441 902', '248910334', 'PT50001800032910445120988', 'Rua Fernão Mendes Pinto, 9', 'Almada', '2805-140', null, null);
    insertProfile.run('user-customer-maria', null, 'customer', 'Maria Conceição', 'maria@cliente.pt', demoPassHash, '+351 914 778 521', '198445210', null, 'Av. da Liberdade, 142, 4º Esq', 'Lisboa', '1250-146', null, null);

    // 3. Service Catalog (Portugal)
    const insertCat = db.prepare(`
      INSERT INTO service_catalog (id, category, name, description, base_service_fee, default_vat_rate, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    insertCat.run('cat-esq-rep', 'Climatização & Esquentadores', 'Reparação de Esquentador / Caldeira', 'Diagnóstico completo de ignição, membrana, sonda NTC e segurança de gases.', 85.00, 6.00);
    insertCat.run('cat-esq-inst', 'Climatização & Esquentadores', 'Instalação de Esquentador', 'Substituição e ligação certificada com verificação de exaustão.', 75.00, 23.00);
    insertCat.run('cat-vistoria', 'Climatização & Esquentadores', 'Vistoria Técnica Imobiliária', 'Inspeção completa de canalização, quadro elétrico e equipamentos para imóveis.', 85.00, 23.00);
    insertCat.run('cat-ac-man', 'Climatização & Esquentadores', 'Manutenção de Ar Condicionado', 'Limpeza química de filtros, verificação de gás e dreno.', 55.00, 23.00);
    insertCat.run('cat-can-fuga', 'Canalização', 'Reparação de Fuga de Água / Torneira', 'Deteção e reparação urgente de roturas, autoclismos e torneiras.', 55.00, 6.00);
    insertCat.run('cat-can-des', 'Canalização', 'Desentupimento Doméstico', 'Desobstrução mecânica de lava-loiças, sanitas e ralos.', 55.00, 23.00);
    insertCat.run('cat-ele-qua', 'Eletricidade', 'Avaria de Quadro Elétrico / Disjuntor', 'Diagnóstico de curtos-circuitos, diferenciais e substituição de disjuntores.', 55.00, 6.00);
    insertCat.run('cat-ele-tom', 'Eletricidade', 'Substituição de Tomadas e Iluminação', 'Instalação de pontos de luz, tomadas e interruptores.', 55.00, 23.00);
    insertCat.run('cat-eletro-lr', 'Eletrodomésticos', 'Reparação Máquina de Lavar Roupa', 'Bomba de esgoto, resistência, rolamentos, módulo eletrónico e fechadura.', 55.00, 23.00);
    insertCat.run('cat-eletro-ll', 'Eletrodomésticos', 'Reparação Máquina de Lavar Louça', 'Válvula aquastop, bomba de circulação e aquecimento.', 55.00, 23.00);
    insertCat.run('cat-eletro-fr', 'Eletrodomésticos', 'Reparação de Frigorífico / Combinado', 'Termostato, sonda No-Frost, ventilador e relé de arranque.', 55.00, 23.00);
    insertCat.run('cat-eletro-fp', 'Eletrodomésticos', 'Reparação de Forno / Placa Indução', 'Resistências, comutadores, módulos de potência e vidro cerâmico.', 55.00, 23.00);
    insertCat.run('cat-eletro-ex', 'Eletrodomésticos', 'Reparação de Exaustor / Micro-ondas', 'Motores de extração, condensadores e magnetrão.', 55.00, 23.00);
    insertCat.run('cat-bricolage', 'Bricolage & Montagem', 'Montagem de Mobiliário e Estores', 'Substituição de fitas de estores, suportes TV e carpintaria ligeira.', 55.00, 23.00);
    insertCat.run('cat-pintura', 'Pintura & Acabamentos', 'Pintura Interior e Reparação de Paredes', 'Tratamento de humidades, massa e pintura em apartamentos.', 55.00, 23.00);
    insertCat.run('cat-limpeza', 'Limpeza & Jardinagem', 'Limpeza Técnica / Manutenção de Jardim', 'Limpezas pós-reparação, corte de sebes e rega automática.', 55.00, 23.00);

    // 4. Suppliers
    const insertSup = db.prepare(`INSERT INTO suppliers (id, name, nif, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)`);
    insertSup.run('sup-electropecas', 'ElectroPeças Lisboa Lda', '508112990', '+351 218 990 120', 'encomendas@electropecas.pt', 'Peças originais Bosch, Vulcano, Junkers e LG');
    insertSup.run('sup-hidrocorroios', 'HidroCorroios Materiais', '511209881', '+351 212 550 882', 'balcao@hidrocorroios.pt', 'Canalização, válvulas e acessórios cobre/PEX');
    insertSup.run('sup-wortenpro', 'Worten Peças Pro', '503630330', '+351 210 155 200', 'b2b@worten.pt', 'Componentes eletrodomésticos');
    insertSup.run('sup-leroy', 'Leroy Merlin Pro Almada', '506848558', '+351 212 589 400', 'pro.almada@leroymerlin.pt', 'Consumíveis elétricos e bricolage');

    // 5. Mileage Settings
    db.prepare(`
      INSERT INTO mileage_settings (id, technician_id, rate_per_km, office_address, office_lat, office_lng)
      VALUES ('ms-global', NULL, 0.40, ?, ?, ?)
    `).run(CONFIANCA_COMPANY.fullAddress, CONFIANCA_COMPANY.officeLat, CONFIANCA_COMPANY.officeLng);

    // 6. Historical Closed Weekly Payout (Previous Week)
    db.prepare(`
      INSERT INTO weekly_payouts (id, technician_id, organization_id, week_start, week_end, due_date, total_amount, status, report_sent_at, paid_at, paid_by)
      VALUES ('wp-prev-joao', 'user-tech-joao', NULL, ?, ?, ?, 77.50, 'paid', ?, ?, 'user-admin-diego')
    `).run(prevCycle.weekStart, prevCycle.weekEnd, prevCycle.dueDate, prevWeekCompleted, prevWeekCompleted);

    // 7. Service Orders
    const insertOrder = db.prepare(`
      INSERT INTO service_orders (
        id, reference_code, catalog_id, service_name, category, description, urgency,
        customer_id, customer_name, customer_phone, requester_org_id, provider_org_id, technician_id, preferred_technician_id,
        service_address, service_lat, service_lng, scheduled_at, status, quote_status, is_warranty, legacy_parts_markup,
        vat_rate, service_fee, labor_cost, extra_fee, additional_cost, technician_payout_overridden, technician_payout_locked,
        weekly_payout_id, service_fee_paid, quote_paid, rating, rating_comment, tech_on_the_way_at, tech_arrived_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Order 1: Completed this week - João Ferreira (Esquentador Reparação €85, IVA 6%)
    insertOrder.run(
      'ord-101', 'WO-2026-0101', 'cat-esq-rep', 'Reparação de Esquentador / Caldeira', 'Climatização & Esquentadores',
      'Esquentador Vulcano não dispara a chama quando abre a água quente.', 'urgent',
      'user-customer-maria', 'Maria Conceição', '+351 914 778 521', null, 'org-matrix', 'user-tech-joao', null,
      'Av. da Liberdade, 142, 4º Esq, Lisboa', 38.7201, -9.1462, completed1, 'completed', 'accepted', 0, 0,
      6, 85.00, 90.00, 0.00, 0.00, 0, 0,
      null, 1, 1, 5, 'Rápido, limpo e explicou tudo detalhadamente.', completed1, completed1, completed1
    );

    // Order 2: Completed this week - Berens Estate Management + João Ferreira (Máquina Lavar Roupa, IVA 23%)
    insertOrder.run(
      'ord-102', 'WO-2026-0102', 'cat-eletro-lr', 'Reparação Máquina de Lavar Roupa', 'Eletrodomésticos',
      'Apartamento T2 gerido pela Berens: máquina não escoa água e dá erro E18.', 'normal',
      null, 'Inquilino: Pedro Magalhães (Berens)', '+351 918 332 100', 'org-partner-berens', 'org-matrix', 'user-tech-joao', null,
      'Rua Garrett, 64, 2º Dto, Chiado, Lisboa', 38.7107, -9.1404, completed2, 'completed', 'accepted', 0, 0,
      23, 55.00, 70.00, 20.00, 15.00, 0, 0,
      null, 1, 1, null, null, completed2, completed2, completed2
    );

    // Order 3: Completed this week - Centro Técnico Margem Sul (65% custom payout!)
    insertOrder.run(
      'ord-103', 'WO-2026-0103', 'cat-ele-qua', 'Avaria de Quadro Elétrico / Disjuntor', 'Eletricidade',
      'Disjuntor diferencial dispara sempre que se liga o forno.', 'urgent',
      null, 'Condomínio Parque Tejo (Tejo Gestão)', '+351 265 118 400', 'org-partner-tejo', 'org-ct-margemsul', 'user-tech-miguel', null,
      'Av. Luísa Todi, 310, 1º, Setúbal', 38.5244, -8.8926, completed2, 'completed', 'accepted', 0, 0,
      6, 55.00, 110.00, 0.00, 0.00, 0, 0,
      null, 1, 1, null, null, completed2, completed2, completed2
    );

    // Order 4: Previous week completed & PAID (Maria Conceição + João Ferreira -> enables "Quero o mesmo técnico")
    insertOrder.run(
      'ord-104', 'WO-2026-0104', 'cat-can-fuga', 'Reparação de Fuga de Água / Torneira', 'Canalização',
      'Pequena fuga no sifão da cozinha.', 'normal',
      'user-customer-maria', 'Maria Conceição', '+351 914 778 521', null, 'org-matrix', 'user-tech-joao', null,
      'Av. da Liberdade, 142, 4º Esq, Lisboa', 38.7201, -9.1462, prevWeekCompleted, 'completed', 'accepted', 0, 0,
      6, 55.00, 100.00, 0.00, 0.00, 0, 1,
      'wp-prev-joao', 1, 1, 5, 'Excelente atendimento do João!', prevWeekCompleted, prevWeekCompleted, prevWeekCompleted
    );

    // Order 5: Payment Pending + Quote Sent (for Maria / Berens to test Approve & Pay OR Reject!)
    insertOrder.run(
      'ord-105', 'WO-2026-0105', 'cat-eletro-fr', 'Reparação de Frigorífico / Combinado', 'Eletrodomésticos',
      'Frigorífico Bosch não faz frio na parte superior, congelador funciona.', 'normal',
      'user-customer-maria', 'Maria Conceição', '+351 914 778 521', null, 'org-matrix', 'user-tech-joao', 'user-tech-joao',
      'Av. da Liberdade, 142, 4º Esq, Lisboa', 38.7201, -9.1462, now.toISOString(), 'payment_pending', 'sent', 0, 0,
      23, 55.00, 85.00, 0.00, 0.00, 0, 0,
      null, 1, 0, null, null, now.toISOString(), now.toISOString(), null
    );

    // Order 6: Berens Quote Sent awaiting Partner approval!
    insertOrder.run(
      'ord-106', 'WO-2026-0106', 'cat-esq-inst', 'Instalação de Esquentador', 'Climatização & Esquentadores',
      'Substituição completa de esquentador antigo em fração arrendada.', 'normal',
      null, 'Fração 3º B — Rua do Alecrim (Berens)', '+351 918 220 410', 'org-partner-berens', 'org-matrix', 'user-tech-joao', null,
      'Rua do Alecrim, 42, 3º B, Lisboa', 38.7094, -9.1436, now.toISOString(), 'budgeting', 'sent', 0, 0,
      23, 75.00, 120.00, 0.00, 0.00, 0, 0,
      null, 1, 0, null, null, now.toISOString(), now.toISOString(), null
    );

    // Order 7: Accepted by João Ferreira (ready to click "A Caminho" and compute mileage!)
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(now.getUTCHours() + 3);
    insertOrder.run(
      'ord-107', 'WO-2026-0107', 'cat-can-fuga', 'Reparação de Fuga de Água / Torneira', 'Canalização',
      'Autoclismo embutido com perda contínua de água.', 'urgent',
      'user-customer-maria', 'Maria Conceição', '+351 914 778 521', null, 'org-matrix', 'user-tech-joao', 'user-tech-joao',
      'Av. da República, 85, Saldanha, Lisboa', 38.7369, -9.1456, tomorrow.toISOString(), 'accepted', null, 0, 0,
      6, 55.00, 0.00, 0.00, 0.00, 0, 0,
      null, 1, 0, null, null, null, null, null
    );

    // Order 8: Pending unassigned (Technician Job Board)
    insertOrder.run(
      'ord-108', 'WO-2026-0108', 'cat-vistoria', 'Vistoria Técnica Imobiliária', 'Climatização & Esquentadores',
      'Vistoria técnica antes de entrega de chaves — Imóvel T3 Parque das Nações.', 'normal',
      null, 'Berens — Imóvel Parque das Nações', '+351 918 220 410', 'org-partner-berens', 'org-matrix', null, null,
      'Alameda dos Oceanos, 65, Parque das Nações, Lisboa', 38.7681, -9.0942, tomorrow.toISOString(), 'pending', null, 0, 0,
      23, 85.00, 0.00, 0.00, 0.00, 0, 0,
      null, 1, 0, null, null, null, null, null
    );

    // Order 9: Rejected quote example (Tech payout = 50% of service_fee = €27.50)
    insertOrder.run(
      'ord-109', 'WO-2026-0109', 'cat-eletro-ll', 'Reparação Máquina de Lavar Louça', 'Eletrodomésticos',
      'Cliente optou por comprar equipamento novo após orçamento.', 'normal',
      null, 'António Rocha', '+351 965 221 098', null, 'org-matrix', 'user-tech-joao', null,
      'Rua Dom Nuno Álvares Pereira, 22, Almada', 38.6791, -9.1567, completed1, 'completed', 'rejected', 0, 0,
      23, 55.00, 120.00, 30.00, 0.00, 0, 0,
      null, 1, 0, null, null, completed1, completed1, completed1
    );

    // Order 10: Warranty service example (is_warranty = 1, extra_fee zeroed for payout)
    insertOrder.run(
      'ord-110', 'WO-2026-0110', 'cat-esq-rep', 'Reparação de Esquentador / Caldeira', 'Climatização & Esquentadores',
      'Retorno de garantia — ajuste fino de pressão de água.', 'normal',
      null, 'Helena Martins', '+351 919 802 331', null, 'org-matrix', 'user-tech-joao', null,
      'Av. 25 de Abril, 19, Costa da Caparica', 38.6446, -9.2356, completed2, 'completed', 'accepted', 1, 0,
      6, 85.00, 60.00, 40.00, 0.00, 0, 0,
      null, 1, 1, null, null, completed2, completed2, completed2
    );

    // 8. Service Order Items (Parts with optional suppliers)
    const insertItem = db.prepare(`
      INSERT INTO service_order_items (id, service_order_id, supplier_id, description, quantity, supplier_unit_cost, customer_unit_price, is_paid_to_supplier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertItem.run('item-1', 'ord-101', 'sup-electropecas', 'Sonda NTC + Membrana Vulcano', 1, 28.00, 45.00, 0);
    insertItem.run('item-2', 'ord-102', 'sup-wortenpro', 'Bomba de esgoto Bosch/Siemens', 1, 40.00, 65.00, 0);
    insertItem.run('item-3', 'ord-104', 'sup-hidrocorroios', 'Kit vedantes e sifão cromado', 1, 12.00, 25.00, 1);
    insertItem.run('item-4', 'ord-105', 'sup-electropecas', 'Módulo Ventilador No-Frost Bosch', 1, 52.00, 95.00, 0);
    insertItem.run('item-5', 'ord-106', null, 'Tubo de exaustão alumínio 110mm (comprado pelo técnico)', 1, 0.00, 32.00, 0);

    // Recalculate all orders through unified engine
    for (const id of ['ord-101', 'ord-102', 'ord-103', 'ord-104', 'ord-105', 'ord-106', 'ord-107', 'ord-108', 'ord-109', 'ord-110']) {
      recalculateOrderInDb(id);
    }

    // 9. Payments & Cash Flow
    const insertPayment = db.prepare(`
      INSERT INTO payments (id, service_order_id, stripe_session_id, stripe_payment_intent_id, payment_type, amount, vat_amount, status, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPayment.run('pay-101', 'ord-101', 'cs_live_101', 'pi_live_101', 'full', 233.20, 13.20, 'paid', completed1);
    insertPayment.run('pay-102', 'ord-102', 'cs_live_102', 'pi_live_102', 'full', 276.75, 51.75, 'paid', completed2);
    insertPayment.run('pay-103', 'ord-103', 'cs_live_103', 'pi_live_103', 'full', 174.90, 9.90, 'paid', completed2);
    insertPayment.run('pay-104', 'ord-104', 'cs_live_104', 'pi_live_104', 'full', 190.80, 10.80, 'paid', prevWeekCompleted);

    const insertCF = db.prepare(`
      INSERT INTO cash_flow_entries (id, entry_type, category, description, amount, status, due_date, paid_at, service_order_id, weekly_payout_id, supplier_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertCF.run('cf-1', 'income', 'service_revenue', 'Pagamento Stripe (full) — WO-2026-0101', 233.20, 'paid', completed1.split('T')[0], completed1, 'ord-101', null, null, 'user-admin-diego');
    insertCF.run('cf-2', 'income', 'service_revenue', 'Faturação Parceiro Berens — WO-2026-0102', 276.75, 'paid', completed2.split('T')[0], completed2, 'ord-102', null, null, 'user-admin-diego');
    insertCF.run('cf-3', 'income', 'service_revenue', 'Faturação Parceiro Tejo — WO-2026-0103', 174.90, 'paid', completed2.split('T')[0], completed2, 'ord-103', null, null, 'user-admin-diego');
    insertCF.run('cf-4', 'income', 'service_revenue', 'Pagamento Stripe (full) — WO-2026-0104', 190.80, 'paid', prevWeekCompleted.split('T')[0], prevWeekCompleted, 'ord-104', null, null, 'user-admin-diego');
    insertCF.run('cf-5', 'expense', 'tech_payout', `Repasse Semanal Pago (${prevCycle.weekStart} a ${prevCycle.weekEnd}) — João Ferreira`, 77.50, 'paid', prevCycle.dueDate, prevWeekCompleted, null, 'wp-prev-joao', null, 'user-admin-diego');
    insertCF.run('cf-6', 'expense', 'supplier_parts', 'Peças ElectroPeças Lisboa — WO-2026-0101', 28.00, 'pending', cycle.dueDate, null, 'ord-101', null, 'sup-electropecas', 'user-admin-diego');
    insertCF.run('cf-7', 'expense', 'supplier_parts', 'Peças Worten Peças Pro — WO-2026-0102', 40.00, 'pending', cycle.dueDate, null, 'ord-102', null, 'sup-wortenpro', 'user-admin-diego');
    insertCF.run('cf-8', 'expense', 'fixed_expense', 'Renda Escritório Corroios & Telecomunicações', 680.00, 'paid', completed1.split('T')[0], completed1, null, null, null, 'user-admin-diego');

    // 10. Mileage Trips
    const insertTrip = db.prepare(`
      INSERT INTO mileage_trips (id, technician_id, service_order_id, trip_type, origin_address, destination_address, distance_km, duration_minutes, started_at, ended_at, manual_override, override_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
    `);
    insertTrip.run('trip-1', 'user-tech-joao', 'ord-101', 'office_to_client', CONFIANCA_COMPANY.fullAddress, 'Av. da Liberdade, 142, 4º Esq, Lisboa', 19.4, 28, completed1, completed1);
    insertTrip.run('trip-2', 'user-tech-joao', 'ord-109', 'client_to_client', 'Av. da Liberdade, 142, 4º Esq, Lisboa', 'Rua Dom Nuno Álvares Pereira, 22, Almada', 14.2, 22, completed1, completed1);
    insertTrip.run('trip-3', 'user-tech-joao', null, 'client_to_office', 'Rua Dom Nuno Álvares Pereira, 22, Almada', CONFIANCA_COMPANY.fullAddress, 7.8, 13, completed1, completed1);
    insertTrip.run('trip-4', 'user-tech-joao', 'ord-102', 'office_to_client', CONFIANCA_COMPANY.fullAddress, 'Rua Garrett, 64, 2º Dto, Chiado, Lisboa', 18.6, 26, completed2, completed2);

    // 11. Messages
    const insertMsg = db.prepare(`INSERT INTO order_messages (id, service_order_id, sender_id, message, created_at) VALUES (?, ?, ?, ?, ?)`);
    insertMsg.run('msg-1', 'ord-105', 'user-tech-joao', 'Bom dia D. Maria, confirmei que o módulo ventilador No-Frost precisa de substituição. Já enviei o orçamento detalhado para sua aprovação.', now.toISOString());
    insertMsg.run('msg-2', 'ord-105', 'user-admin-diego', 'Olá Maria! Assim que aprovar o orçamento pode liquidar diretamente por MB Way, Multibanco ou Cartão.', now.toISOString());
    insertMsg.run('msg-3', 'ord-106', 'user-partner-berens', 'Olá equipa Confiança, por favor confirmar se a chaminé de exaustão fica incluída no orçamento para enviarmos ao proprietário.', now.toISOString());

    // 12. Notifications
    const insertNotif = db.prepare(`INSERT INTO notifications (id, user_id, title, body, channel, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`);
    insertNotif.run('notif-1', 'user-admin-diego', 'Novo orçamento aguardando cliente', 'WO-2026-0105 (Maria Conceição) tem orçamento pendente de €227,55 c/ IVA.', 'in_app', now.toISOString());
    insertNotif.run('notif-2', 'user-tech-joao', 'Cliente pediu o mesmo técnico', 'Maria Conceição selecionou "Quero o mesmo técnico" na ordem WO-2026-0107.', 'in_app', now.toISOString());
    insertNotif.run('notif-3', 'user-customer-maria', 'Orçamento disponível para aprovação', 'O técnico João Ferreira enviou o orçamento da ordem WO-2026-0105.', 'email', now.toISOString());
  });

  tx();
}
