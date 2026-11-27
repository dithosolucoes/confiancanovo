import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UserRole } from '../../src/types/domain.ts';
import { pendingRestorePath, validateBackupFile } from '../restore.ts';

// Cópias de segurança e restauração, movidas de server.ts sem alteração de comportamento.
// Restauração em duas etapas: aqui só se valida e se deixa o arquivo pendente (dbPath + ".restore-pending").
// A troca acontece no arranque, em applyPendingRestore (server/restore.ts), chamado por server/db.ts antes
// de abrir a base. Este módulo NÃO importa server/db.ts: a base chega por ctx.
// Ordem de registro: as três rotas ficam no mesmo ponto em que estavam (depois do TOConline).

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

export interface BackupRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  dbPath: string;
}

interface AuthUser {
  id: string;
  role: UserRole;
}

export function registerBackupRoutes(app: express.Express, ctx: BackupRouteContext) {
  const { db, requireAuth, dbPath } = ctx;

  // Cópias de segurança (só super admin). Nunca incluem hash de senha nem tokens.
  const BACKUP_TABLES = [
    'profiles',
    'organizations',
    'service_catalog',
    'service_orders',
    'service_order_items',
    'payments',
    'weekly_payouts',
    'cash_flow_entries',
    'suppliers',
    'mileage_settings',
    'mileage_trips',
    'service_subscriptions',
    'payout_rate_settings',
    'business_parameters',
    'appliance_types',
    'reference_prefixes',
    'ai_conversations',
    'ai_messages',
  ];

  app.get('/api/admin/backup/database', requireAuth(['super_admin']), async (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const tmp = path.join(os.tmpdir(), `confianca-backup-${crypto.randomUUID()}.db`);
    try {
      await db.backup(tmp);
      console.info(`[backup] base copiada por ${user.id}`);
      const day = new Date().toISOString().slice(0, 10);
      res.download(tmp, `confianca-backup-${day}.db`, () => {
        fs.rm(tmp, { force: true }, () => undefined);
      });
    } catch {
      fs.rm(tmp, { force: true }, () => undefined);
      res.status(500).json({ error: 'Não foi possível criar a cópia da base.' });
    }
  });

  app.get('/api/admin/backup/tables', requireAuth(['super_admin']), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const tables: Record<string, any[]> = {};
    for (const name of BACKUP_TABLES) {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      if (!exists) continue;
      const rows = db.prepare(`SELECT * FROM ${name}`).all() as any[];
      tables[name] = name === 'profiles' ? rows.map(({ password_hash: _omit, ...rest }) => rest) : rows;
    }
    console.info(`[backup] tabelas exportadas por ${user.id}`);
    res.json({ generatedAt: new Date().toISOString(), tables });
  });

  // Restauração: só o super admin, com confirmação escrita. A troca acontece no próximo arranque do servidor.
  app.post(
    '/api/admin/backup/restore',
    requireAuth(['super_admin']),
    express.raw({ type: '*/*', limit: '500mb' }),
    async (req, res) => {
      const user: AuthUser = (req as any).authUser;
      if (req.headers['x-restore-confirm'] !== 'RESTAURAR') {
        return res.status(400).json({ error: 'Confirmação em falta: escreva RESTAURAR.' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
        return res.status(400).json({ error: 'Arquivo vazio ou não enviado.' });
      }
      const tmp = path.join(os.tmpdir(), `restauro-${crypto.randomUUID()}.db`);
      fs.writeFileSync(tmp, req.body);
      const check = validateBackupFile(tmp);
      if (!check.ok) {
        fs.rmSync(tmp, { force: true });
        return res.status(400).json({ error: check.error });
      }
      // Guarda a base atual antes de qualquer troca
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const previous = `${dbPath}.antes-restauro-${stamp}`;
      await db.backup(previous);
      fs.copyFileSync(tmp, pendingRestorePath(dbPath));
      fs.rmSync(tmp, { force: true });
      console.info(`[restauro] cópia enviada por ${user.id}; base atual guardada em ${previous}`);
      res.json({ staged: true, previousBackup: path.basename(previous), restartRequired: true });
    }
  );
}
