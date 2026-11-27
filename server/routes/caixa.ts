import type express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserRole } from '../../src/types/domain.ts';

// Caixa (contas a pagar e a receber: recorrência, parcelas, pagamento parcial e comprovativos),
// movido de server.ts sem alteração de comportamento.
// RECEIPTS_BASE_DIR usa process.cwd(), como antes. A pasta é criada dentro de registerCaixaRoutes,
// no mesmo ponto de arranque em que era criada em server.ts.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

export interface CaixaRouteContext {
  db: Db;
  requireAuth: RequireAuth;
}

interface AuthUser {
  id: string;
  role: UserRole;
}

// Data de vencimento de cada parcela ou repetição (sempre a partir de 12:00 UTC).
function addFrequencyDate(baseDateStr: string, freq: string, stepIndex: number): string {
  const dt = new Date(`${baseDateStr}T12:00:00Z`);
  if (freq === 'weekly') dt.setUTCDate(dt.getUTCDate() + 7 * stepIndex);
  else if (freq === 'monthly') dt.setUTCMonth(dt.getUTCMonth() + stepIndex);
  else if (freq === 'quarterly') dt.setUTCMonth(dt.getUTCMonth() + 3 * stepIndex);
  else if (freq === 'semiannual') dt.setUTCMonth(dt.getUTCMonth() + 6 * stepIndex);
  else if (freq === 'annual') dt.setUTCFullYear(dt.getUTCFullYear() + stepIndex);
  return dt.toISOString().split('T')[0];
}

