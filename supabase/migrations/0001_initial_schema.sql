-- ============================================================================
-- PLATAFORMA CONFIANÇA REPARA — SCHEMA POSTGRESQL / SUPABASE COMPLETO
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM (
  'super_admin',
  'company_admin',
  'partner_requester',
  'technician',
  'customer'
);

CREATE TYPE org_type AS ENUM (
  'matrix',
  'technical_center',
  'partner_client',
  'saas_company'
);

CREATE TYPE service_status AS ENUM (
  'pending',
  'accepted',
  'on_the_way',
  'in_progress',
  'budgeting',
  'payment_pending',
  'completed',
  'cancelled'
);

CREATE TYPE quote_status AS ENUM ('sent', 'accepted', 'rejected');
CREATE TYPE trip_type AS ENUM ('office_to_client', 'client_to_client', 'client_to_office');
CREATE TYPE cash_flow_type AS ENUM ('income', 'expense');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  nif TEXT,
  org_type org_type NOT NULL DEFAULT 'partner_client',
  email TEXT,
  phone TEXT,
  address TEXT,
  custom_payout_percentage NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  role user_role NOT NULL DEFAULT 'customer',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  nif TEXT,
  iban TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  custom_payout_percentage NUMERIC(5,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, role, full_name, email, phone, nif, iban, address, organization_id
  )
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'customer'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'nif',
    NEW.raw_user_meta_data->>'iban',
    NEW.raw_user_meta_data->>'address',
    NULLIF(NEW.raw_user_meta_data->>'organization_id', '')::UUID
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE TABLE service_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_service_fee NUMERIC(10,2) NOT NULL DEFAULT 55.00,
  default_vat_rate NUMERIC(4,2) NOT NULL DEFAULT 23.00,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  nif TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE weekly_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  technician_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status payment_status NOT NULL DEFAULT 'pending',
  report_sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payout_target CHECK (technician_id IS NOT NULL OR organization_id IS NOT NULL)
);

CREATE TABLE service_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_code TEXT UNIQUE NOT NULL,
  catalog_id UUID REFERENCES service_catalog(id),
  customer_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  requester_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  provider_org_id UUID NOT NULL REFERENCES organizations(id),
  technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  preferred_technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  service_address TEXT NOT NULL,
  service_lat DOUBLE PRECISION,
  service_lng DOUBLE PRECISION,
  scheduled_at TIMESTAMPTZ NOT NULL,
  google_calendar_event_id TEXT,
  status service_status NOT NULL DEFAULT 'pending',
  quote_status quote_status,
  is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_parts_markup BOOLEAN NOT NULL DEFAULT FALSE,
  vat_rate NUMERIC(4,2) NOT NULL DEFAULT 23.00,
  service_fee NUMERIC(10,2) NOT NULL DEFAULT 55.00,
  labor_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  extra_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  additional_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  parts_customer_total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  parts_supplier_total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_customer_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  technician_payout NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  technician_payout_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  technician_payout_locked BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_payout_id UUID REFERENCES weekly_payouts(id) ON DELETE SET NULL,
  tech_on_the_way_at TIMESTAMPTZ,
  tech_arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  quote_rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE service_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  supplier_unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  customer_unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  is_paid_to_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  payment_type TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status payment_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cash_flow_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_type cash_flow_type NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  service_order_id UUID REFERENCES service_orders(id) ON DELETE SET NULL,
  weekly_payout_id UUID REFERENCES weekly_payouts(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mileage_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  technician_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  rate_per_km NUMERIC(6,2) NOT NULL DEFAULT 0.40,
  office_address TEXT NOT NULL DEFAULT 'Avenida Pinhal do Vidal, 30 R/C DRT, 2855-249 Corroios, Portugal',
  office_lat DOUBLE PRECISION NOT NULL DEFAULT 38.6415,
  office_lng DOUBLE PRECISION NOT NULL DEFAULT -9.1558,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mileage_trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  technician_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_order_id UUID REFERENCES service_orders(id) ON DELETE SET NULL,
  trip_type trip_type NOT NULL,
  origin_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  distance_km NUMERIC(8,2) NOT NULL,
  duration_minutes INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT
);
