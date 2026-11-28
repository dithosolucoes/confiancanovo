import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';
import { getWeeklyPayoutCycle } from '../../src/core/finance/weekly-cycle.ts';
import {
  LABOR_EXTRA_MAX_EUR,
  PART_UNIT_MAX_EUR,
  parseBoundedAmount,
  parseBoundedQuantity,
  resolvePartSalePrice,
} from '../../src/core/finance/calculator.ts';
import { getParamAt, toIsoUtc, warrantyModeFromValue } from '../params.ts';

// Orçamento, sugestão de horário, garantia, avaliação, GPS e ETA, calendário, agenda e visitas de retorno,
// movidos de server.ts sem alteração de comportamento. Três funções de registro, cada uma no ponto original:
// - registerOrcamentoRoutes: sugestão de horário, decisão da sugestão, garantia, orçamento e decisão do orçamento.
// - registerLocalizacaoCalendarioRoutes: avaliação, localização GPS, calendário (Google/.ics).
// - registerAgendaRoutes: agenda e visitas de retorno.
// Dependências de server.ts entram por ctx (funções de módulo de server.ts e recalculateOrderInDb de db.ts).

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

type Coords = { lat: number; lng: number };

export interface OrcamentoRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  canUserAccessOrder: (user: AuthUser, order: any) => boolean;
  projectOrderForRole: (order: any, role: UserRole) => any;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
  broadcastToOrder: (orderId: string, event: Record<string, unknown>) => void;
  sendTransactionalEmail: (params: {
    to: string;
    subject: string;
    html: string;
    template: string;
    recipientUserId?: string | null;
  }) => Promise<unknown>;
  recalculateOrderInDb: (orderId: string) => any;
  notifyTechnicianOfValueChange: (order: any, changes: string[], actorId: string) => void;
  computeRouteDistance: (
    origin: string,
    destination: string,
    originCoords?: Coords | null,
    destCoords?: Coords | null
  ) => Promise<{ distanceKm: number; durationMinutes: number }>;
  findPortugalAddressCoords: (addr: string) => Coords;
  nextReferenceCode: (prefix: string) => string;
  referencePrefixFor: (serviceKind: string) => string;
}

