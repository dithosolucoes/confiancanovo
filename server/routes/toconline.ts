import type express from 'express';
import type { UserRole } from '../../src/types/domain.ts';
import {
  tocAuthorizeUrl,
  tocConfig,
  tocEmitInvoice,
  tocExchangeCode,
  tocIsAuthorized,
} from '../toconline.ts';

// Rotas da integração TOConline (faturação oficial), movidas de server.ts sem alteração de comportamento.
// A tabela toconline_tokens é criada por initTocTables(db), chamado em server.ts antes deste registro.
// Não há estado em memória neste módulo: tokens ficam no banco.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

export interface ToconlineRouteContext {
  db: Db;
  requireAuth: RequireAuth;
}

export function registerToconlineRoutes(app: express.Express, ctx: ToconlineRouteContext) {
  const { db, requireAuth } = ctx;

  app.get('/api/toconline/status', requireAuth(['super_admin']), (_req, res) => {
    res.json({ configured: Boolean(tocConfig()), authorized: tocIsAuthorized(db) });
  });

  app.get('/api/toconline/authorize-url', requireAuth(['super_admin']), (_req, res) => {
    const cfg = tocConfig();
    if (!cfg) return res.status(503).json({ error: 'TOConline não configurada (variáveis TOCONLINE_*).' });
    res.json({ url: tocAuthorizeUrl(cfg) });
  });

  // Retorno do login da TOConline (a gestão está com a sessão iniciada neste navegador)
  app.get('/api/toconline/callback', requireAuth(['super_admin']), async (req, res) => {
    const cfg = tocConfig();
    const code = String(req.query.code ?? '');
    if (!cfg || !code) return res.redirect('/admin/faturacao?toconline=erro');
    try {
      await tocExchangeCode(db, cfg, code);
      res.redirect('/admin/faturacao?toconline=ok');
    } catch {
      res.redirect('/admin/faturacao?toconline=erro');
    }
  });

  app.post('/api/orders/:id/invoice-toc', requireAuth(['super_admin']), async (req, res) => {
    const cfg = tocConfig();
    if (!cfg) return res.status(503).json({ error: 'TOConline não configurada (variáveis TOCONLINE_*).' });
    if (!tocIsAuthorized(db)) return res.status(409).json({ error: 'A TOConline ainda não foi autorizada pela gestão.' });
    const o = db.prepare('SELECT * FROM service_orders WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!o) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (o.status !== 'completed') return res.status(400).json({ error: 'Só ordens concluídas podem ser faturadas.' });
    if (o.toc_document_id) return res.status(409).json({ error: `Esta ordem já tem fatura: ${o.invoice_number}.` });
    if (!o.customer_nif) return res.status(400).json({ error: 'Informe o NIF do cliente antes de faturar.' });

    const rate = Number(o.vat_rate) === 6 ? 6 : 23;
    const servicesNet = Number(o.service_fee) + Number(o.labor_cost) + Number(o.extra_fee) + Number(o.additional_cost);
    const partsNet = Number(o.parts_customer_total);
    const lines = [
      { description: `Serviço ${o.reference_code}: ${o.service_name}`, quantity: 1, unitPrice: Math.round(servicesNet * (1 + rate / 100) * 100) / 100, vatRate: rate },
    ];
    if (partsNet > 0) {
      lines.push({ description: `Peças e materiais ${o.reference_code}`, quantity: 1, unitPrice: Math.round(partsNet * (1 + rate / 100) * 100) / 100, vatRate: rate });
    }
    const today = new Date().toISOString().slice(0, 10);
    try {
      const out = await tocEmitInvoice(db, cfg, {
        customerName: o.customer_name,
        nif: o.customer_nif,
        address: o.service_address,
        postalCode: o.postal_code,
        city: o.localidade,
        date: today,
        reference: o.reference_code,
        lines,
      });
      db.prepare('UPDATE service_orders SET invoice_number = ?, invoice_issued_at = ?, toc_document_id = ? WHERE id = ?').run(
        out.documentNo,
        today,
        out.documentId,
        o.id
      );
      res.json({ ok: true, documentNo: out.documentNo });
    } catch (err: any) {
      res.status(Number(err?.status) || 500).json({ error: err?.message || 'Falha ao emitir a fatura.' });
    }
  });
}
