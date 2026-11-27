export type UserRole =
  | 'super_admin'
  | 'company_admin'
  | 'partner_requester'
  | 'technician'
  | 'customer';

export type OrgType = 'matrix' | 'technical_center' | 'partner_client' | 'saas_company';

export type LanguageCode = 'pt' | 'en' | 'es';

export type ServiceStatus =
  | 'pending'
  | 'accepted'
  | 'on_the_way'
  | 'in_progress'
  | 'budgeting'
  | 'payment_pending'
  | 'completed'
  | 'cancelled';

export type QuoteStatus = 'sent' | 'accepted' | 'rejected' | null;

export type TripType = 'office_to_client' | 'client_to_client' | 'client_to_office';

export type CashFlowType = 'income' | 'expense';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'failed' | 'refunded';
export type RecurrenceFrequency =
  | 'none'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual';

export const PT_CASHFLOW_CATEGORIES: Array<{
  code: string;
  label: string;
  type: CashFlowType | 'both';
}> = [
  { code: 'salaries', label: 'Salários & Ordenados', type: 'expense' },
  { code: 'social_security', label: 'Segurança Social (TSU)', type: 'expense' },
  { code: 'fuel', label: 'Combustível & Frota', type: 'expense' },
  { code: 'tolls', label: 'Portagens (Via Verde)', type: 'expense' },
  { code: 'accounting', label: 'Contabilidade & TOC', type: 'expense' },
  { code: 'vehicles', label: 'Viaturas & Manutenção', type: 'expense' },
  { code: 'taxes', label: 'Impostos & IVA / IRC', type: 'expense' },
  { code: 'rent_facilities', label: 'Aluguer & Instalações', type: 'expense' },
  { code: 'telecom', label: 'Telecomunicações & Internet', type: 'expense' },
  { code: 'insurance', label: 'Seguros (AT / RC)', type: 'expense' },
  { code: 'tools_equipment', label: 'Ferramentas & Equipamento', type: 'expense' },
  { code: 'supplier_parts', label: 'Peças & Fornecedores', type: 'expense' },
  { code: 'tech_payout', label: 'Repasse Semanal Técnico', type: 'expense' },
  { code: 'mileage', label: 'Reembolso Quilometragem (€0,40/km)', type: 'expense' },
  { code: 'marketing', label: 'Marketing & Google Ads', type: 'expense' },
  { code: 'software_licenses', label: 'Software & Licenças SaaS', type: 'expense' },
  { code: 'training_certifications', label: 'Formação & Certificações', type: 'expense' },
  { code: 'other_expenses', label: 'Outras Despesas Operacionais', type: 'expense' },
  { code: 'fixed_expense', label: 'Despesa Fixa / Operacional', type: 'expense' },
  { code: 'service_revenue', label: 'Receita de Serviço (OS)', type: 'income' },
  { code: 'subscription_revenue', label: 'Receita de Subscrição Mensal', type: 'income' },
];

export const CASHFLOW_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PT_CASHFLOW_CATEGORIES.map((c) => [c.code, c.label])
);

export type PhotoPhase = 'before' | 'during' | 'after' | 'invoice';

export interface Organization {
  id: string;
  name: string;
  nif: string | null;
  org_type: OrgType;
  email: string | null;
  phone: string | null;
  address: string | null;
  custom_payout_percentage: number;
  is_active: boolean;
  created_at: string;
}

export interface UserProfile {
  id: string;
  organization_id: string | null;
  organization_name?: string | null;
  organization_type?: OrgType | null;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string | null;
  nif: string | null;
  iban: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  custom_payout_percentage: number | null;
  effective_payout_percentage?: number;
  is_active: boolean;
  is_paused?: boolean;
  mileage_enabled?: boolean;
  is_partner?: boolean;
  emergency_contact?: string | null;
  billing_name?: string | null;
  billing_nif?: string | null;
  billing_address?: string | null;
  orders_count?: number;
  total_spent?: number;
  avatar_url?: string | null;
  created_at: string;
}

