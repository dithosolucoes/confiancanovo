// Cliente TOConline (faturação oficial em Portugal).
// Base: documentação pública (api-docs.toconline.pt). Pontos NÃO confirmados pela documentação pública
// são marcados com "a confirmar". Testado contra um simulador local com chaves falsas.
import type Database from 'better-sqlite3';

export interface TocConfig {
  apiUrl: string; // URL base da API, dada nas configurações de API do ERP
  oauthUrl: string; // URL de autenticação, dada nas configurações de API do ERP
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function tocConfig(): TocConfig | null {
  const apiUrl = process.env.TOCONLINE_API_URL?.trim();
  const oauthUrl = process.env.TOCONLINE_OAUTH_URL?.trim();
  const clientId = process.env.TOCONLINE_CLIENT_ID?.trim();
  const clientSecret = process.env.TOCONLINE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.TOCONLINE_REDIRECT_URI?.trim();
  if (!apiUrl || !oauthUrl || !clientId || !clientSecret || !redirectUri) return null;
  return { apiUrl, oauthUrl, clientId, clientSecret, redirectUri };
}

export function initTocTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS toconline_tokens (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      access_expires_at INTEGER NOT NULL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function tocAuthorizeUrl(cfg: TocConfig): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'commercial',
  });
  return `${cfg.oauthUrl.replace(/\/$/, '')}/auth?${q.toString()}`;
}

function basicAuth(cfg: TocConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
}

async function tokenRequest(cfg: TocConfig, form: Record<string, string>) {
  const resp = await fetch(`${cfg.oauthUrl.replace(/\/$/, '')}/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(cfg),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ ...form, scope: 'commercial' }).toString(),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw Object.assign(new Error(`TOConline: falha na autenticação (HTTP ${resp.status}).`), { status: 502 });
  }
  return data as { access_token: string; refresh_token: string; expires_in?: number };
}

function saveTokens(db: Database.Database, t: { access_token: string; refresh_token: string; expires_in?: number }) {
  const expiresAt = Date.now() + Math.max(60, Number(t.expires_in || 14400) - 60) * 1000;
  db.prepare(`
    INSERT INTO toconline_tokens (id, access_token, refresh_token, access_expires_at, saved_at)
    VALUES ('default', ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token,
      refresh_token = excluded.refresh_token, access_expires_at = excluded.access_expires_at, saved_at = excluded.saved_at
  `).run(t.access_token, t.refresh_token, expiresAt);
}

// Troca o código da autorização única por tokens (feito uma vez, pela gestão).
export async function tocExchangeCode(db: Database.Database, cfg: TocConfig, code: string) {
  const t = await tokenRequest(cfg, { grant_type: 'authorization_code', code });
  saveTokens(db, t);
}

export function tocIsAuthorized(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT id FROM toconline_tokens WHERE id = 'default'").get());
}

async function accessToken(db: Database.Database, cfg: TocConfig): Promise<string> {
  const row = db.prepare("SELECT * FROM toconline_tokens WHERE id = 'default'").get() as any;
  if (!row) throw Object.assign(new Error('TOConline ainda não autorizada pela gestão.'), { status: 409 });
  if (row.access_expires_at > Date.now()) return row.access_token;
  // Renovação com o refresh token (a documentação indica que ele vale 8 horas: a confirmar)
  const t = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  saveTokens(db, t);
  return t.access_token;
}

async function api(db: Database.Database, cfg: TocConfig, method: string, path: string, body?: unknown) {
  const token = await accessToken(db, cfg);
  const resp = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw Object.assign(new Error(`TOConline: ${method} ${path} falhou (HTTP ${resp.status}).`), { status: 502, data });
  }
  return data;
}

export interface TocInvoiceInput {
  customerName: string;
  nif: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  date: string; // AAAA-MM-DD
  reference: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number }>;
}

// Emite uma fatura FT: cria o cabeçalho, adiciona as linhas e finaliza (status 1).
// Retorna o número oficial (document_no), por exemplo "FT 2026/12".
export async function tocEmitInvoice(db: Database.Database, cfg: TocConfig, input: TocInvoiceInput) {
  // IVA: a documentação indica que cada linha usa tax_id, obtido por GET /taxes com a percentagem (a confirmar)
  const taxCache = new Map<number, string>();
  async function taxIdFor(rate: number): Promise<string> {
    if (taxCache.has(rate)) return taxCache.get(rate)!;
    const data = await api(db, cfg, 'GET', `/taxes?filter[tax_country_region]=PT&filter[tax_percentage]=${rate}`);
    const id = String(data?.data?.[0]?.id ?? '');
    if (!id) throw Object.assign(new Error(`TOConline: taxa de IVA ${rate}% não encontrada.`), { status: 502 });
    taxCache.set(rate, id);
    return id;
  }

  const header = await api(db, cfg, 'POST', '/commercial_sales_documents', {
    data: {
      type: 'commercial_sales_documents',
      attributes: {
        document_type: 'FT',
        date: input.date,
        customer_business_name: input.customerName,
        customer_tax_registration_number: input.nif || undefined,
        customer_address_detail: input.address || undefined,
        customer_postcode: input.postalCode || undefined,
        customer_city: input.city || undefined,
        vat_included_prices: true,
        external_reference: input.reference,
      },
    },
  });
  const docId = String(header?.data?.id ?? '');
  if (!docId) throw Object.assign(new Error('TOConline: documento não foi criado.'), { status: 502 });

  for (const line of input.lines) {
    const taxId = await taxIdFor(line.vatRate);
    await api(db, cfg, 'POST', '/commercial_sales_receipt_lines', {
      data: {
        type: 'commercial_sales_receipt_lines',
        attributes: {
          document_id: docId,
          item_type: 'Service',
          quantity: line.quantity,
          unit_price: line.unitPrice,
          tax_id: taxId,
          description: line.description,
        },
      },
    });
  }

  const fin = await api(db, cfg, 'PATCH', `/commercial_sales_documents/${docId}`, {
    data: { type: 'commercial_sales_documents', id: docId, attributes: { status: 1 } },
  });
  const documentNo = String(fin?.data?.attributes?.document_no ?? '');
  if (!documentNo) throw Object.assign(new Error('TOConline: número do documento não devolvido.'), { status: 502 });
  return { documentId: docId, documentNo };
}
