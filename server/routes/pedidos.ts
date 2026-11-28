import type { Express } from 'express';
import { db } from '../db.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { calculateServiceFinancials, computeAdditionalChargesSummary, computeProportionalPayout } from '../../src/core/finance/calculator.ts';
import { getWeeklyPayoutCycle } from '../../src/core/finance/weekly-cycle.ts';
import { CONFIANCA_COMPANY } from '../../src/core/constants/company.ts';
import { getParamAt, setParam } from '../params.ts';
import type { AuthUser } from '../infra/auth-session.ts';
import type { UserRole } from '../../src/types/domain.ts';

// Rotas de pedidos (fatia 16). Dependencias entram por ctx (contextoPedidos em server.ts).
// Transições de estado que o técnico responsável pode pedir pelo PATCH (aceite, deslocação, início, conclusão)
const TECH_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['pending', 'accepted'],
  accepted: ['accepted', 'on_the_way', 'in_progress'],
  on_the_way: ['on_the_way', 'in_progress'],
  in_progress: ['in_progress', 'budgeting', 'payment_pending', 'completed'],
  budgeting: ['budgeting', 'in_progress', 'payment_pending', 'completed'],
  payment_pending: ['payment_pending'],
  completed: ['completed'],
};

export function registerPedidosRoutes(app: Express, ctx: any): void {
  const { requireAuth, canUserAccessOrder, projectOrderForRole, projectItemsForRole, createNotification, broadcastToOrder, broadcastToUser, recalculateOrderInDb, notifyTechnicianOfValueChange, normalizeNif, nextReferenceCode, referencePrefixFor, saveOrderPhotoFile, UPLOADS_BASE_DIR, sendTransactionalEmail } = ctx;
  app.get('/api/orders', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { status, quoteStatus, search, scope, includeDeleted, invoiceFilter, baixaFilter } =
      req.query as Record<string, string>;

    let where =
      user.role === 'super_admin' && includeDeleted === 'only'
        ? 'so.deleted_at IS NOT NULL'
        : 'so.deleted_at IS NULL';
    const params: any[] = [];

    if (user.role === 'company_admin') {
      where += ' AND so.provider_org_id = ?';
      params.push(user.organization_id);
    } else if (user.role === 'partner_requester') {
      where += ' AND so.requester_org_id = ?';
      params.push(user.organization_id);
    } else if (user.role === 'technician') {
      if (scope === 'available') {
        where += " AND so.status = 'pending' AND so.technician_id IS NULL AND so.provider_org_id = ?";
        params.push(user.organization_id || 'org-matrix');
      } else if (scope === 'mine') {
        where += ' AND so.technician_id = ?';
        params.push(user.id);
      } else {
        where += ' AND (so.technician_id = ? OR (so.technician_id IS NULL AND so.provider_org_id = ?))';
        params.push(user.id, user.organization_id || 'org-matrix');
      }
    } else if (user.role === 'customer') {
      where += ' AND so.customer_id = ?';
      params.push(user.id);
    }

    if (status && status !== 'all') {
      where += ' AND so.status = ?';
      params.push(status);
    }
    if (quoteStatus && quoteStatus !== 'all') {
      if (quoteStatus === 'none') {
        where += ' AND so.quote_status IS NULL';
      } else {
        where += ' AND so.quote_status = ?';
        params.push(quoteStatus);
      }
    }
    if (user.role === 'super_admin') {
      if (invoiceFilter === 'invoiced') {
        where += " AND so.invoice_number IS NOT NULL AND so.invoice_number != ''";
      } else if (invoiceFilter === 'pending_invoice') {
        where += " AND (so.invoice_number IS NULL OR so.invoice_number = '')";
      }
      if (baixaFilter === 'received') {
        where += ' AND so.baixa_received_at IS NOT NULL';
      } else if (baixaFilter === 'pending_baixa') {
        where += ' AND so.baixa_received_at IS NULL';
      }
    }
    if (search && search.trim()) {
      where +=
        ' AND (so.reference_code LIKE ? OR so.service_name LIKE ? OR so.customer_name LIKE ? OR so.service_address LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    const rows = db
      .prepare(`
        SELECT so.*,
               req_org.name as requester_org_name,
               prov_org.name as provider_org_name,
               tech.full_name as technician_name
        FROM service_orders so
        LEFT JOIN organizations req_org ON req_org.id = so.requester_org_id
        LEFT JOIN organizations prov_org ON prov_org.id = so.provider_org_id
        LEFT JOIN profiles tech ON tech.id = so.technician_id
        WHERE ${where}
        ORDER BY so.created_at DESC
      `)
      .all(...params);

    res.json({
      orders: rows.map((r) => projectOrderForRole(r, user.role)),
    });
  });

  app.get('/api/orders/:id', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const row = db
      .prepare(`
        SELECT so.*,
               req_org.name as requester_org_name,
               prov_org.name as provider_org_name,
               tech.full_name as technician_name
        FROM service_orders so
        LEFT JOIN organizations req_org ON req_org.id = so.requester_org_id
        LEFT JOIN organizations prov_org ON prov_org.id = so.provider_org_id
        LEFT JOIN profiles tech ON tech.id = so.technician_id
        WHERE so.id = ?
      `)
      .get(req.params.id) as any;

    if (!row) return res.status(404).json({ error: 'Ordem de serviço não encontrada.' });
    if (!canUserAccessOrder(user, row)) {
      return res.status(403).json({ error: 'Sem acesso a esta ordem de serviço.' });
    }

    const items = db
      .prepare(`
        SELECT i.*, s.name as supplier_name
        FROM service_order_items i
        LEFT JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.service_order_id = ?
        ORDER BY i.created_at ASC
      `)
      .all(row.id);

    const messages = db
      .prepare(`
        SELECT m.*, p.full_name as sender_name, p.role as sender_role
        FROM order_messages m
        JOIN profiles p ON p.id = m.sender_id
        WHERE m.service_order_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(row.id);

    const photos = db
      .prepare(`
        SELECT op.id, op.service_order_id, op.uploaded_by, op.phase, op.file_name, op.mime_type, op.caption, op.created_at,
               p.full_name as uploader_name
        FROM order_photos op
        LEFT JOIN profiles p ON p.id = op.uploaded_by
        WHERE op.service_order_id = ?
        ORDER BY op.created_at DESC
      `)
      .all(row.id);

    const returnVisits = db
      .prepare(`
        SELECT rv.*, t.full_name as technician_name
        FROM warranty_return_visits rv
        LEFT JOIN profiles t ON t.id = rv.technician_id
        WHERE rv.service_order_id = ?
        ORDER BY rv.scheduled_at ASC
      `)
      .all(row.id);

    res.json({
      order: {
        ...projectOrderForRole(row, user.role),
        items: projectItemsForRole(items, user.role),
        messages,
        photos,
        return_visits: returnVisits,
      },
    });
  });

  app.post('/api/orders', requireAuth(['super_admin', 'company_admin', 'partner_requester', 'customer']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    let {
      catalog_id,
      service_name,
      category,
      description,
      urgency,
      customer_name,
      customer_phone,
      service_address,
      address_complement,
      postal_code,
      localidade,
      scheduled_at,
      requester_org_id,
      provider_org_id,
      technician_id,
      preferred_technician_id,
      vat_rate,
      service_fee,
      is_warranty,
      legacy_parts_markup,
      photos,
    } = req.body ?? {};

    // Cliente e parceiro não definem taxa, IVA, técnico, organizações, garantia nem regra: o servidor define tudo
    // a partir do catálogo e dos parâmetros. Admin e empresa mantêm os seus campos.
    const clientSide = user.role === 'customer' || user.role === 'partner_requester';
    if (clientSide) {
      service_fee = undefined;
      vat_rate = undefined;
      technician_id = undefined;
      provider_org_id = undefined;
      requester_org_id = undefined;
      is_warranty = undefined;
      legacy_parts_markup = undefined;
    }

    if (!service_address || (!catalog_id && !service_name)) {
      return res.status(400).json({ error: 'Serviço e morada são obrigatórios.' });
    }
    if (req.body?.customer_nif && !normalizeNif(req.body.customer_nif)) {
      return res.status(400).json({ error: 'NIF inválido. Use 9 dígitos.' });
    }

    // Técnico preferido (cliente): só se existir e estiver ativo; não atribui, apenas regista a preferência
    const prefTechId: string | null = preferred_technician_id
      ? clientSide
        ? ((db.prepare("SELECT id FROM profiles WHERE id = ? AND role = 'technician' AND is_active = 1").get(preferred_technician_id) as any)?.id ?? null)
        : preferred_technician_id
      : null;

    // Admin/empresa: técnico atribuído tem de existir e, para empresa, pertencer à própria organização
    if (!clientSide && technician_id) {
      const techRow = db.prepare("SELECT id, organization_id FROM profiles WHERE id = ? AND role = 'technician'").get(technician_id) as any;
      if (!techRow || (user.role === 'company_admin' && techRow.organization_id !== user.organization_id)) {
        return res.status(403).json({ error: 'Técnico inválido ou não pertence à sua empresa.' });
      }
    }

    const rateRows = db.prepare('SELECT code, amount FROM payout_rate_settings').all() as Array<{
      code: string;
      amount: number;
    }>;
    const rateMap = new Map(rateRows.map((r) => [r.code, Number(r.amount)]));

    let resolvedName = service_name;
    let resolvedCategory = category || 'Geral';
    const defaultWoFee = rateMap.get('WO') ?? 55;
    let resolvedFee = service_fee !== undefined ? Number(service_fee) : defaultWoFee;
    let resolvedVat = vat_rate !== undefined ? (Number(vat_rate) === 6 ? 6 : 23) : 23;

    if (catalog_id) {
      const cat = db.prepare('SELECT * FROM service_catalog WHERE id = ?').get(catalog_id) as any;
      if (cat) {
        resolvedName = resolvedName || cat.name;
        resolvedCategory = cat.category;
        if (service_fee === undefined) resolvedFee = Number(cat.base_service_fee);
        if (vat_rate === undefined) resolvedVat = Number(cat.default_vat_rate) === 6 ? 6 : 23;
      }
    } else if (service_fee === undefined && resolvedName) {
      const norm = String(resolvedName).toLowerCase();
      if (norm.includes('vistoria')) resolvedFee = rateMap.get('VISTORIA') ?? 85;
      else if (norm.includes('esquentador') && norm.includes('instala'))
        resolvedFee = rateMap.get('ESQ_INST') ?? 75;
      else if (norm.includes('esquentador')) resolvedFee = rateMap.get('ESQ_REP') ?? 85;
    }

    if (!resolvedName || !String(resolvedName).trim()) {
      return res.status(400).json({ error: 'Serviço inválido ou não encontrado no catálogo.' });
    }

    const SERVICE_KINDS = ['avulso', 'sequencia', 'recorrente'];
    const resolvedKind = SERVICE_KINDS.includes(String(req.body?.service_kind)) ? String(req.body.service_kind) : 'avulso';

    const id = `ord-${crypto.randomUUID().slice(0, 8)}`;
    const referenceCode = nextReferenceCode(referencePrefixFor(resolvedKind));

    const finalRequesterOrg =
      user.role === 'partner_requester'
        ? user.organization_id
        : requester_org_id || null;
    const finalProviderOrg =
      user.role === 'company_admin'
        ? user.organization_id!
        : provider_org_id || 'org-matrix';

    const finalTechId = clientSide ? null : technician_id || preferred_technician_id || null;
    const initialStatus = finalTechId ? 'accepted' : 'pending';

    db.prepare(`
      INSERT INTO service_orders (
        id, reference_code, catalog_id, service_name, category, description, urgency,
        customer_id, customer_name, customer_phone, requester_org_id, provider_org_id,
        technician_id, preferred_technician_id, service_address, address_complement, postal_code, localidade,
        scheduled_at, status, is_warranty, legacy_parts_markup, vat_rate, service_fee, service_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      referenceCode,
      catalog_id || null,
      resolvedName,
      resolvedCategory,
      description || '',
      urgency === 'urgent' ? 'urgent' : 'normal',
      user.role === 'customer' ? user.id : null,
      customer_name?.trim() || user.full_name,
      customer_phone || null,
      finalRequesterOrg,
      finalProviderOrg,
      finalTechId,
      clientSide ? prefTechId : preferred_technician_id || null,
      service_address.trim(),
      address_complement ? String(address_complement).trim() : null,
      postal_code ? String(postal_code).trim() : null,
      localidade ? String(localidade).trim() : null,
      scheduled_at || new Date().toISOString(),
      initialStatus,
      is_warranty ? 1 : 0,
      legacy_parts_markup ? 1 : 0,
      resolvedVat,
      resolvedFee,
      resolvedKind
    );

    // NIF para faturação: o informado, senão o do perfil (cliente) ou da empresa (parceiro)
    const profileNif = user.role === 'customer'
      ? (db.prepare('SELECT nif FROM profiles WHERE id = ?').get(user.id) as any)?.nif
      : null;
    const orgNif = finalRequesterOrg
      ? (db.prepare('SELECT nif FROM organizations WHERE id = ?').get(finalRequesterOrg) as any)?.nif
      : null;
    const nifValue = normalizeNif(req.body?.customer_nif) || normalizeNif(profileNif) || normalizeNif(orgNif) || null;
    const applianceValue = String(req.body?.appliance_type ?? '').trim() || null;
    db.prepare('UPDATE service_orders SET customer_nif = ?, appliance_type = ? WHERE id = ?').run(nifValue, applianceValue, id);

    if (Array.isArray(photos) && photos.length > 0) {
      for (const p of photos.slice(0, 5)) {
        if (p && typeof p.dataUrl === 'string') {
          try {
            saveOrderPhotoFile(id, user.id, {
              phase: p.phase || 'before',
              caption: p.caption || '',
              fileName: p.fileName || 'anexo.jpg',
              dataUrl: p.dataUrl,
            });
          } catch {
            // Skip invalid initial attachment without aborting order creation
          }
        }
      }
    }

    const updated = recalculateOrderInDb(id);

    const notifyTechId = finalTechId || prefTechId;
    if (notifyTechId) {
      createNotification(
        notifyTechId,
        prefTechId
          ? `★ Pedido "Mesmo Técnico" (${referenceCode})`
          : `Novo serviço atribuído (${referenceCode})`,
        `${resolvedName} em ${service_address}.`,
        'in_app'
      );
    }

    res.status(201).json({ order: projectOrderForRole(updated, user.role) });
  });

  app.patch('/api/orders/:id', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    const body = req.body ?? {};

    // Technicians can accept unassigned orders (with completeness check), release accepted orders back to mural, update notes/report, or complete
    if (user.role === 'technician') {
      const wantsRelease =
        body.release_order === true ||
        (body.status === 'pending' && body.technician_id === null);

      if (wantsRelease) {
        if (existing.technician_id !== user.id || existing.status !== 'accepted') {
          return res.status(400).json({
            error: 'Apenas serviços no estado Aceite (antes de iniciar deslocação) podem ser devolvidos ao mural.',
          });
        }
        db.prepare(`
          UPDATE service_orders SET
            status = 'pending',
            technician_id = NULL,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(existing.id);

        const admins = db
          .prepare(
            "SELECT id FROM profiles WHERE is_active = 1 AND (role = 'super_admin' OR (role = 'company_admin' AND organization_id = ?))"
          )
          .all(existing.provider_org_id) as Array<{ id: string }>;
        for (const adm of admins) {
          createNotification(
            adm.id,
            `Ordem devolvida ao mural (${existing.reference_code})`,
            `${user.full_name} devolveu o serviço ${existing.service_name} ao mural disponível.`,
            'in_app'
          );
        }

        const recalculated = recalculateOrderInDb(existing.id);
        broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
        return res.json({ order: projectOrderForRole(recalculated, user.role) });
      }

      const nextStatus = body.status || existing.status;

      // Sem técnico atribuído, o único caminho é o aceite de uma OS pendente (com as validações do perfil abaixo)
      if (!existing.technician_id && (existing.status !== 'pending' || nextStatus !== 'accepted')) {
        return res.status(400).json({ error: 'Esta ordem não tem técnico. Aceite-a no mural para a atribuir.' });
      }
      // Só transições permitidas para o técnico responsável
      const allowedNext = TECH_STATUS_TRANSITIONS[existing.status] ?? [];
      if (!allowedNext.includes(nextStatus)) {
        return res.status(400).json({ error: 'Transição de estado não permitida para o técnico.' });
      }

      if (nextStatus === 'accepted' && (!existing.technician_id || existing.status === 'pending')) {
        const techProfile = db
          .prepare('SELECT nif, iban, emergency_contact, is_paused FROM profiles WHERE id = ?')
          .get(user.id) as any;
        if (techProfile?.is_paused) {
          return res.status(400).json({
            error: 'A sua conta está marcada como pausada/indisponível. Reative a disponibilidade no Perfil antes de aceitar ordens.',
          });
        }
        const missing: string[] = [];
        if (!techProfile?.nif || !String(techProfile.nif).trim()) missing.push('NIF');
        if (!techProfile?.iban || !String(techProfile.iban).trim()) missing.push('IBAN');
        if (!techProfile?.emergency_contact || !String(techProfile.emergency_contact).trim()) {
          missing.push('Contacto de Emergência');
        }
        if (missing.length > 0) {
          return res.status(400).json({
            error: `Complete o seu perfil técnico antes de aceitar ordens (em falta: ${missing.join(', ')}).`,
          });
        }
      }

      const updates: any = {
        status: nextStatus,
        technician_id: existing.technician_id || user.id,
        before_photo_note: body.before_photo_note ?? existing.before_photo_note,
        after_photo_note: body.after_photo_note ?? existing.after_photo_note,
        report_text: body.report_text !== undefined ? body.report_text : existing.report_text,
        tech_arrived_at:
          nextStatus === 'in_progress' && !existing.tech_arrived_at
            ? new Date().toISOString()
            : existing.tech_arrived_at,
        completed_at:
          nextStatus === 'completed' && !existing.completed_at
            ? new Date().toISOString()
            : existing.completed_at,
      };
      db.prepare(`
        UPDATE service_orders SET
          status = ?, technician_id = ?, before_photo_note = ?, after_photo_note = ?, report_text = ?,
          tech_arrived_at = ?, completed_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        updates.status,
        updates.technician_id,
        updates.before_photo_note,
        updates.after_photo_note,
        updates.report_text,
        updates.tech_arrived_at,
        updates.completed_at,
        existing.id
      );
      const recalculated = recalculateOrderInDb(existing.id);
      broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
      return res.json({ order: projectOrderForRole(recalculated, user.role) });
    }

    // Partner requester and B2C customer can edit details or cancel ONLY while pending
    if (user.role === 'partner_requester' || user.role === 'customer') {
      if (existing.status !== 'pending') {
        return res.status(400).json({
          error: 'Apenas ordens pendentes podem ser editadas ou canceladas.',
        });
      }
      // Cliente e parceiro só podem cancelar; outro status é recusado de forma explícita
      if (body.status !== undefined && body.status !== existing.status && body.status !== 'cancelled') {
        return res.status(400).json({ error: 'Cliente e parceiro só podem cancelar a ordem.' });
      }
      const nextStatus = body.status === 'cancelled' ? 'cancelled' : existing.status;
      db.prepare(`
        UPDATE service_orders SET
          status = ?,
          customer_name = COALESCE(?, customer_name),
          customer_phone = ?,
          service_address = COALESCE(?, service_address),
          address_complement = ?,
          postal_code = ?,
          localidade = ?,
          scheduled_at = COALESCE(?, scheduled_at),
          description = COALESCE(?, description),
          urgency = COALESCE(?, urgency),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        nextStatus,
        body.customer_name?.trim() || null,
        body.customer_phone !== undefined ? (body.customer_phone || null) : existing.customer_phone,
        body.service_address?.trim() || null,
        body.address_complement !== undefined ? (body.address_complement || null) : existing.address_complement,
        body.postal_code !== undefined ? (body.postal_code || null) : existing.postal_code,
        body.localidade !== undefined ? (body.localidade || null) : existing.localidade,
        body.scheduled_at ?? null,
        body.description !== undefined ? body.description : null,
        body.urgency === 'urgent' || body.urgency === 'normal' ? body.urgency : null,
        existing.id
      );
      const recalculated = recalculateOrderInDb(existing.id);
      broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
      return res.json({ order: projectOrderForRole(recalculated, user.role) });
    }

    // Company admin can assign/unassign internal technicians and update status/report
    if (user.role === 'company_admin') {
      let nextTechId = existing.technician_id;
      let nextStatus = body.status ?? existing.status;
      if (body.technician_id !== undefined) {
        if (body.technician_id) {
          const techRow = db
            .prepare("SELECT id, organization_id FROM profiles WHERE id = ? AND role = 'technician'")
            .get(body.technician_id) as any;
          if (!techRow || techRow.organization_id !== user.organization_id) {
            return res.status(403).json({ error: 'Técnico inválido ou não pertence à sua empresa.' });
          }
          nextTechId = techRow.id;
          if (body.status === undefined && existing.status === 'pending') {
            nextStatus = 'accepted';
          }
        } else {
          nextTechId = null;
          if (body.status === undefined && existing.status === 'accepted') {
            nextStatus = 'pending';
          }
        }
      }

      db.prepare(`
        UPDATE service_orders SET
          technician_id = ?,
          status = ?,
          report_text = COALESCE(?, report_text),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(nextTechId, nextStatus, body.report_text ?? null, existing.id);
      const recalculated = recalculateOrderInDb(existing.id);
      broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
      return res.json({ order: projectOrderForRole(recalculated, user.role) });
    }

    // Super admin has full control (independent status vs quote_status, financials, core fields, manual payout override)
    if (user.role === 'super_admin') {
      const nextStatus = body.status !== undefined ? body.status : existing.status;
      const nextQuoteStatus =
        body.quote_status !== undefined ? body.quote_status : existing.quote_status;
      const nextOverridden =
        body.technician_payout_overridden !== undefined
          ? body.technician_payout_overridden
            ? 1
            : 0
          : existing.technician_payout_overridden;

      const completedAt =
        nextStatus === 'completed' && !existing.completed_at
          ? new Date().toISOString()
          : existing.completed_at;

      db.prepare(`
        UPDATE service_orders SET
          status = ?,
          quote_status = ?,
          provider_org_id = COALESCE(?, provider_org_id),
          technician_id = ?,
          customer_name = COALESCE(?, customer_name),
          customer_phone = ?,
          service_address = COALESCE(?, service_address),
          address_complement = ?,
          postal_code = ?,
          localidade = ?,
          scheduled_at = COALESCE(?, scheduled_at),
          description = COALESCE(?, description),
          urgency = COALESCE(?, urgency),
          report_text = ?,
          vat_rate = COALESCE(?, vat_rate),
          service_fee = COALESCE(?, service_fee),
          labor_cost = COALESCE(?, labor_cost),
          extra_fee = COALESCE(?, extra_fee),
          additional_cost = COALESCE(?, additional_cost),
          is_warranty = COALESCE(?, is_warranty),
          legacy_parts_markup = COALESCE(?, legacy_parts_markup),
          legacy_payout_rule = COALESCE(?, legacy_payout_rule),
          fixed_payout_amount = COALESCE(?, fixed_payout_amount),
          technician_payout = COALESCE(?, technician_payout),
          technician_payout_overridden = ?,
          completed_at = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        nextStatus,
        nextQuoteStatus,
        body.provider_org_id ?? null,
        body.technician_id !== undefined ? body.technician_id || null : existing.technician_id,
        body.customer_name?.trim() || null,
        body.customer_phone !== undefined ? (body.customer_phone || null) : existing.customer_phone,
        body.service_address?.trim() || null,
        body.address_complement !== undefined ? (body.address_complement || null) : existing.address_complement,
        body.postal_code !== undefined ? (body.postal_code || null) : existing.postal_code,
        body.localidade !== undefined ? (body.localidade || null) : existing.localidade,
        body.scheduled_at ?? null,
        body.description !== undefined ? body.description : null,
        body.urgency === 'urgent' || body.urgency === 'normal' ? body.urgency : null,
        body.report_text !== undefined ? (body.report_text || null) : existing.report_text,
        body.vat_rate !== undefined ? (Number(body.vat_rate) === 6 ? 6 : 23) : null,
        body.service_fee !== undefined ? Number(body.service_fee) : null,
        body.labor_cost !== undefined ? Number(body.labor_cost) : null,
        body.extra_fee !== undefined ? Number(body.extra_fee) : null,
        body.additional_cost !== undefined ? Number(body.additional_cost) : null,
        body.is_warranty !== undefined ? (body.is_warranty ? 1 : 0) : null,
        body.legacy_parts_markup !== undefined ? (body.legacy_parts_markup ? 1 : 0) : null,
        body.legacy_payout_rule !== undefined ? (body.legacy_payout_rule ? 1 : 0) : null,
        body.fixed_payout_amount !== undefined ? Number(body.fixed_payout_amount) : null,
        nextOverridden && body.manual_technician_payout !== undefined && !existing.technician_payout_locked
          ? Number(body.manual_technician_payout)
          : null,
        nextOverridden,
        completedAt,
        existing.id
      );

      // Aviso ao técnico quando a gestão altera taxa de serviço, M.O. ou taxa extra
      const afterRow = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id) as any;
      const gmChanges: string[] = [];
      const money = (v: unknown) => `€ ${Number(v || 0).toFixed(2)}`;
      for (const [field, label] of [
        ['service_fee', 'Taxa de serviço'],
        ['labor_cost', 'Mão de obra'],
        ['extra_fee', 'Taxa extra'],
      ] as const) {
        if (Math.abs(Number(afterRow[field] || 0) - Number(existing[field] || 0)) > 0.009) {
          gmChanges.push(`${label}: ${money(existing[field])} → ${money(afterRow[field])}`);
        }
      }
      if (gmChanges.length) notifyTechnicianOfValueChange(afterRow, gmChanges, user.id);

      const recalculated = recalculateOrderInDb(existing.id);
      broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
      return res.json({ order: projectOrderForRole(recalculated, user.role) });
    }

    return res.status(403).json({ error: 'Atualização não permitida para este perfil.' });
  });

  // Invoicing & Baixa (Recebimento) — Super Admin
  app.post('/api/orders/:id/invoice', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });

    const { invoice_number, invoice_issued_at, clear } = req.body ?? {};
    if (clear) {
      db.prepare(`
        UPDATE service_orders SET invoice_number = NULL, invoice_issued_at = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(existing.id);
    } else {
      if (!invoice_number || !String(invoice_number).trim()) {
        return res.status(400).json({ error: 'Informe o número da fatura (ex: FT 2026/001).' });
      }
      db.prepare(`
        UPDATE service_orders SET invoice_number = ?, invoice_issued_at = ?, updated_at = datetime('now') WHERE id = ?
      `).run(
        String(invoice_number).trim(),
        invoice_issued_at || new Date().toISOString().split('T')[0],
        existing.id
      );
    }
    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id);
    res.json({ order: projectOrderForRole(updated, 'super_admin') });
  });

  app.post('/api/orders/:id/baixa', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });

    const { received_at, undo } = req.body ?? {};
    // Lançamento de recebimento no fluxo de caixa (ligação contas a receber -> caixa).
    // Se a ordem já tem receita lançada (ex.: pagamento Stripe), não duplica.
    const manualEntryDesc = (ref: string) => `Recebimento (baixa) — ${ref}`;
    if (undo) {
      db.transaction(() => {
        db.prepare(`
          UPDATE service_orders SET baixa_received_at = NULL, updated_at = datetime('now') WHERE id = ?
        `).run(existing.id);
        db.prepare(`
          DELETE FROM cash_flow_entries
          WHERE service_order_id = ? AND category = 'service_revenue' AND description = ?
        `).run(existing.id, manualEntryDesc(existing.reference_code));
      })();
    } else {
      const baixaAt = received_at || new Date().toISOString().split('T')[0];
      db.transaction(() => {
        db.prepare(`
          UPDATE service_orders SET baixa_received_at = ?, updated_at = datetime('now') WHERE id = ?
        `).run(baixaAt, existing.id);
        const alreadyRevenue = db
          .prepare("SELECT id FROM cash_flow_entries WHERE service_order_id = ? AND category = 'service_revenue' LIMIT 1")
          .get(existing.id);
        if (!alreadyRevenue) {
          const amount = Number(existing.total_customer_amount || 0);
          db.prepare(`
            INSERT INTO cash_flow_entries (id, entry_type, category, description, amount, paid_amount, status, due_date, paid_at, service_order_id, created_by)
            VALUES (?, 'income', 'service_revenue', ?, ?, ?, 'paid', ?, datetime('now'), ?, ?)
          `).run(
            `cf-${crypto.randomUUID().slice(0, 8)}`,
            manualEntryDesc(existing.reference_code),
            amount,
            amount,
            baixaAt,
            existing.id,
            user.id
          );
        }
      })();
    }
    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id);
    res.json({ order: projectOrderForRole(updated, 'super_admin') });
  });

  // Cancelamento de uma ordem (também depois de aceite). O técnico recebe a percentagem do parâmetro
  // "Técnico em cancelamento depois de aceite" sobre a taxa de serviço; 0% por padrão.
  app.post('/api/orders/:id/cancel', requireAuth(['super_admin', 'company_admin', 'partner_requester', 'customer']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const o = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!o) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, o)) return res.status(403).json({ error: 'Sem permissão.' });
    if (o.status === 'completed' || o.status === 'cancelled') {
      return res.status(400).json({ error: 'Esta ordem já está concluída ou cancelada.' });
    }
    if ((user.role === 'partner_requester' || user.role === 'customer') && o.status !== 'pending' && o.status !== 'accepted') {
      return res.status(400).json({ error: 'Depois do início do serviço, o cancelamento é feito pela empresa.' });
    }

    const pct = Number(getParamAt(db, 'cancel_after_accept_tech_pct'));
    const afterAccept = o.status !== 'pending' && Boolean(o.technician_id);
    const techPayout = afterAccept ? Math.round((pct / 100) * Number(o.service_fee || 0) * 100) / 100 : 0;
    db.prepare(`
      UPDATE service_orders SET
        status = 'cancelled',
        cancelled_at = datetime('now'),
        completed_at = CASE WHEN ? > 0 THEN datetime('now') ELSE completed_at END,
        technician_payout = CASE WHEN ? THEN ? ELSE technician_payout END,
        technician_payout_overridden = CASE WHEN ? THEN 1 ELSE technician_payout_overridden END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(techPayout, afterAccept ? 1 : 0, techPayout, afterAccept ? 1 : 0, o.id);

    if (afterAccept) {
      createNotification(
        o.technician_id,
        `Ordem cancelada (${o.reference_code})`,
        techPayout > 0
          ? `O cancelamento entra no seu repasse: € ${techPayout.toFixed(2)}.`
          : 'A ordem foi cancelada pelo cliente. Não há valor a receber por este cancelamento.',
        'in_app'
      );
    }
    broadcastToOrder(o.id, { type: 'order:updated', orderId: o.id });
    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(o.id);
    res.json({ order: projectOrderForRole(updated, user.role), technicianPayout: techPayout });
  });

  // NIF do cliente e tipo de aparelho da ordem (cliente e parceiro só enquanto a ordem estiver pendente)
  app.patch('/api/orders/:id/details', requireAuth(['super_admin', 'company_admin', 'partner_requester', 'customer']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });
    if ((user.role === 'partner_requester' || user.role === 'customer') && existing.status !== 'pending') {
      return res.status(400).json({ error: 'Apenas ordens pendentes podem ser alteradas.' });
    }

    let nif: string | null = existing.customer_nif ?? null;
    if (req.body?.customer_nif !== undefined) {
      const raw = String(req.body.customer_nif ?? '').trim();
      if (raw === '') {
        nif = null;
      } else {
        const normalized = normalizeNif(raw);
        if (!normalized) return res.status(400).json({ error: 'NIF inválido. Use 9 dígitos.' });
        nif = normalized;
      }
    }

    let appliance: string | null = existing.appliance_type ?? null;
    if (req.body?.appliance_type !== undefined) {
      const name = String(req.body.appliance_type ?? '').trim() || null;
      if (name) {
        const ok = db.prepare('SELECT id FROM appliance_types WHERE name = ? AND active = 1').get(name);
        if (!ok) return res.status(400).json({ error: 'Tipo de aparelho inválido.' });
      }
      appliance = name;
    }

    db.prepare("UPDATE service_orders SET customer_nif = ?, appliance_type = ?, updated_at = datetime('now') WHERE id = ?").run(
      nif,
      appliance,
      existing.id
    );
    broadcastToOrder(existing.id, { type: 'order:updated', orderId: existing.id });
    const updated = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(existing.id);
    res.json({ order: projectOrderForRole(updated, user.role) });
  });
}

export function registerPedidoMensagensRoutes(app: Express, ctx: any): void {
  const { requireAuth, canUserAccessOrder, projectOrderForRole, projectItemsForRole, createNotification, broadcastToOrder, broadcastToUser, recalculateOrderInDb, notifyTechnicianOfValueChange, normalizeNif, nextReferenceCode, referencePrefixFor, saveOrderPhotoFile, UPLOADS_BASE_DIR, sendTransactionalEmail } = ctx;
  app.post('/api/orders/:id/messages', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const existing = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, existing)) return res.status(403).json({ error: 'Sem permissão.' });

    const { message } = req.body ?? {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Mensagem vazia.' });
    }
    const id = `msg-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO order_messages (id, service_order_id, sender_id, message)
      VALUES (?, ?, ?, ?)
    `).run(id, existing.id, user.id, String(message).trim());

    const created = db
      .prepare(`
        SELECT m.*, p.full_name as sender_name, p.role as sender_role
        FROM order_messages m
        JOIN profiles p ON p.id = m.sender_id
        WHERE m.id = ?
      `)
      .get(id);

    broadcastToOrder(existing.id, {
      type: 'chat:message',
      orderId: existing.id,
      message: created,
    });

    res.status(201).json({ message: created });
  });
}

export function registerPedidoFotosRoutes(app: Express, ctx: any): void {
  const { requireAuth, canUserAccessOrder, projectOrderForRole, projectItemsForRole, createNotification, broadcastToOrder, broadcastToUser, recalculateOrderInDb, notifyTechnicianOfValueChange, normalizeNif, nextReferenceCode, referencePrefixFor, saveOrderPhotoFile, UPLOADS_BASE_DIR, sendTransactionalEmail } = ctx;
  app.post('/api/orders/:id/photos', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, order)) return res.status(403).json({ error: 'Sem permissão.' });

    const { phase = 'before', caption = '', fileName = 'foto.jpg', dataUrl } = req.body ?? {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Imagem inválida.' });
    }
    try {
      const created = saveOrderPhotoFile(order.id, user.id, { phase, caption, fileName, dataUrl });
      res.status(201).json({ photo: created });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'Erro ao guardar foto.' });
    }
  });

  app.get('/api/orders/:id/photos/:photoId/file', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!canUserAccessOrder(user, order)) return res.status(403).json({ error: 'Sem permissão.' });

    const photo = db
      .prepare('SELECT * FROM order_photos WHERE id = ? AND service_order_id = ?')
      .get(req.params.photoId, order.id) as any;
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });

    const resolvedPath = path.resolve(UPLOADS_BASE_DIR, path.basename(photo.file_path));
    if (!resolvedPath.startsWith(UPLOADS_BASE_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Ficheiro indisponível.' });
    }

    res.setHeader('Content-Type', photo.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(resolvedPath);
  });

  app.delete('/api/orders/:id/photos/:photoId', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const photo = db
      .prepare('SELECT * FROM order_photos WHERE id = ? AND service_order_id = ?')
      .get(req.params.photoId, req.params.id) as any;
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });
    if (user.role !== 'super_admin' && photo.uploaded_by !== user.id) {
      return res.status(403).json({ error: 'Sem permissão para remover esta foto.' });
    }

    const resolvedPath = path.resolve(UPLOADS_BASE_DIR, path.basename(photo.file_path));
    if (resolvedPath.startsWith(UPLOADS_BASE_DIR + path.sep) && fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
    db.prepare('DELETE FROM order_photos WHERE id = ?').run(photo.id);
    res.json({ ok: true });
  });
}

export function registerPedidoExclusaoRoutes(app: Express, ctx: any): void {
  const { requireAuth, canUserAccessOrder, projectOrderForRole, projectItemsForRole, createNotification, broadcastToOrder, broadcastToUser, recalculateOrderInDb, notifyTechnicianOfValueChange, normalizeNif, nextReferenceCode, referencePrefixFor, saveOrderPhotoFile, UPLOADS_BASE_DIR, sendTransactionalEmail } = ctx;
  app.delete('/api/orders/:id', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (order.technician_payout_locked) {
      return res.status(400).json({ error: 'Não é possível eliminar ordem vinculada a uma semana já fechada.' });
    }
    db.prepare("UPDATE service_orders SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(
      user.id,
      order.id
    );
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/restore', requireAuth(['super_admin']), (req, res) => {
    const order = db.prepare('SELECT * FROM service_orders WHERE id = ?').get(req.params.id) as any;
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    db.prepare("UPDATE service_orders SET deleted_at = NULL, deleted_by = NULL, updated_at = datetime('now') WHERE id = ?").run(
      order.id
    );
    res.json({ ok: true });
  });
}
