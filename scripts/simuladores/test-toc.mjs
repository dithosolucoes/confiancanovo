// Teste do fluxo TOConline (autorização e emissão) e do e-mail (Resend simulado), com chaves falsas.
const BASE = 'http://localhost:3000';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, cookie };
}
const withCookie = (cookie, extra = {}) => ({ ...H, cookie, ...extra });
async function api(method, path, cookie, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: withCookie(cookie), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* sem JSON */ }
  return { status: r.status, json, location: r.headers.get('location') };
}

(async () => {
  const adm = await login('diego@confiancamanutencao.com', 'Confianca2026!');
  check('Gestor entra', adm.status === 200, adm.status);
  const cust = await login('maria@cliente.pt', 'Confianca2026!');
  check('Cliente entra', cust.status === 200, cust.status);
  const A = adm.cookie;

  const st = await api('GET', '/api/toconline/status', A);
  check('Status: configurada, ainda não autorizada', st.json?.configured === true && st.json?.authorized === false, JSON.stringify(st.json));

  const au = await api('GET', '/api/toconline/authorize-url', A);
  check('Gera link de autorização', String(au.json?.url || '').includes('/oauth/auth?client_id=fake-client'), au.json?.url);

  // A gestão clica no link: o servidor da TOConline devolve o código
  const toc = await fetch(au.json.url, { redirect: 'manual' });
  const loc1 = toc.headers.get('location') || '';
  check('Link devolve o código (302)', toc.status === 302 && loc1.includes('code='), `status=${toc.status} location=${loc1}`);

  // A TOConline redireciona para o callback do sistema, com a sessão da gestão
  const cb = await fetch(loc1, { redirect: 'manual', headers: { cookie: A } });
  const loc2 = cb.headers.get('location') || '';
  check('Retorno grava a autorização e volta para Faturação', loc2.includes('/admin/faturacao?toconline=ok'), `status=${cb.status} location=${loc2}`);

  const st2 = await api('GET', '/api/toconline/status', A);
  check('Status: autorizada', st2.json?.authorized === true, JSON.stringify(st2.json));

  // Ordens concluídas
  const list = await api('GET', '/api/orders', A);
  const done = (list.json?.orders || []).filter((o) => o.status === 'completed');
  const o1 = done[0];
  const o2 = done[1];
  check('Há ordens concluídas para faturar', Boolean(o1 && o2), `concluídas=${done.length}`);

  if (o1) {
    const nif = await api('PATCH', `/api/orders/${o1.id}/details`, A, { customer_nif: '508000111' });
    check('Gestor grava NIF na ordem', nif.status === 200, nif.status);
    const f1 = await api('POST', `/api/orders/${o1.id}/invoice-toc`, A, {});
    check('Emite a fatura FT na TOConline', f1.status === 200 && /^FT 2026\//.test(f1.json?.documentNo || ''), `code=${f1.status} ${f1.json?.documentNo || f1.json?.error}`);
    const after = await api('GET', `/api/orders/${o1.id}`, A);
    check('Número oficial gravado na ordem', after.json?.order?.invoice_number === f1.json?.documentNo && Boolean(after.json?.order?.toc_document_id), after.json?.order?.invoice_number);
    const f2 = await api('POST', `/api/orders/${o1.id}/invoice-toc`, A, {});
    check('Segunda emissão recusada (409)', f2.status === 409, f2.status);
    const c1 = await api('POST', `/api/orders/${o1.id}/invoice-toc`, cust.cookie, {});
    check('Cliente não emite fatura (403)', c1.status === 403, c1.status);
  }
  if (o2) {
    await api('PATCH', `/api/orders/${o2.id}/details`, A, { customer_nif: '' });
    const f3 = await api('POST', `/api/orders/${o2.id}/invoice-toc`, A, {});
    check('Sem NIF não emite (400)', f3.status === 400, `${f3.status} ${f3.json?.error}`);
  }

  // E-mail simulado: reenvio de relatório a um técnico
  const wk = await api('GET', '/api/payouts/weekly', A);
  const hist = (wk.json?.history || []).find((h) => h.technician_id);
  if (hist) {
    const rr = await api('POST', `/api/payouts/${hist.id}/resend-report`, A, {});
    check('Reenvio do relatório aceito', rr.status === 200, rr.status);
  }
  // O envio do e-mail é assíncrono: espera o registro ser gravado
  await new Promise((r) => setTimeout(r, 2000));
  const logs = await api('GET', '/api/admin/email-logs', A);
  const sent = (logs.json?.logs || []).filter((l) => l.status === 'sent');
  check('E-mail registado como enviado (Resend simulado)', sent.length >= 1, `enviados=${sent.length} provedor=${sent[0]?.provider || '-'} erro=${(logs.json?.logs || [])[0]?.error_message || ''}`);

  for (const r of results) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.name} :: ${r.detail}`);
  console.log(`TOTAL ${results.length} OK ${results.filter((r) => r.ok).length}`);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