export function registerOrcamentoRoutes(app: express.Express, ctx: OrcamentoRouteContext) {
  const { db, requireAuth, canUserAccessOrder, projectOrderForRole, createNotification, broadcastToOrder, sendTransactionalEmail, recalculateOrderInDb, notifyTechnicianOfValueChange, nextReferenceCode, referencePrefixFor } = ctx;

  // C-11: colunas pending_labor_cost / pending_extra_fee são criadas na migração do db.ts.
  // Valor pendente fica fora de labor_cost/extra_fee até o gestor aprovar, por isso não entra no repasse.
  const soColumns = new Set(
    (db.prepare('PRAGMA table_info(service_orders)').all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!soColumns.has('labor_extra_pending_at')) db.exec('ALTER TABLE service_orders ADD COLUMN labor_extra_pending_at TEXT');

  // Schedule Suggestion (Technician/Admin suggests date & time -> Customer/Partner/Admin approves or rejects)
  app.post('/api/orders/:id/suggest-schedule', requireAuth(['technician', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { suggested_date, suggested_time } = req.body ?? {};
    if (!suggested_date || !suggested_time) {
      return res.status(400).json({ error: 'Data e hora sugeridas são obrigatórias.' });
    }

    db.prepare(`
      UPDATE service_orders SET
        suggested_date = ?,
        suggested_time = ?,
        suggestion_status = 'pending',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(String(suggested_date).trim(), String(suggested_time).trim(), existing.id);

    if (existing.customer_id) {
      createNotification(
        existing.customer_id,
        `Sugestão de Horário (${existing.reference_code})`,
        `O técnico sugeriu reagendar para ${suggested_date} às ${suggested_time}.`,
        'in_app'
      );
    }

    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id);
    broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
    res.json({ order: projectOrderForRole(updated, user.role) });
  });

  app.post('/api/orders/:id/suggestion-decision', requireAuth(['customer', 'partner_requester', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { decision } = req.body ?? {};
    if (decision !== 'accepted' && decision !== 'rejected') {
      return res.status(400).json({ error: 'Decisão inválida.' });
    }
    if (!existing.suggested_date || !existing.suggested_time) {
      return res.status(400).json({ error: 'Não existe sugestão de horário pendente.' });
    }

    let nextScheduled = existing.scheduled_at;
    if (decision === 'accepted') {
      const isoAttempt = new Date(`${existing.suggested_date}T${existing.suggested_time}:00`);
      if (!Number.isNaN(isoAttempt.getTime())) {
        nextScheduled = isoAttempt.toISOString();
      }
    }

    db.prepare(`
      UPDATE service_orders SET
        suggestion_status = ?,
        scheduled_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(decision, nextScheduled, existing.id);

    if (existing.technician_id) {
      createNotification(
        existing.technician_id,
        `Sugestão de horário ${decision === 'accepted' ? 'aceite' : 'recusada'} (${existing.reference_code})`,
        decision === 'accepted'
          ? `Novo horário confirmado: ${existing.suggested_date} às ${existing.suggested_time}.`
          : `O cliente não aceitou a sugestão de horário (${existing.suggested_date} às ${existing.suggested_time}).`,
        'in_app'
      );
    }

    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id);
    broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
    res.json({ order: projectOrderForRole(updated, user.role) });
  });

  // Customer/Partner requests warranty return on completed order
  app.post('/api/orders/:id/warranty-request', requireAuth(['customer', 'partner_requester']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });
    if (existing.status !== 'completed') {
      return res.status(400).json({ error: 'Só é possível acionar garantia após conclusão do serviço.' });
    }

    // Prazo de garantia (warranty_days vigente na data do pedido), contado da conclusão da OS original
    const warrantyDays = getParamAt(db, 'warranty_days');
    const concludedAt = new Date(toIsoUtc(existing.completed_at || existing.updated_at));
    const warrantyEndsAt = new Date(concludedAt.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
    if (Date.now() > warrantyEndsAt.getTime()) {
      return res.status(400).json({
        error: `Prazo de garantia de ${warrantyDays} dias expirado em ${warrantyEndsAt.toLocaleDateString('pt-PT')}. Não é possível acionar garantia.`,
      });
    }

    const { description, preferred_date } = req.body ?? {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'Descreva o motivo do retorno em garantia.' });
    }

    // Cria OS de garantia nova (is_warranty = 1) ligada à original. A OS original não é alterada.
    // Cliente, endereço e serviço são copiados; taxa zerada se o modo vigente for 'none'; M.O. é zerada no orçamento.
    const warrantyMode = warrantyModeFromValue(getParamAt(db, 'warranty_mode'));
    const warrantyDescription = String(description).trim();
    const prefDate = preferred_date ? new Date(preferred_date) : null;
    const hasPrefDate = Boolean(prefDate && !Number.isNaN(prefDate.getTime()));
    const newId = `ord-${crypto.randomUUID().slice(0, 8)}`;
    const newReference = nextReferenceCode(referencePrefixFor('avulso'));
    const newFee = warrantyMode === 'none' ? 0 : Number(existing.service_fee);

    db.prepare(`
      INSERT INTO service_orders (
        id, reference_code, catalog_id, service_name, category, description, urgency,
        customer_id, customer_name, customer_phone, requester_org_id, provider_org_id,
        service_address, address_complement, postal_code, localidade,
        scheduled_at, status, is_warranty, warranty_mode, warranty_of_order_id,
        vat_rate, service_fee, service_kind, customer_nif, appliance_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, 'avulso', ?, ?)
    `).run(
      newId,
      newReference,
      existing.catalog_id || null,
      existing.service_name,
      existing.category,
      warrantyDescription,
      existing.urgency || 'normal',
      existing.customer_id || null,
      existing.customer_name,
      existing.customer_phone || null,
      existing.requester_org_id || null,
      existing.provider_org_id,
      existing.service_address,
      existing.address_complement || null,
      existing.postal_code || null,
      existing.localidade || null,
      hasPrefDate ? prefDate!.toISOString() : new Date().toISOString(),
      warrantyMode,
      existing.id,
      existing.vat_rate,
      newFee,
      existing.customer_nif || null,
      existing.appliance_type || null
    );

    if (hasPrefDate) {
      db.prepare(`
        INSERT INTO warranty_return_visits (id, service_order_id, technician_id, scheduled_at, notes, status)
        VALUES (?, ?, ?, ?, ?, 'scheduled')
      `).run(
        `ret-${crypto.randomUUID().slice(0, 8)}`,
        newId,
        null,
        prefDate!.toISOString(),
        `Solicitado pelo cliente: ${warrantyDescription}`
      );
    }

    if (existing.technician_id) {
      createNotification(
        existing.technician_id,
        `Garantia solicitada (${newReference})`,
        `OS original ${existing.reference_code}: ${warrantyDescription}`,
        'in_app'
      );
    }
    const admins = db.prepare("SELECT id FROM profiles WHERE role = 'super_admin' AND is_active = 1").all() as Array<{ id: string }>;
    for (const adm of admins) {
      createNotification(
        adm.id,
        `Pedido de Retorno em Garantia (${newReference})`,
        `${existing.customer_name} (OS original ${existing.reference_code}): ${warrantyDescription}`,
        'in_app'
      );
    }

    const created = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(newId);
    broadcastToOrder(newId, { type: 'order:updated', orderId: newId });
    res.json({ order: projectOrderForRole(created, user.role), warranty_order_id: newId, reference_code: newReference });
  });

  // Launch or update Quote + Parts (used by Admin or Technician)
  app.post('/api/orders/:id/quote', requireAuth(['super_admin', 'company_admin', 'technician']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { labor_cost, extra_fee, additional_cost, vat_rate, items, send_to_customer } = req.body ?? {};
    const isGestor = user.role !== 'technician';

    // C-11: M.O. e taxa extra validadas no servidor (não negativas, até LABOR_EXTRA_MAX_EUR)
    let laborValue: number | undefined;
    let extraValue: number | undefined;
    if (labor_cost !== undefined) {
      const r = parseBoundedAmount(labor_cost, LABOR_EXTRA_MAX_EUR, 'Mão de obra');
      if (!r.ok) return res.status(400).json({ error: r.error });
      laborValue = r.value;
    }
    if (extra_fee !== undefined) {
      const r = parseBoundedAmount(extra_fee, LABOR_EXTRA_MAX_EUR, 'Taxa extra');
      if (!r.ok) return res.status(400).json({ error: r.error });
      extraValue = r.value;
    }

    // Garantia: modo gravado na criação da OS. 'none' e 'fee_only' não cobram M.O. do cliente
    if (existing.is_warranty && existing.warranty_mode && existing.warranty_mode !== 'as_today') laborValue = 0;

    // C-12 e quantidade de peça: validados e precificados no servidor antes de gravar
    type ValidItem = { supplier_id: string | null; description: string; quantity: number; cost: number; price: number };
    const validItems: ValidItem[] = [];
    if (Array.isArray(items)) {
      // Técnico não recebe custo do fornecedor: preserva o custo já gravado pela gestão (por descrição)
      const knownCost = new Map<string, number>();
      if (!isGestor) {
        const rows = db
          .prepare('SELECT description, supplier_unit_cost FROM service_order_items WHERE service_order_id = ?')
          .all(existing.id) as Array<{ description: string; supplier_unit_cost: number }>;
        for (const r of rows) knownCost.set(String(r.description).trim(), Number(r.supplier_unit_cost) || 0);
      }
      const markupPct = getParamAt(db, 'parts_markup_pct');

      for (const item of items) {
        if (!item?.description) continue;
        const description = String(item.description).trim();

        const qty = item.quantity === undefined || item.quantity === null
          ? { ok: true as const, value: 1 }
          : parseBoundedQuantity(item.quantity, `Peça "${description}"`);
        if (!qty.ok) return res.status(400).json({ error: qty.error });

        let cost: number;
        if (isGestor) {
          const c = parseBoundedAmount(item.supplier_unit_cost ?? 0, PART_UNIT_MAX_EUR, `Custo da peça "${description}"`);
          if (!c.ok) return res.status(400).json({ error: c.error });
          cost = c.value;
        } else {
          cost = knownCost.get(description) ?? 0;
        }

        let requested: number | null = null;
        if (item.customer_unit_price !== undefined && item.customer_unit_price !== null && item.customer_unit_price !== '') {
          const p = parseBoundedAmount(item.customer_unit_price, PART_UNIT_MAX_EUR, `Preço da peça "${description}"`);
          if (!p.ok) return res.status(400).json({ error: p.error });
          requested = p.value;
        }

        const price = resolvePartSalePrice({ supplierUnitCost: cost, requestedPrice: requested, markupPct });
        if (!price.ok) return res.status(400).json({ error: price.error });

        validItems.push({
          supplier_id: item.supplier_id || null,
          description,
          quantity: qty.value,
          cost,
          price: price.value,
        });
      }
    }

    // Valores antes da alteração (para avisar o técnico só do que mudou)
    const partsTotalsOf = (orderId: string) => {
      const rows = db
        .prepare('SELECT quantity, supplier_unit_cost, customer_unit_price FROM service_order_items WHERE service_order_id = ?')
        .all(orderId) as any[];
      return {
        sale: rows.reduce((s, i) => s + Number(i.quantity) * Number(i.customer_unit_price), 0),
        cost: rows.reduce((s, i) => s + Number(i.quantity) * Number(i.supplier_unit_cost), 0),
      };
    };
    const partsBefore = partsTotalsOf(existing.id);
    const laborBefore = Number(existing.labor_cost || 0);
    const extraBefore = Number(existing.extra_fee || 0);

    const tx = db.transaction(() => {
      // Gestão lança direto; técnico só cria pendência para aprovação do gestor (C-11)
      if (laborValue !== undefined || extraValue !== undefined) {
        if (isGestor) {
          if (laborValue !== undefined) {
            db.prepare('UPDATE service_orders SET labor_cost = ?, pending_labor_cost = NULL WHERE id = ?').run(laborValue, existing.id);
          }
          if (extraValue !== undefined) {
            db.prepare('UPDATE service_orders SET extra_fee = ?, pending_extra_fee = NULL WHERE id = ?').run(extraValue, existing.id);
          }
          db.prepare(`
            UPDATE service_orders SET labor_extra_pending_at = CASE
              WHEN pending_labor_cost IS NULL AND pending_extra_fee IS NULL THEN NULL
              ELSE labor_extra_pending_at END
            WHERE id = ?
          `).run(existing.id);
        } else {
          db.prepare(`
            UPDATE service_orders SET
              pending_labor_cost = COALESCE(?, pending_labor_cost),
              pending_extra_fee = COALESCE(?, pending_extra_fee),
              labor_extra_pending_at = datetime('now'),
              updated_at = datetime('now')
            WHERE id = ?
          `).run(laborValue ?? null, extraValue ?? null, existing.id);
        }
      }

      db.prepare(`
        UPDATE service_orders SET
          additional_cost = COALESCE(?, additional_cost),
          vat_rate = COALESCE(?, vat_rate),
          quote_status = CASE WHEN ? THEN 'sent' ELSE quote_status END,
          quote_sent_at = CASE WHEN ? THEN COALESCE(quote_sent_at, datetime('now')) ELSE quote_sent_at END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        additional_cost !== undefined ? Number(additional_cost) : null,
        vat_rate !== undefined && user.role === 'super_admin'
          ? Number(vat_rate) === 6
            ? 6
            : 23
          : null,
        send_to_customer ? 1 : 0,
        send_to_customer ? 1 : 0,
        existing.id
      );

      if (Array.isArray(items)) {
        db.prepare('DELETE FROM service_order_items WHERE service_order_id = ?').run(existing.id);
        const insItem = db.prepare(`
          INSERT INTO service_order_items (id, service_order_id, supplier_id, description, quantity, supplier_unit_cost, customer_unit_price, is_paid_to_supplier)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `);
        for (const item of validItems) {
          insItem.run(
            `item-${crypto.randomUUID().slice(0, 8)}`,
            existing.id,
            item.supplier_id,
            item.description,
            item.quantity,
            item.cost,
            item.price
          );
        }
      }
    });

    tx();
    const updated = recalculateOrderInDb(existing.id) as any;

    // C-11: técnico lançou valores pendentes -> avisa a gestão
    if (!isGestor && (laborValue !== undefined || extraValue !== undefined)) {
      const admins = db.prepare("SELECT id FROM profiles WHERE role = 'super_admin' AND is_active = 1").all() as Array<{ id: string }>;
      for (const adm of admins) {
        createNotification(
          adm.id,
          `M.O./taxa extra a aprovar (${existing.reference_code})`,
          `Técnico lançou: M.O. € ${Number(updated.pending_labor_cost ?? 0).toFixed(2)}, taxa extra € ${Number(updated.pending_extra_fee ?? 0).toFixed(2)}. Só entra no repasse após aprovação.`,
          'in_app'
        );
      }
    }

    // Aviso ao técnico responsável quando o custo muda (quem alterou não recebe o aviso)
    const partsAfter = partsTotalsOf(existing.id);
    const laborAfter = Number(updated.labor_cost || 0);
    const extraAfter = Number(updated.extra_fee || 0);
    const changes: string[] = [];
    if (Math.abs(laborAfter - laborBefore) > 0.009) {
      changes.push(`Mão de obra: € ${laborBefore.toFixed(2)} → € ${laborAfter.toFixed(2)}`);
    }
    if (Math.abs(extraAfter - extraBefore) > 0.009) {
      changes.push(`Taxa extra: € ${extraBefore.toFixed(2)} → € ${extraAfter.toFixed(2)}`);
    }
    if (Math.abs(partsAfter.sale - partsBefore.sale) > 0.009) {
      changes.push(`Peças (valor ao cliente): € ${partsBefore.sale.toFixed(2)} → € ${partsAfter.sale.toFixed(2)}`);
    }
    if (Math.abs(partsAfter.cost - partsBefore.cost) > 0.009) {
      changes.push('Custo das peças atualizado pela gestão');
    }
    if (changes.length) {
      notifyTechnicianOfValueChange(existing, changes, user.id);
    }

    if (send_to_customer && existing.customer_id) {
      createNotification(
        existing.customer_id,
        `Orçamento enviado (${existing.reference_code})`,
        `Total com IVA (${updated.vat_rate}%): € ${Number(updated.total_customer_amount).toFixed(2)}.`,
        'email'
      );
      const cust = db.prepare('SELECT email, full_name FROM profiles WHERE id = ?').get(existing.customer_id) as any;
      if (cust?.email) {
        void sendTransactionalEmail({
          to: cust.email,
          recipientUserId: existing.customer_id,
          template: 'quote_sent',
          subject: `Orçamento disponível — ${existing.reference_code}`,
          html: `<p>Olá ${cust.full_name},</p><p>O orçamento da ordem <strong>${existing.reference_code}</strong> (${existing.service_name}) encontra-se pronto para aprovação.</p><p><strong>Total c/ IVA (${updated.vat_rate}%):</strong> € ${Number(updated.total_customer_amount).toFixed(2)}</p>`,
        });
      }
    }

    broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
    res.json({ order: projectOrderForRole(updated, user.role) });
  });

  // Customer or Partner approves/rejects quote (never mutates operational status automatically!)
  app.post('/api/orders/:id/quote-decision', requireAuth(['customer', 'partner_requester', 'super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { decision } = req.body ?? {};
    if (decision !== 'accepted' && decision !== 'rejected') {
      return res.status(400).json({ error: 'Decisão inválida.' });
    }

    db.prepare(`
      UPDATE service_orders SET
        quote_status = ?,
        quote_rejected_at = CASE WHEN ? = 'rejected' THEN datetime('now') ELSE NULL END,
        quote_decided_at = CASE WHEN ? IN ('accepted', 'rejected') THEN datetime('now') ELSE quote_decided_at END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(decision, decision, decision, existing.id);

    const updated = recalculateOrderInDb(existing.id) as any;

    // If accepted and has supplier cost items, ensure supplier cash flow forecast entries exist
    if (decision === 'accepted') {
      const items = db
        .prepare('SELECT * FROM service_order_items WHERE service_order_id = ? AND supplier_unit_cost > 0')
        .all(existing.id) as any[];
      const cycle = getWeeklyPayoutCycle();
      for (const item of items) {
        const cfExists = db
          .prepare('SELECT id FROM cash_flow_entries WHERE service_order_id = ? AND category = ? AND description LIKE ?')
          .get(existing.id, 'supplier_parts', `%${item.description}%`);
        if (!cfExists) {
          db.prepare(`
            INSERT INTO cash_flow_entries (id, entry_type, category, description, amount, status, due_date, service_order_id, supplier_id, created_by)
            VALUES (?, 'expense', 'supplier_parts', ?, ?, 'pending', ?, ?, ?, ?)
          `).run(
            `cf-${crypto.randomUUID().slice(0, 8)}`,
            `Peça: ${item.description} (${existing.reference_code})`,
            Number(item.quantity) * Number(item.supplier_unit_cost),
            cycle.dueDate,
            existing.id,
            item.supplier_id || null,
            user.id
          );
        }
      }
    }

    if (existing.technician_id) {
      createNotification(
        existing.technician_id,
        `Orçamento ${decision === 'accepted' ? 'Aprovado' : 'Recusado'} (${existing.reference_code})`,
        decision === 'accepted'
          ? `O cliente aprovou o orçamento. Repasse atualizado: € ${Number(updated.technician_payout).toFixed(2)}.`
          : `O cliente recusou o orçamento. Repasse ajustado para taxa de serviço: € ${Number(updated.technician_payout).toFixed(2)}.`,
        'in_app'
      );
      const tech = db.prepare('SELECT email, full_name FROM profiles WHERE id = ?').get(existing.technician_id) as any;
      if (tech?.email) {
        void sendTransactionalEmail({
          to: tech.email,
          recipientUserId: existing.technician_id,
          template: decision === 'accepted' ? 'quote_accepted' : 'quote_rejected',
          subject: `Orçamento ${decision === 'accepted' ? 'Aprovado' : 'Recusado'} — ${existing.reference_code}`,
          html: `<p>Olá ${tech.full_name},</p><p>O orçamento da ordem <strong>${existing.reference_code}</strong> foi <strong>${decision === 'accepted' ? 'aprovado' : 'recusado'}</strong> pelo cliente.</p>`,
        });
      }
    }

    broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
    res.json({ order: projectOrderForRole(updated, user.role) });
  });

  // C-11: gestor aprova ou recusa M.O./taxa extra lançadas pelo técnico.
  // Só o valor aprovado passa a labor_cost/extra_fee, que é a base do repasse.
  app.post('/api/orders/:id/labor-extra-decision', requireAuth(['super_admin', 'company_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { decision } = req.body ?? {};
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: 'Decisão inválida.' });
    }
    if (existing.pending_labor_cost == null && existing.pending_extra_fee == null) {
      return res.status(400).json({ error: 'Não há M.O. ou taxa extra pendentes de aprovação.' });
    }

    db.transaction(() => {
      if (decision === 'approved') {
        db.prepare(`
          UPDATE service_orders SET
            labor_cost = COALESCE(pending_labor_cost, labor_cost),
            extra_fee = COALESCE(pending_extra_fee, extra_fee),
            pending_labor_cost = NULL,
            pending_extra_fee = NULL,
            labor_extra_pending_at = NULL,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(existing.id);
      } else {
        db.prepare(`
          UPDATE service_orders SET
            pending_labor_cost = NULL,
            pending_extra_fee = NULL,
            labor_extra_pending_at = NULL,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(existing.id);
      }
    })();

    const updated = recalculateOrderInDb(existing.id) as any;

    if (existing.technician_id) {
      createNotification(
        existing.technician_id,
        `M.O./taxa extra ${decision === 'approved' ? 'aprovadas' : 'recusadas'} (${existing.reference_code})`,
        decision === 'approved'
          ? `M.O. € ${Number(updated.labor_cost).toFixed(2)}, taxa extra € ${Number(updated.extra_fee).toFixed(2)}. Repasse atualizado: € ${Number(updated.technician_payout).toFixed(2)}.`
          : 'A gestão recusou a M.O./taxa extra lançadas. Não entram no repasse.',
        'in_app'
      );
    }

    broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
    res.json({ order: projectOrderForRole(updated, user.role) });
  });
}

export function registerLocalizacaoCalendarioRoutes(app: express.Express, ctx: OrcamentoRouteContext) {
  const { db, requireAuth, canUserAccessOrder, projectOrderForRole, broadcastToOrder, computeRouteDistance, findPortugalAddressCoords } = ctx;

  // Customer Rating
  app.post('/api/orders/:id/rate', requireAuth(['customer', 'partner_requester']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { rating, comment } = req.body ?? {};
    const numRating = Math.min(5, Math.max(1, Math.round(Number(rating))));
    db.prepare(`
      UPDATE service_orders SET rating = ?, rating_comment = ?, updated_at = datetime('now') WHERE id = ?
    `).run(numRating, comment?.trim() || null, existing.id);
    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id);
    res.json({ order: projectOrderForRole(updated, user.role) });
  });

  // Real-time GPS Location & ETA Update
  app.post('/api/orders/:id/location', requireAuth(['technician', 'super_admin']), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { lat, lng } = req.body ?? {};
    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
      return res.status(400).json({ error: 'Coordenadas GPS inválidas.' });
    }

    const destCoords =
      existing.service_lat && existing.service_lng
        ? { lat: Number(existing.service_lat), lng: Number(existing.service_lng) }
        : findPortugalAddressCoords(existing.service_address);

    const route = await computeRouteDistance(
      `${numLat},${numLng}`,
      existing.service_address,
      { lat: numLat, lng: numLng },
      destCoords
    );

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE service_orders SET
        tech_lat = ?,
        tech_lng = ?,
        service_lat = COALESCE(service_lat, ?),
        service_lng = COALESCE(service_lng, ?),
        eta_distance_km = ?,
        eta_minutes = ?,
        eta_updated_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(numLat, numLng, destCoords.lat, destCoords.lng, route.distanceKm, route.durationMinutes, nowIso, existing.id);

    broadcastToOrder(existing.id, {
      type: 'order:updated',
      orderId: existing.id,
      eta_minutes: route.durationMinutes,
      eta_distance_km: route.distanceKm,
    });

    res.json({
      ok: true,
      eta_minutes: route.durationMinutes,
      eta_distance_km: route.distanceKm,
      eta_updated_at: nowIso,
    });
  });

  // Google Calendar Sync (supports real Google Calendar v3 OAuth Bearer token + .ics + deep link)
  app.post('/api/orders/:id/google-calendar', requireAuth(['super_admin', 'company_admin', 'technician']), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const start = new Date(existing.scheduled_at);
    const end = new Date(start.getTime() + 90 * 60000);
    const googleToken = req.headers['x-google-access-token'];

    let eventId = existing.google_calendar_event_id || `gcal_${crypto.randomUUID().slice(0, 10)}`;
    let syncedVia: 'google_api' | 'ics_template' = 'ics_template';

    if (typeof googleToken === 'string' && googleToken.trim().length > 10) {
      try {
        const isUpdate = Boolean(existing.google_calendar_event_id && !existing.google_calendar_event_id.startsWith('gcal_'));
        const endpoint = isUpdate
          ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existing.google_calendar_event_id)}`
          : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
        const gcalResp = await fetch(endpoint, {
          method: isUpdate ? 'PATCH' : 'POST',
          headers: {
            Authorization: `Bearer ${googleToken.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: `${existing.reference_code} — ${existing.service_name}`,
            location: existing.service_address,
            description: `Cliente: ${existing.customer_name} (${existing.customer_phone || '—'})\n${existing.description || ''}`,
            start: { dateTime: start.toISOString(), timeZone: 'Europe/Lisbon' },
            end: { dateTime: end.toISOString(), timeZone: 'Europe/Lisbon' },
          }),
        });
        if (gcalResp.ok) {
          const gData: any = await gcalResp.json();
          if (gData.id) {
            eventId = gData.id;
            syncedVia = 'google_api';
          }
        }
      } catch {
        // Fallback to ICS template
      }
    }

    db.prepare('UPDATE service_orders SET google_calendar_event_id = ? WHERE id = ?').run(eventId, existing.id);

    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      `${existing.reference_code} — ${existing.service_name}`
    )}&dates=${fmt(start)}/${fmt(end)}&location=${encodeURIComponent(
      existing.service_address
    )}&details=${encodeURIComponent(existing.description || '')}`;

    res.json({
      eventId,
      syncedVia,
      calendarUrl,
      icsUrl: `/api/orders/${existing.id}/calendar.ics`,
    });
  });

  app.get('/api/orders/:id/calendar.ics', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const start = new Date(existing.scheduled_at);
    const end = new Date(start.getTime() + 90 * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Confianca Repara//Agenda PT//PT',
      'BEGIN:VEVENT',
      `UID:${existing.id}@confiancamanutencao.com`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${existing.reference_code} — ${existing.service_name}`,
      `LOCATION:${existing.service_address}`,
      `DESCRIPTION:${(existing.description || '').replace(/\r?\n/g, ' ')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${existing.reference_code}.ics"`);
    res.send(ics);
  });
}

