-- ============================================================================
-- Confiança Repara — Production PostgreSQL / Supabase Schema (Fase 5)
-- Compatible with PostgreSQL 15+ and Supabase Auth / Row-Level Security
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nif TEXT,
  org_type TEXT NOT NULL DEFAULT 'partner_client' CHECK (org_type IN ('matrix', 'technical_center', 'partner_client', 'saas_company')),
  email TEXT,
  phone TEXT,
  address TEXT,
  custom_payout_percentage NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('super_admin', 'company_admin', 'partner_requester', 'technician', 'customer')),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  nif TEXT,
  iban TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  custom_payout_percentage NUMERIC(5,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_catalog (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_service_fee NUMERIC(10,2) NOT NULL DEFAULT 55.00,
  default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 23.00,
  is_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_price NUMERIC(10,2),
  warranty_months INTEGER NOT NULL DEFAULT 6,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nif TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_payouts (
  id TEXT PRIMARY KEY,
  technician_id TEXT REFERENCES profiles(id),
  organization_id TEXT REFERENCES organizations(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('open', 'pending', 'paid')),
  report_sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  service_lat DOUBLE PRECISION,
  service_lng DOUBLE PRECISION,
  tech_lat DOUBLE PRECISION,
  tech_lng DOUBLE PRECISION,
  eta_minutes INTEGER,
  eta_distance_km NUMERIC(8,2),
  eta_updated_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ NOT NULL,
  google_calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  quote_status TEXT,
  is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_parts_markup BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_payout_rule BOOLEAN NOT NULL DEFAULT FALSE,
  fixed_payout_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 23.00,
  service_fee NUMERIC(10,2) NOT NULL DEFAULT 55.00,
  labor_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  extra_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  additional_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  parts_customer_total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  parts_supplier_total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  subtotal_without_vat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_customer_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  technician_payout NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  company_gross_margin NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  technician_payout_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  technician_payout_locked BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_payout_id TEXT REFERENCES weekly_payouts(id),
  service_fee_paid BOOLEAN NOT NULL DEFAULT FALSE,
  service_fee_paid_at TIMESTAMPTZ,
  quote_paid BOOLEAN NOT NULL DEFAULT FALSE,
  labor_paid_at TIMESTAMPTZ,
  materials_paid_at TIMESTAMPTZ,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  rating_comment TEXT,
  before_photo_note TEXT,
  after_photo_note TEXT,
  tech_on_the_way_at TIMESTAMPTZ,
  tech_arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  quote_rejected_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_orders_status ON service_orders(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_orders_tech ON service_orders(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_orders_provider ON service_orders(provider_org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_orders_requester ON service_orders(requester_org_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS service_order_items (
  id TEXT PRIMARY KEY,
  service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  supplier_unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  customer_unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  is_paid_to_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  payment_type TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_flow_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'failed', 'refunded')),
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  recurrence_frequency TEXT NOT NULL DEFAULT 'none',
  installment_group_id TEXT,
  installment_number INTEGER,
  total_installments INTEGER,
  receipt_path TEXT,
  receipt_name TEXT,
  receipt_mime TEXT,
  service_order_id TEXT REFERENCES service_orders(id) ON DELETE SET NULL,
  weekly_payout_id TEXT REFERENCES weekly_payouts(id) ON DELETE SET NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mileage_settings (
  id TEXT PRIMARY KEY,
  technician_id TEXT UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  rate_per_km NUMERIC(10,2) NOT NULL DEFAULT 0.40,
  office_address TEXT NOT NULL,
  office_lat DOUBLE PRECISION NOT NULL DEFAULT 38.6415,
  office_lng DOUBLE PRECISION NOT NULL DEFAULT -9.1558,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mileage_trips (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_order_id TEXT REFERENCES service_orders(id) ON DELETE SET NULL,
  trip_type TEXT NOT NULL,
  origin_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  distance_km NUMERIC(10,2) NOT NULL,
  duration_minutes INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT
);

CREATE TABLE IF NOT EXISTS order_messages (
  id TEXT PRIMARY KEY,
  service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES profiles(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warranty_return_visits (
  id TEXT PRIMARY KEY,
  service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  technician_id TEXT REFERENCES profiles(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  template TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_preview TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL REFERENCES service_catalog(id),
  plan_name TEXT NOT NULL,
  monthly_price NUMERIC(10,2) NOT NULL,
  service_address TEXT NOT NULL,
  preferred_day INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'active',
  next_billing_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_rate_settings (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2) NOT NULL DEFAULT 55.00,
  updated_by TEXT REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
