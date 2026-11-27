// Simuladores locais (sem internet, chaves falsas). Só para testar o fluxo de integração.
//  - TOConline:  porta 4020 (autorização, tokens, taxas, documentos, linhas, finalização)
//  - Resend:     porta 4011 (envio de e-mails)
const http = require('http');

const FAKE = {
  clientId: 'fake-client',
  clientSecret: 'fake-secret-local',
  authCode: 'FAKECODE123',
  resendKey: 're_fake_local_only',
};
const log = [];
let docSeq = 0;
let lineSeq = 0;
let emailSeq = 0;
let accessCounter = 1;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

function send(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

// ---------- TOConline ----------
const toc = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4020');
  const body = await readBody(req);
  log.push({ at: new Date().toISOString(), method: req.method, path: url.pathname + url.search, auth: req.headers.authorization || null });
  const bearer = (req.headers.authorization || '').startsWith('Bearer tok-acc-');

  if (req.method === 'GET' && url.pathname === '/oauth/auth') {
    if (url.searchParams.get('client_id') !== FAKE.clientId || url.searchParams.get('scope') !== 'commercial') {
      return send(res, 400, { error: 'invalid_client' });
    }
    const redirect = url.searchParams.get('redirect_uri') + `?code=${FAKE.authCode}`;
    res.writeHead(302, { Location: redirect });
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    const basic = Buffer.from(String(req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
    if (basic !== `${FAKE.clientId}:${FAKE.clientSecret}`) return send(res, 401, { error: 'invalid_client' });
    const form = new URLSearchParams(body);
    if (form.get('grant_type') === 'authorization_code' && form.get('code') === FAKE.authCode) {
      return send(res, 200, { access_token: `tok-acc-${accessCounter}`, refresh_token: 'tok-ref-1', expires_in: 14400, token_type: 'Bearer' });
    }
    if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'tok-ref-1') {
      accessCounter += 1;
      return send(res, 200, { access_token: `tok-acc-${accessCounter}`, refresh_token: 'tok-ref-1', expires_in: 14400, token_type: 'Bearer' });
    }
    return send(res, 400, { error: 'invalid_grant' });
  }

  if (!bearer) return send(res, 401, { errors: [{ detail: 'token em falta ou expirado' }] });

  if (req.method === 'GET' && url.pathname === '/api/taxes') {
    const pct = Number(url.searchParams.get('filter[tax_percentage]'));
    if (![6, 23].includes(pct)) return send(res, 200, { data: [] });
    return send(res, 200, { data: [{ id: `tax-${pct}`, type: 'taxes', attributes: { tax_percentage: pct, tax_country_region: 'PT' } }] });
  }

  if (req.method === 'POST' && url.pathname === '/api/commercial_sales_documents') {
    const data = JSON.parse(body || '{}').data || {};
    if (data.attributes?.document_type !== 'FT' || !data.attributes?.customer_business_name) {
      return send(res, 422, { errors: [{ detail: 'document_type e customer_business_name são obrigatórios' }] });
    }
    docSeq += 1;
    return send(res, 201, { data: { id: `doc-${docSeq}`, type: 'commercial_sales_documents', attributes: { document_type: 'FT' } } });
  }

  if (req.method === 'POST' && url.pathname === '/api/commercial_sales_receipt_lines') {
    const data = JSON.parse(body || '{}').data || {};
    if (!data.attributes?.document_id || !data.attributes?.tax_id) {
      return send(res, 422, { errors: [{ detail: 'document_id e tax_id são obrigatórios' }] });
    }
    lineSeq += 1;
    return send(res, 201, { data: { id: `line-${lineSeq}`, type: 'commercial_sales_receipt_lines' } });
  }

  const finalize = url.pathname.match(/^\/api\/commercial_sales_documents\/(doc-\d+)$/);
  if (req.method === 'PATCH' && finalize) {
    const data = JSON.parse(body || '{}').data || {};
    if (data.attributes?.status !== 1) return send(res, 422, { errors: [{ detail: 'status inválido' }] });
    return send(res, 200, { data: { id: finalize[1], type: 'commercial_sales_documents', attributes: { status: 1, document_no: `FT 2026/${finalize[1].split('-')[1]}` } } });
  }

  if (req.method === 'GET' && url.pathname === '/__log') return send(res, 200, { log });
  send(res, 404, { errors: [{ detail: 'not found' }] });
});

// ---------- Resend ----------
const resend = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4011');
  const body = await readBody(req);
  if (req.method === 'POST' && url.pathname === '/emails') {
    if (req.headers.authorization !== `Bearer ${FAKE.resendKey}`) return send(res, 401, { message: 'invalid api key' });
    const j = JSON.parse(body || '{}');
    if (!j.to || !j.subject) return send(res, 422, { message: 'to e subject são obrigatórios' });
    emailSeq += 1;
    log.push({ at: new Date().toISOString(), kind: 'email', to: j.to, subject: j.subject });
    return send(res, 200, { id: `em-${emailSeq}` });
  }
  if (req.method === 'GET' && url.pathname === '/__log') return send(res, 200, { log });
  send(res, 404, { message: 'not found' });
});

toc.listen(4020, () => console.log('toconline-sim em http://localhost:4020'));
resend.listen(4011, () => console.log('resend-sim em http://localhost:4011'));
