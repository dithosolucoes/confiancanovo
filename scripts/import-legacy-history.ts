/**
 * Idempotent Legacy History Importer — Confiança Repara
 * Imports historical work orders JSON/CSV into confianca.db while preserving:
 * - Berens parts markup x1.30 rule for orders before 15/06/2026
 * - Historical payout rule (fixed + 70% labor) for orders before 01/08/2026
 *
 * Usage:
 *   npx tsx scripts/import-legacy-history.ts [--file path/to/legacy-orders.json] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, initDatabase, recalculateOrderInDb } from '../server/db.ts';
import { PAYOUT_RULE_CUTOFF_ISO } from '../src/core/finance/calculator.ts';

const LEGACY_MARKUP_CUTOFF_ISO = '2026-06-15T00:00:00+01:00';

interface LegacyOrderRecord {
  reference_code: string;
  service_name: string;
  category?: string;
  description?: string;
  customer_name: string;
  customer_phone?: string;
  service_address: string;
  scheduled_at: string;
  completed_at?: string | null;
  created_at: string;
  status?: string;
  quote_status?: 'sent' | 'accepted' | 'rejected' | null;
  vat_rate?: 6 | 23;
  service_fee?: number;
  labor_cost?: number;
  extra_fee?: number;
  additional_cost?: number;
  fixed_payout_amount?: number;
  is_warranty?: boolean;
  requester_org_id?: string | null;
  provider_org_id?: string;
  technician_id?: string | null;
  items?: Array<{
    description: string;
    quantity?: number;
    customer_unit_price: number;
    supplier_unit_cost?: number;
  }>;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArgIdx = args.indexOf('--file');
const inputPath = fileArgIdx >= 0 ? args[fileArgIdx + 1] : null;

initDatabase();

const sampleLegacyRecords: LegacyOrderRecord[] = [
  {
    reference_code: 'WO-2026-0042',
    service_name: 'Reparação Máquina de Lavar Louça',
    category: 'Eletrodomésticos',
    description: 'Importado do histórico base: substituição de válvula aquastop (regra pré-15/06/2026).',
    customer_name: 'Imóvel Avenida Roma (Berens)',
    customer_phone: '+351 918 220 410',
    service_address: 'Av. de Roma, 58, Lisboa',
    scheduled_at: '2026-05-12T10:00:00.000Z',
    completed_at: '2026-05-12T12:30:00.000Z',
    created_at: '2026-05-12T09:00:00.000Z',
    status: 'completed',
    quote_status: 'accepted',
    vat_rate: 23,
    service_fee: 55,
    labor_cost: 80,
    extra_fee: 0,
    fixed_payout_amount: 35,
    requester_org_id: 'org-partner-berens',
    provider_org_id: 'org-matrix',
    technician_id: 'user-tech-joao',
    items: [
      {
        description: 'Válvula Aquastop Bosch Original',
        quantity: 1,
        customer_unit_price: 50,
        supplier_unit_cost: 32,
      },
    ],
  },
];

let records: LegacyOrderRecord[] = sampleLegacyRecords;
if (inputPath) {
  const abs = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(abs)) {
    console.error(`Ficheiro não encontrado: ${abs}`);
    process.exit(1);
  }
  records = JSON.parse(fs.readFileSync(abs, 'utf8'));
}

let inserted = 0;
let skipped = 0;

const tx = db.transaction(() => {
  for (const rec of records) {
    const exists = db
      .prepare('SELECT id FROM service_orders WHERE reference_code = ?')
      .get(rec.reference_code) as { id: string } | undefined;
    if (exists) {
      skipped += 1;
      continue;
    }

    const createdMs = new Date(rec.created_at).getTime();
    const isLegacyMarkup =
      Boolean(rec.requester_org_id) && createdMs < new Date(LEGACY_MARKUP_CUTOFF_ISO).getTime() ? 1 : 0;
    const isLegacyPayout = createdMs < new Date(PAYOUT_RULE_CUTOFF_ISO).getTime() ? 1 : 0;

    if (dryRun) {
      console.log(
        `[DRY-RUN] Importaria ${rec.reference_code} | legacy_markup=${isLegacyMarkup} | legacy_payout=${isLegacyPayout}`
      );
      inserted += 1;
      continue;
    }

    const orderId = `ord-leg-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO service_orders (
        id, reference_code, service_name, category, description,
        customer_name, customer_phone, requester_org_id, provider_org_id, technician_id,
        service_address, scheduled_at, completed_at, status, quote_status,
        is_warranty, legacy_parts_markup, legacy_payout_rule, fixed_payout_amount,
        vat_rate, service_fee, labor_cost, extra_fee, additional_cost,
        service_fee_paid, quote_paid, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `).run(
      orderId,
      rec.reference_code,
      rec.service_name,
      rec.category || 'Geral',
      rec.description || '',
      rec.customer_name,
      rec.customer_phone || null,
      rec.requester_org_id || null,
      rec.provider_org_id || 'org-matrix',
      rec.technician_id || null,
      rec.service_address,
      rec.scheduled_at,
      rec.completed_at || null,
      rec.status || 'completed',
      rec.quote_status ?? 'accepted',
      rec.is_warranty ? 1 : 0,
      isLegacyMarkup,
      isLegacyPayout,
      rec.fixed_payout_amount ?? 35,
      rec.vat_rate === 6 ? 6 : 23,
      rec.service_fee ?? 55,
      rec.labor_cost ?? 0,
      rec.extra_fee ?? 0,
      rec.additional_cost ?? 0,
      rec.created_at
    );

    for (const item of rec.items || []) {
      db.prepare(`
        INSERT INTO service_order_items (id, service_order_id, description, quantity, supplier_unit_cost, customer_unit_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `item-${crypto.randomUUID().slice(0, 8)}`,
        orderId,
        item.description,
        item.quantity ?? 1,
        item.supplier_unit_cost ?? 0,
        item.customer_unit_price
      );
    }

    recalculateOrderInDb(orderId);
    inserted += 1;
  }
});

tx();
console.log(
  `Importação concluída (${dryRun ? 'DRY-RUN' : 'LIVE'}): ${inserted} inseridos, ${skipped} já existentes ignorados.`
);