export interface ServiceCatalogItem {
  id: string;
  category: string;
  name: string;
  description: string | null;
  base_service_fee: number;
  default_vat_rate: 6 | 23;
  is_subscription?: boolean;
  subscription_price?: number | null;
  warranty_months?: number;
  is_active: boolean;
}

export interface PayoutRateSetting {
  code: string;
  label: string;
  description: string;
  amount: number;
  updated_at: string;
  updated_by_name?: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  nif: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface ServiceOrderItem {
  id: string;
  service_order_id: string;
  supplier_id: string | null;
  supplier_name?: string | null;
  description: string;
  quantity: number;
  supplier_unit_cost?: number; // Omitted for technician / partner / customer
  customer_unit_price: number;
  is_paid_to_supplier?: boolean;
}

export interface OrderPhoto {
  id: string;
  service_order_id: string;
  uploaded_by: string;
  uploader_name?: string;
  phase: PhotoPhase;
  file_name: string;
  mime_type: string;
  caption: string | null;
  created_at: string;
}

export interface WarrantyReturnVisit {
  id: string;
  service_order_id: string;
  reference_code?: string;
  service_name?: string;
  service_address?: string;
  technician_id: string | null;
  technician_name?: string | null;
  scheduled_at: string;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  completed_at: string | null;
  created_at: string;
}

export interface OrderMessage {
  id: string;
  service_order_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: UserRole;
  message: string;
  created_at: string;
}

export interface ServiceOrder {
  id: string;
  reference_code: string;
  catalog_id: string | null;
  service_name: string;
  category: string;
  description: string;
  urgency: 'normal' | 'urgent';
  service_kind?: ServiceKind;
  customer_nif?: string | null;
  appliance_type?: string | null;
  toc_document_id?: string | null;

  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  requester_org_id: string | null;
  requester_org_name?: string | null;
  provider_org_id: string;
  provider_org_name?: string | null;
  technician_id: string | null;
  technician_name?: string | null;
  preferred_technician_id: string | null;

  service_address: string;
  address_complement?: string | null;
  postal_code?: string | null;
  localidade?: string | null;
  service_lat: number | null;
  service_lng: number | null;
  tech_lat?: number | null;
  tech_lng?: number | null;
  eta_minutes?: number | null;
  eta_distance_km?: number | null;
  eta_updated_at?: string | null;
  scheduled_at: string;
  google_calendar_event_id: string | null;

  status: ServiceStatus;
  quote_status: QuoteStatus;
  is_warranty: boolean;
  legacy_parts_markup: boolean;
  legacy_payout_rule?: boolean;
  fixed_payout_amount?: number;

  vat_rate: 6 | 23;
  service_fee: number;
  labor_cost: number;
  extra_fee: number;
  additional_cost: number;
  parts_customer_total: number;
  parts_supplier_total?: number; // Restricted to admin
  subtotal_without_vat: number;
  vat_amount: number;
  total_customer_amount: number;

  technician_payout?: number; // Restricted from partner_requester & customer
  company_gross_margin?: number; // Restricted to admin
  technician_payout_overridden: boolean;
  technician_payout_locked: boolean;
  weekly_payout_id: string | null;

  service_fee_paid: boolean;
  service_fee_paid_at?: string | null;
  quote_paid: boolean;
  labor_paid_at?: string | null;
  materials_paid_at?: string | null;
  invoice_number?: string | null;
  invoice_issued_at?: string | null;
  baixa_received_at?: string | null;
  report_text?: string | null;
  suggested_date?: string | null;
  suggested_time?: string | null;
  suggestion_status?: 'pending' | 'accepted' | 'rejected' | null;
  warranty_return_requested_at?: string | null;
  warranty_return_description?: string | null;
  rating: number | null;
  rating_comment: string | null;
  before_photo_note?: string | null;
  after_photo_note?: string | null;

  tech_on_the_way_at: string | null;
  tech_arrived_at: string | null;
  completed_at: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
  updated_at: string;

