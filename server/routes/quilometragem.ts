import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';
import { CONFIANCA_COMPANY } from '../../src/core/constants/company.ts';
import { getParamAt, setParam } from '../params.ts';

// Quilometragem (registro de viagens, ajuste de auditoria e configurações), movida de server.ts
// sem alteração de comportamento. Quatro rotas, na mesma ordem, no mesmo ponto.
// Dependências de módulo de server.ts entram por ctx: cálculo de rota, coordenadas de endereço,
// notificação e broadcast (este último toca em wsClients, que continua em server.ts).

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

type Coords = { lat: number; lng: number };

interface AuthUser {
  id: string;
  role: UserRole;
  organization_id: string | null;
  full_name: string;
}

export interface QuilometragemRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  computeRouteDistance: (
    origin: string,
    destination: string,
    originCoords?: Coords | null,
    destCoords?: Coords | null
  ) => Promise<{ distanceKm: number; durationMinutes: number }>;
  findPortugalAddressCoords: (addr: string) => Coords;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
  broadcastToOrder: (orderId: string, event: Record<string, unknown>) => void;
}

export function registerQuilometragemRoutes(app: express.Express, ctx: QuilometragemRouteContext) {
  const { db, requireAuth, computeRouteDistance, findPortugalAddressCoords, createNotification, broadcastToOrder } = ctx;

  app.get('/api/mileage', requireAuth(['super_admin', 'company_admin', 'technician']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { technicianId } = req.query as Record<string, string>;

    const globalSettings = db
      .prepare('SELECT * FROM mileage_settings WHERE technician_id IS NULL')
      .get() as any;

    let query = `
      SELECT m.*, p.full_name as technician_name, so.reference_code,
             COALESCE(p.mileage_enabled, 1) as tech_mileage_enabled,
             ms.rate_per_km as tech_rate_override
      FROM mileage_trips m
      JOIN profiles p ON p.id = m.technician_id
      LEFT JOIN service_orders so ON so.id = m.service_order_id
      LEFT JOIN mileage_settings ms ON ms.technician_id = m.technician_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (user.role === 'technician') {
      query += ' AND m.technician_id = ?';
      params.push(user.id);
    } else if (user.role === 'company_admin') {
      query += ' AND p.organization_id = ?';
      params.push(user.organization_id);
    } else if (technicianId && technicianId !== 'all') {
      query += ' AND m.technician_id = ?';
      params.push(technicianId);
    }

    query += ' ORDER BY m.started_at DESC';
    const trips = db.prepare(query).all(...params).map((t: any) => {
      // Valor do km: override do técnico, senão o parâmetro vigente na data da viagem
      const ratePerKm =
        t.tech_rate_override !== null && t.tech_rate_override !== undefined
          ? Number(t.tech_rate_override)
          : getParamAt(db, 'mileage_rate_per_km', t.started_at);
      return {
        ...t,
        rate_per_km: ratePerKm,
        manual_override: Boolean(t.manual_override),
        mileage_enabled: Boolean(t.tech_mileage_enabled),
        // Técnico que não optou por receber quilometragem: registro existe (ETA), reembolso = 0
        reimbursement_amount: t.tech_mileage_enabled
          ? Math.round(Number(t.distance_km) * ratePerKm * 100) / 100
          : 0,
      };
    });

    const selfMileage =
      user.role === 'technician'
        ? (db.prepare('SELECT mileage_enabled FROM profiles WHERE id = ?').get(user.id) as any)
        : null;

    res.json({
      settings: globalSettings,
      trips,
      mileageEnabled: selfMileage ? Boolean(selfMileage.mileage_enabled) : undefined,
    });
  });

  app.post('/api/mileage/record', requireAuth(['technician', 'super_admin']), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { action, serviceOrderId, originLat, originLng } = req.body ?? {};
    const targetTechId = user.id;

    const settings = db
      .prepare('SELECT * FROM mileage_settings WHERE technician_id = ? OR technician_id IS NULL ORDER BY technician_id DESC LIMIT 1')
      .get(targetTechId) as any;

    const officeAddress = settings?.office_address || CONFIANCA_COMPANY.fullAddress;

    const todayStr = new Date().toISOString().split('T')[0];
    const lastTripToday = db
      .prepare(`
        SELECT destination_address, trip_type
        FROM mileage_trips
        WHERE technician_id = ? AND date(started_at) = date(?)
        ORDER BY started_at DESC LIMIT 1
      `)
      .get(targetTechId, todayStr) as any;

    const hasGps = Number.isFinite(Number(originLat)) && Number.isFinite(Number(originLng));
    const originCoords = hasGps ? { lat: Number(originLat), lng: Number(originLng) } : null;

    const originAddress =
      lastTripToday && lastTripToday.trip_type !== 'client_to_office'
        ? lastTripToday.destination_address
        : officeAddress;

    let destinationAddress = officeAddress;
    let destCoords: { lat: number; lng: number } | null = {
      lat: CONFIANCA_COMPANY.officeLat,
      lng: CONFIANCA_COMPANY.officeLng,
    };
    let tripType: 'office_to_client' | 'client_to_client' | 'client_to_office' = 'client_to_office';
    let targetOrder: any = null;

    if (action === 'on_the_way') {
      targetOrder = db
        .prepare('SELECT id, reference_code, customer_id, service_address, service_lat, service_lng, technician_id, status FROM service_orders WHERE id = ? AND deleted_at IS NULL')
        .get(serviceOrderId) as any;
      if (!targetOrder) return res.status(404).json({ error: 'Ordem não encontrada.' });
      // Só a OS atribuída ao técnico (super_admin mantém acesso total) e só nos estados em que a deslocação faz sentido
      if (user.role !== 'super_admin' && targetOrder.technician_id !== user.id) {
        return res.status(403).json({ error: 'Sem permissão.' });
      }
      if (!['accepted', 'on_the_way'].includes(targetOrder.status)) {
        return res.status(400).json({ error: 'Estado da ordem não permite registar deslocação.' });
      }
      destinationAddress = targetOrder.service_address;
      destCoords =
        targetOrder.service_lat && targetOrder.service_lng
          ? { lat: Number(targetOrder.service_lat), lng: Number(targetOrder.service_lng) }
          : findPortugalAddressCoords(targetOrder.service_address);
      tripType = originAddress === officeAddress ? 'office_to_client' : 'client_to_client';
    }

    const { distanceKm, durationMinutes } = await computeRouteDistance(
      originAddress,
      destinationAddress,
      originCoords,
      destCoords
    );

    if (action === 'on_the_way' && targetOrder) {
      db.prepare(`
        UPDATE service_orders SET
          status = 'on_the_way',
          tech_on_the_way_at = datetime('now'),
          tech_lat = COALESCE(?, tech_lat),
          tech_lng = COALESCE(?, tech_lng),
          service_lat = COALESCE(service_lat, ?),
          service_lng = COALESCE(service_lng, ?),
          eta_distance_km = ?,
          eta_minutes = ?,
          eta_updated_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        originCoords?.lat ?? null,
        originCoords?.lng ?? null,
        destCoords?.lat ?? null,
        destCoords?.lng ?? null,
        distanceKm,
        durationMinutes,
        targetOrder.id
      );

      if (targetOrder.customer_id) {
        createNotification(
          targetOrder.customer_id,
          `Técnico a caminho (${targetOrder.reference_code})`,
          `Chegada prevista em ~${durationMinutes} min (${distanceKm} km).`,
          'in_app'
        );
      }
      broadcastToOrder(targetOrder.id, {
        type: 'order:updated',
        orderId: targetOrder.id,
        eta_minutes: durationMinutes,
        eta_distance_km: distanceKm,
      });
    }

    const id = `trip-${crypto.randomUUID().slice(0, 8)}`;

    db.prepare(`
      INSERT INTO mileage_trips (id, technician_id, service_order_id, trip_type, origin_address, destination_address, distance_km, duration_minutes, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(
      id,
      targetTechId,
      action === 'on_the_way' ? serviceOrderId : null,
      tripType,
      hasGps ? `GPS (${Number(originLat).toFixed(4)}, ${Number(originLng).toFixed(4)})` : originAddress,
      destinationAddress,
      distanceKm,
      durationMinutes,
      action === 'return_to_office' ? new Date().toISOString() : null
    );

    const created = db.prepare('SELECT * FROM mileage_trips WHERE id = ?').get(id);
    res.json({ success: true, trip: created, etaMinutes: durationMinutes, distanceKm });
  });

  app.patch('/api/mileage/trips/:id', requireAuth(['super_admin']), (req, res) => {
    const { distance_km, override_reason } = req.body ?? {};
    if (distance_km === undefined || !override_reason) {
      return res.status(400).json({ error: 'Nova distância e motivo da auditoria são obrigatórios.' });
    }
    db.prepare(`
      UPDATE mileage_trips SET distance_km = ?, manual_override = 1, override_reason = ? WHERE id = ?
    `).run(Number(distance_km), String(override_reason).trim(), req.params.id);
    res.json({ ok: true });
  });

  app.patch('/api/mileage/settings', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { rate_per_km, office_address, effective_from, reason } = req.body ?? {};

    // O valor do km passa a ser um parâmetro com vigência (histórico preservado)
    if (rate_per_km !== undefined) {
      const result = setParam(
        db,
        'mileage_rate_per_km',
        { value: rate_per_km, effectiveFrom: effective_from, reason },
        user.full_name || user.id
      );
      if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    }

    db.prepare(`
      UPDATE mileage_settings SET
        office_address = COALESCE(?, office_address),
        updated_at = datetime('now')
      WHERE technician_id IS NULL
    `).run(office_address ?? null);

    const row = db.prepare('SELECT * FROM mileage_settings WHERE technician_id IS NULL').get() as any;
    res.json({ settings: { ...row, rate_per_km: getParamAt(db, 'mileage_rate_per_km') } });
  });
}
