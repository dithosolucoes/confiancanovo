import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';
import { getParamAt } from '../params.ts';
import {
  AuthUser,
  clearSessionCookie,
  getAuthenticatedUser,
  loginAttempts,
  setSessionCookie,
  signToken,
} from '../infra/auth-session.ts';

// Autenticação, conta e notificações (onze rotas), movidas de server.ts sem alteração de comportamento.
// Login com limite de tentativas por e-mail (10 erros em 15 minutos bloqueiam por 15 minutos).
// Dependências de server.ts e de db.ts entram por ctx: db, requireAuth, hashPassword, verifyPassword,
// getProfilePayload, createNotification, sendTransactionalEmail.

type Db = typeof import('../db.ts').db;

type RequireAuth = (allowedRoles?: UserRole[]) => express.RequestHandler;

export interface AuthRouteContext {
  db: Db;
  requireAuth: RequireAuth;
  hashPassword: (password: string) => string;
  verifyPassword: (password: string, storedHash: string) => boolean;
  getProfilePayload: (userId: string) => any;
  createNotification: (userId: string, title: string, body: string, channel?: 'in_app' | 'email') => void;
  sendTransactionalEmail: (params: {
    to: string;
    subject: string;
    html: string;
    template: string;
    recipientUserId?: string | null;
  }) => Promise<unknown>;
}