export function registerCaixaRoutes(app: express.Express, ctx: CaixaRouteContext) {
  const { db, requireAuth } = ctx;

  // =========================================================================
  // CASH FLOW & ACCOUNTS PAYABLE (RECURRING, INSTALLMENTS, PARTIAL PAY, RECEIPTS)
  // =========================================================================
  const RECEIPTS_BASE_DIR = path.resolve(process.cwd(), 'uploads', 'receipts');
  fs.mkdirSync(RECEIPTS_BASE_DIR, { recursive: true });

  app.get('/api/cash-flow', requireAuth(['super_admin']), (_req, res) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const entries = db
      .prepare('SELECT * FROM cash_flow_entries ORDER BY due_date DESC, created_at DESC')
      .all()
      .map((e: any) => ({
        ...e,
        amount: Number(e.amount),
        paid_amount: Number(e.paid_amount || (e.status === 'paid' ? e.amount : 0)),
        is_overdue: e.status !== 'paid' && String(e.due_date) < todayStr,
      }));
    res.json({ entries });
  });

  app.post('/api/cash-flow', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const {
      entry_type,
      category,
      description,
      amount,
      status,
      due_date,
      recurrence_frequency = 'none',
      recurrence_count = 1,
      total_installments = 1,
    } = req.body ?? {};
    if (!description || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Descrição e valor positivo são obrigatórios.' });
    }

    const baseDate = due_date || new Date().toISOString().split('T')[0];
    const finalType = entry_type === 'income' ? 'income' : 'expense';
    const finalStatus = status === 'paid' ? 'paid' : 'pending';
    const installments = Math.min(24, Math.max(1, Math.round(Number(total_installments) || 1)));
    const recFreq = String(recurrence_frequency || 'none');
    const recCount =
      recFreq !== 'none' ? Math.min(24, Math.max(1, Math.round(Number(recurrence_count) || 3))) : 1;

    const totalAmount = Math.round(Number(amount) * 100) / 100;
    const createdIds: string[] = [];

    const ins = db.prepare(`
      INSERT INTO cash_flow_entries (
        id, entry_type, category, description, amount, paid_amount, status, due_date, paid_at,
        recurrence_frequency, installment_group_id, installment_number, total_installments, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      if (installments > 1) {
        const groupId = `grp-${crypto.randomUUID().slice(0, 8)}`;
        const baseInstallment = Math.floor((totalAmount / installments) * 100) / 100;
        let allocated = 0;

        for (let i = 1; i <= installments; i++) {
          const isLast = i === installments;
          const partAmount = isLast
            ? Math.round((totalAmount - allocated) * 100) / 100
            : baseInstallment;
          allocated = Math.round((allocated + partAmount) * 100) / 100;
          const id = `cf-${crypto.randomUUID().slice(0, 8)}`;
          const partDate = addFrequencyDate(baseDate, 'monthly', i - 1);
          const partStatus = i === 1 && finalStatus === 'paid' ? 'paid' : 'pending';
          ins.run(
            id,
            finalType,
            category || 'other_expenses',
            `${description.trim()} (Parcela ${i}/${installments})`,
            partAmount,
            partStatus === 'paid' ? partAmount : 0,
            partStatus,
            partDate,
            partStatus === 'paid' ? new Date().toISOString() : null,
            'none',
            groupId,
            i,
            installments,
            user.id
          );
          createdIds.push(id);
        }
      } else {
        for (let i = 0; i < recCount; i++) {
          const id = `cf-${crypto.randomUUID().slice(0, 8)}`;
          const itemDate = recFreq !== 'none' ? addFrequencyDate(baseDate, recFreq, i) : baseDate;
          const itemStatus = i === 0 && finalStatus === 'paid' ? 'paid' : 'pending';
          ins.run(
            id,
            finalType,
            category || 'other_expenses',
            recCount > 1 ? `${description.trim()} (${i + 1}/${recCount})` : description.trim(),
            totalAmount,
            itemStatus === 'paid' ? totalAmount : 0,
            itemStatus,
            itemDate,
            itemStatus === 'paid' ? new Date().toISOString() : null,
            recFreq,
            null,
            null,
            null,
            user.id
          );
          createdIds.push(id);
        }
      }
    });
    tx();

    const first = db.prepare('SELECT * FROM cash_flow_entries WHERE id = ?').get(createdIds[0]);
    res.status(201).json({ entry: first, createdCount: createdIds.length });
  });

  app.post('/api/cash-flow/:id/mark-paid', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT amount FROM cash_flow_entries WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });
    db.prepare(
      "UPDATE cash_flow_entries SET status = 'paid', paid_amount = amount, paid_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/cash-flow/:id/partial-pay', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT * FROM cash_flow_entries WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    const payAmount = Number(req.body?.amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ error: 'Valor de pagamento parcial inválido.' });
    }

    const total = Number(existing.amount);
    const currentPaid = Number(existing.paid_amount || 0);
    const nextPaid = Math.min(total, Math.round((currentPaid + payAmount) * 100) / 100);
    const nextStatus = nextPaid >= total - 0.005 ? 'paid' : 'partial';

    db.prepare(`
      UPDATE cash_flow_entries SET
        paid_amount = ?,
        status = ?,
        paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
      WHERE id = ?
    `).run(nextPaid, nextStatus, nextStatus, existing.id);

    res.json({
      entry: db.prepare('SELECT * FROM cash_flow_entries WHERE id = ?').get(existing.id),
    });
  });

  app.post('/api/cash-flow/:id/receipt', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT * FROM cash_flow_entries WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    const { fileName = 'comprovativo.pdf', dataUrl } = req.body ?? {};
    const match = /^data:(image\/(?:jpeg|jpg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(
      String(dataUrl || '')
    );
    if (!match) {
      return res.status(400).json({ error: 'Formato permitido: PDF, JPEG, PNG ou WEBP.' });
    }

    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'O comprovativo deve ter no máximo 6 MB.' });
    }

    const ext =
      mimeType === 'application/pdf'
        ? 'pdf'
        : mimeType === 'image/png'
        ? 'png'
        : mimeType === 'image/webp'
        ? 'webp'
        : 'jpg';
    const storedName = `rec-${existing.id}.${ext}`;
    const resolvedPath = path.resolve(RECEIPTS_BASE_DIR, storedName);
    if (!resolvedPath.startsWith(RECEIPTS_BASE_DIR + path.sep)) {
      return res.status(400).json({ error: 'Caminho inválido.' });
    }

    fs.writeFileSync(resolvedPath, buffer);
    const cleanName = path.basename(String(fileName)).slice(0, 120) || storedName;
    db.prepare(
      'UPDATE cash_flow_entries SET receipt_path = ?, receipt_name = ?, receipt_mime = ? WHERE id = ?'
    ).run(storedName, cleanName, mimeType, existing.id);

    res.json({ ok: true, receipt_name: cleanName });
  });

  app.get('/api/cash-flow/:id/receipt', requireAuth(['super_admin']), (req, res) => {
    const existing = db.prepare('SELECT * FROM cash_flow_entries WHERE id = ?').get(req.params.id) as any;
    if (!existing || !existing.receipt_path) {
      return res.status(404).json({ error: 'Comprovativo não encontrado.' });
    }
    const resolvedPath = path.resolve(RECEIPTS_BASE_DIR, path.basename(existing.receipt_path));
    if (!resolvedPath.startsWith(RECEIPTS_BASE_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Ficheiro indisponível.' });
    }
    res.setHeader('Content-Type', existing.receipt_mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(resolvedPath);
  });
}
