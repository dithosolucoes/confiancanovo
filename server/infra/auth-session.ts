import type express from 'express';
import crypto from 'node:crypto';
import type { UserRole } from '../../src/types/domain.ts';
import { db } from '../db.ts';

// Sessão e autenticação de requisições, movidas de server.ts sem alteração de comportamento:
// token assinado (HMAC) em cookie "confianca_session" ou Bearer, middleware requireAuth (401, 403 de CSRF e de papel)
// e contador de tentativas de login por e-mail (estado de módulo, único, em memória).
// db vem de server/db.ts (singleton já aberto no arranque, que é importado antes deste módulo em server.ts).

// Tentativas de login falhadas, por e-mail (em memória; reinicia com o servidor)
export const loginAttempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
export const COOKIE_NAME = 'confianca_session';

export interface AuthUser {
  id: string;
  role: UserRole;
  organization_id: string | null;
  full_name: string;
  email: string;
  is_active: boolean;
}

export function signToken(payload: { userId: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string): { userId: string; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!decoded.userId || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

export function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: express.Request, res: express.Response) {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function getAuthenticatedUser(req: express.Request): { user: AuthUser; viaCookie: boolean } | null {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  let viaCookie = false;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[COOKIE_NAME]) {
      token = cookies[COOKIE_NAME];
      viaCookie = true;
    }
  }

  if (!token) return null;
  const verified = verifyToken(token);
  if (!verified) return null;

  const row = db
    .prepare(
      `SELECT id, role, organization_id, full_name, email, is_active FROM profiles WHERE id = ?`
    )
    .get(verified.userId) as any;

  if (!row || !row.is_active) return null;
  return {
    user: {
      id: row.id,
      role: row.role as UserRole,
      organization_id: row.organization_id,
      full_name: row.full_name,
      email: row.email,
      is_active: Boolean(row.is_active),
    },
    viaCookie,
  };
}

export function requireAuth(allowedRoles?: UserRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
    if (
      auth.viaCookie &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      req.headers['x-requested-with'] !== 'XMLHttpRequest'
    ) {
      return res.status(403).json({ error: 'Cabeçalho de segurança ausente.' });
    }
    if (allowedRoles && !allowedRoles.includes(auth.user.role)) {
      return res.status(403).json({ error: 'Sem permissão para este recurso.' });
    }
    (req as any).authUser = auth.user;
    next();
  };
}