export function registerAuthRoutes(app: express.Express, ctx: AuthRouteContext) {
  const { db, requireAuth, hashPassword, verifyPassword, getProfilePayload, createNotification, sendTransactionalEmail } = ctx;

  // AUTH ROUTES
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e palavra-passe obrigatórios.' });
    }

    // Limite de tentativas por e-mail: 10 erros em 15 minutos bloqueiam novas tentativas por 15 minutos
    const attemptKey = String(email).trim().toLowerCase();
    const attempt = loginAttempts.get(attemptKey);
    const nowMs = Date.now();
    if (attempt && attempt.blockedUntil > nowMs) {
      const mins = Math.ceil((attempt.blockedUntil - nowMs) / 60000);
      return res.status(429).json({ error: `Muitas tentativas. Tente de novo daqui a ${mins} minuto(s).` });
    }

    const row = db
      .prepare('SELECT id, password_hash, is_active FROM profiles WHERE lower(email) = lower(?)')
      .get(String(email).trim()) as any;

    if (!row || !verifyPassword(String(password), row.password_hash)) {
      const current = loginAttempts.get(attemptKey);
      const fresh = !current || nowMs - current.firstAt > 15 * 60 * 1000;
      const count = fresh ? 1 : current.count + 1;
      loginAttempts.set(attemptKey, {
        count,
        firstAt: fresh ? nowMs : current.firstAt,
        blockedUntil: count >= 10 ? nowMs + 15 * 60 * 1000 : 0,
      });
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }
    loginAttempts.delete(attemptKey);
    if (!row.is_active) {
      return res.status(403).json({ error: 'Conta desativada pelo administrador.' });
    }

    const token = signToken({
      userId: row.id,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    setSessionCookie(req, res, token);

    return res.json({
      token,
      user: getProfilePayload(row.id),
    });
  });

  // Preview convenience switcher for the 5 seeded demo roles
  app.post('/api/auth/demo-login', (req, res) => {
    // Sem senha: em produção este atalho fica desligado (senão qualquer pessoa entra como super admin)
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Não encontrado.' });
    }
    const { userId } = req.body ?? {};
    const row = db
      .prepare('SELECT id, is_active FROM profiles WHERE id = ?')
      .get(String(userId || '')) as any;
    if (!row || !row.is_active) {
      return res.status(404).json({ error: 'Perfil de demonstração não encontrado.' });
    }
    const token = signToken({
      userId: row.id,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    setSessionCookie(req, res, token);
    return res.json({
      token,
      user: getProfilePayload(row.id),
    });
  });

  // Atomic Registration (SEC-01 resolved: profile + optional org created in single DB transaction)
  app.post('/api/auth/register', (req, res) => {
    const {
      email,
      password,
      fullName,
      phone,
      nif,
      iban,
      address,
      city,
      postalCode,
      role,
      organizationName,
    } = req.body ?? {};

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Nome, e-mail e palavra-passe são obrigatórios.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'A palavra-passe deve ter pelo menos 6 caracteres.' });
    }

    const allowedRegisterRoles: UserRole[] = [
      'customer',
      'technician',
      'company_admin',
      'partner_requester',
    ];
    const targetRole: UserRole = allowedRegisterRoles.includes(role)
      ? role
      : 'customer';

    const existing = db
      .prepare('SELECT id FROM profiles WHERE lower(email) = lower(?)')
      .get(String(email).trim());
    if (existing) {
      return res.status(409).json({ error: 'Já existe uma conta registada com este e-mail.' });
    }

    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const passHash = hashPassword(String(password));

    const registerTx = db.transaction(() => {
      let orgId: string | null = null;

      if (targetRole === 'company_admin' || targetRole === 'partner_requester') {
        orgId = `org-${crypto.randomUUID().slice(0, 8)}`;
        const orgType =
          targetRole === 'company_admin' ? 'technical_center' : 'partner_client';
        db.prepare(`
          INSERT INTO organizations (id, name, nif, org_type, email, phone, address, custom_payout_percentage, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, 50.0, 1)
        `).run(
          orgId,
          organizationName?.trim() || `${fullName.trim()} Lda`,
          nif || null,
          orgType,
          String(email).trim().toLowerCase(),
          phone || null,
          address || null
        );
      } else if (targetRole === 'technician') {
        orgId = 'org-matrix';
      }

      db.prepare(`
        INSERT INTO profiles (id, organization_id, role, full_name, email, password_hash, phone, nif, iban, address, city, postal_code, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        userId,
        orgId,
        targetRole,
        String(fullName).trim(),
        String(email).trim().toLowerCase(),
        passHash,
        phone || null,
        nif || null,
        iban || null,
        address || null,
        city || null,
        postalCode || null
      );

      createNotification(
        userId,
        'Bem-vindo à Confiança Repara',
        `A sua conta foi criada com sucesso (${targetRole}).`,
        'email'
      );
    });

    registerTx();

    void sendTransactionalEmail({
      to: String(email).trim().toLowerCase(),
      recipientUserId: userId,
      template: 'welcome',
      subject: 'Bem-vindo à Confiança Repara — Conta Ativa',
      html: `<h2>Olá ${String(fullName).trim()},</h2><p>A sua conta <strong>Confiança Repara</strong> foi criada com sucesso (${targetRole}).</p><p>Atendimento e agendamento 7 dias por semana em Lisboa e região e Margem Sul.</p>`,
    });

    const token = signToken({
      userId,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    setSessionCookie(req, res, token);

    return res.status(201).json({
      token,
      user: getProfilePayload(userId),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    return res.json({ user: getProfilePayload(auth.user.id) });
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body ?? {};
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Informe o e-mail da conta.' });
    }
    const target = db
      .prepare('SELECT id, full_name, email, is_active FROM profiles WHERE lower(email) = lower(?)')
      .get(String(email).trim()) as any;

    if (!target || !target.is_active) {
      return res.json({
        ok: true,
        message: 'Se o e-mail existir, enviámos instruções de recuperação.',
      });
    }

    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(`prt-${crypto.randomUUID().slice(0, 8)}`, target.id, tokenHash, expiresAt);

    createNotification(
      target.id,
      'Pedido de recuperação de palavra-passe',
      `Foi solicitado um código de redefinição válido por 30 minutos.`,
      'email'
    );

    return res.json({
      ok: true,
      message: 'Instruções de recuperação geradas com sucesso.',
      previewResetToken: process.env.NODE_ENV !== 'production' ? rawToken : undefined,
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body ?? {};
    if (!token || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        error: 'Token válido e nova palavra-passe (mín. 6 caracteres) são obrigatórios.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
    const row = db
      .prepare(`
        SELECT * FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL
      `)
      .get(tokenHash) as any;

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Token inválido ou expirado.' });
    }

    const newHash = hashPassword(String(newPassword));
    const tx = db.transaction(() => {
      db.prepare("UPDATE profiles SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
        newHash,
        row.user_id
      );
      db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
    });
    tx();

    return res.json({ ok: true, message: 'Palavra-passe atualizada com sucesso.' });
  });

  // PROFILE SELF-SERVICE
  app.patch('/api/profile', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(user.id) as any;
    if (!current) return res.status(404).json({ error: 'Perfil não encontrado.' });
    if (user.role === 'technician' && req.body?.iban !== undefined && Number(getParamAt(db, 'tech_sees_payouts')) !== 1) {
      return res.status(403).json({ error: 'Os dados bancários não estão disponíveis para o seu perfil.' });
    }

    const body = req.body ?? {};
    const {
      full_name,
      phone,
      nif,
      iban,
      address,
      city,
      postal_code,
      emergency_contact,
      is_paused,
      billing_name,
      billing_nif,
      billing_address,
      avatar_url,
    } = body;

    let safeAvatarUrl: string | null | undefined = undefined;
    if (avatar_url !== undefined) {
      if (avatar_url === null || avatar_url === '') {
        safeAvatarUrl = null;
      } else if (
        typeof avatar_url === 'string' &&
        /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar_url) &&
        avatar_url.length <= 2 * 1024 * 1024
      ) {
        safeAvatarUrl = avatar_url;
      } else {
        return res.status(400).json({ error: 'Formato de foto inválido (use JPEG, PNG ou WEBP até 1.5 MB).' });
      }
    }

    db.prepare(`
      UPDATE profiles SET
        full_name = ?,
        phone = ?,
        nif = ?,
        iban = ?,
        address = ?,
        city = ?,
        postal_code = ?,
        emergency_contact = ?,
        is_paused = ?,
        billing_name = ?,
        billing_nif = ?,
        billing_address = ?,
        avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      full_name !== undefined && String(full_name).trim() ? String(full_name).trim() : current.full_name,
      phone !== undefined ? (phone || null) : current.phone,
      nif !== undefined ? (nif || null) : current.nif,
      iban !== undefined ? (iban || null) : current.iban,
      address !== undefined ? (address || null) : current.address,
      city !== undefined ? (city || null) : current.city,
      postal_code !== undefined ? (postal_code || null) : current.postal_code,
      emergency_contact !== undefined ? (emergency_contact || null) : current.emergency_contact,
      is_paused !== undefined ? (is_paused ? 1 : 0) : current.is_paused,
      billing_name !== undefined ? (billing_name || null) : current.billing_name,
      billing_nif !== undefined ? (billing_nif || null) : current.billing_nif,
      billing_address !== undefined ? (billing_address || null) : current.billing_address,
      safeAvatarUrl !== undefined ? 1 : 0,
      safeAvatarUrl ?? null,
      user.id
    );
    res.json({ user: getProfilePayload(user.id) });
  });

  app.post('/api/profile/change-password', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        error: 'Palavra-passe atual e nova palavra-passe (mín. 6 caracteres) obrigatórias.',
      });
    }
    const row = db.prepare('SELECT password_hash FROM profiles WHERE id = ?').get(user.id) as any;
    if (!row || !verifyPassword(String(currentPassword), row.password_hash)) {
      return res.status(401).json({ error: 'Palavra-passe atual incorreta.' });
    }
    db.prepare("UPDATE profiles SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      hashPassword(String(newPassword)),
      user.id
    );
    return res.json({ ok: true });
  });

  // NOTIFICATIONS
  app.get('/api/notifications', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(user.id)
      .map((n: any) => ({ ...n, is_read: Boolean(n.is_read) }));
    res.json({ notifications: rows });
  });

  app.post('/api/notifications/read-all', requireAuth(), (req, res) => {
    const user: AuthUser = (req as any).authUser;
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    res.json({ ok: true });
  });
}