export function registerAgendaRoutes(app: express.Express, ctx: OrcamentoRouteContext) {
  const { db, requireAuth, canUserAccessOrder, createNotification } = ctx;

  app.get('/api/agenda', requireAuth(['super_admin', 'company_admin', 'technician']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { technicianId } = req.query as Record<string, string>;

    let orderWhere = 'so.deleted_at IS NULL';
    const orderParams: any[] = [];
    if (user.role === 'company_admin') {
      orderWhere += ' AND so.provider_org_id = ?';
      orderParams.push(user.organization_id);
    } else if (user.role === 'technician') {
      orderWhere += ' AND so.technician_id = ?';
      orderParams.push(user.id);
    } else if (technicianId && technicianId !== 'all') {
      orderWhere += ' AND so.technician_id = ?';
      orderParams.push(technicianId);
    }

    const orders = db
      .prepare(`
        SELECT so.id, so.reference_code, so.service_name, so.service_address, so.scheduled_at, so.status,
               so.is_warranty, so.technician_id, t.full_name as technician_name, so.customer_name
        FROM service_orders so
        LEFT JOIN profiles t ON t.id = so.technician_id
        WHERE ${orderWhere}
        ORDER BY so.scheduled_at ASC
      `)
      .all(...orderParams)
      .map((o: any) => ({ ...o, is_warranty: Boolean(o.is_warranty) }));

    let rvWhere = 'so.deleted_at IS NULL';
    const rvParams: any[] = [];
    if (user.role === 'company_admin') {
      rvWhere += ' AND so.provider_org_id = ?';
      rvParams.push(user.organization_id);
    } else if (user.role === 'technician') {
      rvWhere += ' AND COALESCE(rv.technician_id, so.technician_id) = ?';
      rvParams.push(user.id);
    } else if (technicianId && technicianId !== 'all') {
      rvWhere += ' AND COALESCE(rv.technician_id, so.technician_id) = ?';
      rvParams.push(technicianId);
    }

    const returnVisits = db
      .prepare(`
        SELECT rv.*, so.reference_code, so.service_name, so.service_address, t.full_name as technician_name
        FROM warranty_return_visits rv
        JOIN service_orders so ON so.id = rv.service_order_id
        LEFT JOIN profiles t ON t.id = COALESCE(rv.technician_id, so.technician_id)
        WHERE ${rvWhere}
        ORDER BY rv.scheduled_at ASC
      `)
      .all(...rvParams);

    res.json({ orders, returnVisits });
  });

  app.post('/api/orders/:id/return-visits', requireAuth(['super_admin', 'company_admin', 'technician']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, order)) return res.status(403).json({ error: 'Sem permissão.' });

    const { scheduled_at, notes, technician_id } = req.body ?? {};
    if (!scheduled_at) return res.status(400).json({ error: 'Data/hora do retorno obrigatória.' });

    const id = `ret-${crypto.randomUUID().slice(0, 8)}`;
    const techId = technician_id || order.technician_id || null;
    db.prepare(`
      INSERT INTO warranty_return_visits (id, service_order_id, technician_id, scheduled_at, notes, status)
      VALUES (?, ?, ?, ?, ?, 'scheduled')
    `).run(id, order.id, techId, new Date(scheduled_at).toISOString(), notes?.trim() || null);

    if (techId) {
      createNotification(
        techId,
        `Visita de Retorno Agendada (${order.reference_code})`,
        `Agendada para ${new Date(scheduled_at).toLocaleString('pt-PT')}.`,
        'in_app'
      );
    }

    const created = db
      .prepare(`
        SELECT rv.*, t.full_name as technician_name
        FROM warranty_return_visits rv
        LEFT JOIN profiles t ON t.id = rv.technician_id
        WHERE rv.id = ?
      `)
      .get(id);
    res.status(201).json({ visit: created });
  });

  app.patch('/api/return-visits/:visitId', requireAuth(['super_admin', 'company_admin', 'technician', 'customer', 'partner_requester']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const visit = db
      .prepare(`
        SELECT rv.*, so.provider_org_id, so.requester_org_id, so.customer_id, so.technician_id as order_tech_id, so.reference_code
        FROM warranty_return_visits rv
        JOIN service_orders so ON so.id = rv.service_order_id
        WHERE rv.id = ?
      `)
      .get(req.params.visitId) as any;
    if (!visit) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (user.role === 'company_admin' && visit.provider_org_id !== user.organization_id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    if (user.role === 'technician' && visit.technician_id !== user.id && visit.order_tech_id !== user.id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    if (user.role === 'customer' && visit.customer_id !== user.id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    if (user.role === 'partner_requester' && visit.requester_org_id !== user.organization_id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    const { status, notes, scheduled_at } = req.body ?? {};

    if (user.role === 'customer' || user.role === 'partner_requester') {
      if (!scheduled_at) {
        return res.status(400).json({ error: 'Informe a nova data e hora para reagendar.' });
      }
      const existingTime = new Date(visit.scheduled_at).getTime();
      if (existingTime - Date.now() <= 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: 'O reagendamento pelo cliente só é permitido com mais de 24 horas de antecedência.',
        });
      }
      const nextDt = new Date(scheduled_at);
      if (Number.isNaN(nextDt.getTime())) {
        return res.status(400).json({ error: 'Data/hora inválida.' });
      }
      db.prepare(`UPDATE warranty_return_visits SET scheduled_at = ?, notes = COALESCE(?, notes) WHERE id = ?`).run(
        nextDt.toISOString(),
        notes ?? null,
        visit.id
      );
      if (visit.technician_id || visit.order_tech_id) {
        createNotification(
          visit.technician_id || visit.order_tech_id,
          `Retorno Reagendado (${visit.reference_code})`,
          `Cliente reagendou visita para ${nextDt.toLocaleString('pt-PT')}.`,
          'in_app'
        );
      }
      return res.json({ ok: true });
    }

    const validStatus = ['scheduled', 'completed', 'cancelled'];
    const nextStatus = validStatus.includes(status) ? status : visit.status;

    db.prepare(`
      UPDATE warranty_return_visits SET
        status = ?,
        scheduled_at = COALESCE(?, scheduled_at),
        notes = COALESCE(?, notes),
        completed_at = CASE WHEN ? = 'completed' AND completed_at IS NULL THEN datetime('now') ELSE completed_at END
      WHERE id = ?
    `).run(
      nextStatus,
      scheduled_at ? new Date(scheduled_at).toISOString() : null,
      notes ?? null,
      nextStatus,
      visit.id
    );

    res.json({ ok: true });
  });
}