  items?: ServiceOrderItem[];
  messages?: OrderMessage[];
  photos?: OrderPhoto[];
  return_visits?: WarrantyReturnVisit[];
}

export type ServiceKind = 'avulso' | 'sequencia' | 'recorrente';

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  avulso: 'Avulso',
  sequencia: 'Em sequência',
  recorrente: 'Recorrente',
};

export interface WeeklyPayoutGroup {
  targetId: string;
  targetType: 'technician' | 'organization';
  targetName: string;
  targetEmail: string | null;
  nif: string | null;
  iban: string | null;
  ordersCount: number;
  totalAmount: number;
  /** Soma das ordens, antes do desconto/reembolso */
  ordersTotal?: number;
  adjustmentAmount?: number;
  adjustmentKind?: 'desconto' | 'reembolso' | null;
  adjustmentReason?: string | null;
  existingPayoutId: string | null;
  status: 'open' | 'pending' | 'paid';
  weekStart: string;
  weekEnd: string;
  dueDate: string;
  reportSentAt: string | null;
  paidAt: string | null;
  orders: Array<{
    id: string;
    reference_code: string;
    service_name: string;
    service_address: string;
    completed_at: string;
    technician_payout: number;
  }>;
}

export interface CashFlowEntry {
  id: string;
  entry_type: CashFlowType;
  category: string;
  description: string;
  amount: number;
  paid_amount: number;
  status: PaymentStatus;
  due_date: string;
  paid_at: string | null;
  recurrence_frequency: RecurrenceFrequency;
  installment_group_id: string | null;
  installment_number: number | null;
  total_installments: number | null;
  receipt_name: string | null;
  receipt_mime: string | null;
  is_overdue?: boolean;
  service_order_id: string | null;
  weekly_payout_id: string | null;
  supplier_id: string | null;
  created_at: string;
}

export interface MileageTrip {
  id: string;
  technician_id: string;
  technician_name?: string;
  service_order_id: string | null;
  reference_code?: string | null;
  trip_type: TripType;
  origin_address: string;
  destination_address: string;
  distance_km: number;
  duration_minutes: number | null;
  rate_per_km: number;
  reimbursement_amount: number;
  started_at: string;
  ended_at: string | null;
  manual_override: boolean;
  override_reason: string | null;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  channel: 'in_app' | 'email';
  is_read: boolean;
  created_at: string;
}

export interface EmailLog {
  id: string;
  recipient_user_id: string | null;
  recipient_email: string;
  template: string;
  subject: string;
  body_preview: string;
  provider: 'resend' | 'preview_log';
  provider_message_id: string | null;
  status: 'sent' | 'logged_preview' | 'failed';
  error_message: string | null;
  created_at: string;
}

export interface ServiceSubscription {
  id: string;
  customer_id: string;
  customer_name?: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  catalog_id: string;
  plan_name: string;
  monthly_price: number;
  service_address: string;
  preferred_day: number;
  status: 'active' | 'paused' | 'cancelled';
  next_billing_date: string;
  last_order_generated_at?: string | null;
  created_at: string;
}

export interface ChatThreadSummary {
  service_order_id: string;
  reference_code: string;
  service_name: string;
  status: ServiceStatus;
  customer_name: string;
  technician_name: string | null;
  message_count: number;
  last_message: string | null;
  last_sender_name: string | null;
  last_sender_role?: UserRole;
  last_message_at: string | null;
}

export interface ReconciliationItem {
  kind: 'order_payout_mismatch' | 'weekly_payout_total_mismatch' | 'cash_flow_mismatch';
  entityId: string;
  referenceCode: string;
  label: string;
  storedValue: number;
  expectedValue: number;
  difference: number;
}

export interface RatingRecord {
  id: string;
  reference_code: string;
  service_name: string;
  customer_name: string;
  technician_id: string | null;
  technician_name: string | null;
  rating: number;
  rating_comment: string | null;
  completed_at: string | null;
}
