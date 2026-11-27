// Testes: cancelamento depois de aceite, visibilidade do técnico e restauração em duas etapas.
// Uso: node test-v7.mjs A  (cancelamento, visibilidade, cópia e restauração em espera)
//      node test-v7.mjs C  (depois do reinício: a restauração foi aplicada)
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
const phase = process.argv[2] || 'A';
const out = [];
const check = (name, ok, detail = '') => out.push({ name, ok: Boolean(ok), detail: String(detail) });
const DIR = path.resolve(process.cwd(), '..');

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'Confianca2026!' }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function api(method, p, cookie, body, extra = {}) {
  const r = await fetch(`${BASE}${p}`, { method, headers: { ...H, cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* sem JSON */ }
  return { status: r.status, json };
}

(async () => {
  const A = await login('diego@confiancamanutencao.com');
  const C = await login('maria@cliente.pt');
  const T = await login('joao@confiancamanutencao.com');

  if (phase === 'A') {
    // ---- Visibilidade do técnico ----
    const vis0 = await api('GET', '/api/settings/visibility', T);
    check('Técnico vê se pode ver repasses (padrão: sim)', vis0.json?.techSeesPayouts === true, JSON.stringify(vis0.json));
    const off = await api('PUT', '/api/business-parameters/tech_sees_payouts', A, { value: 0, effective_from: new Date().toISOString().slice(0, 10), reason: 'Teste: esconder repasses' });
    check('Gestão desliga a visibilidade', off.status === 200, off.status);
    const w = await api('GET', '/api/payouts/weekly', T);
    check('Com a visibilidade desligada, repasses dão 403 ao técnico', w.status === 403, w.status);
    const ib = await api('PATCH', '/api/profile', T, { iban: 'PT50000000000000000000000' });
    check('Com a visibilidade desligada, o técnico não altera o IBAN (403)', ib.status === 403, ib.status);
    const on = await api('PUT', '/api/business-parameters/tech_sees_payouts', A, { value: 1, effective_from: new Date().toISOString().slice(0, 10), reason: 'Teste: voltar a mostrar' });
    check('Regra: segunda alteração no mesmo dia é recusada (409), para proteger o histórico', on.status === 409, on.status);
    const onNext = await api('PUT', '/api/business-parameters/tech_sees_payouts', A, { value: 1, effective_from: new Date(Date.now() + 864e5).toISOString().slice(0, 10), reason: 'Teste: religar amanhã' });
    check('Religar com vigência futura é aceito (200)', onNext.status === 200, onNext.status);

    // ---- Cancelamento depois de aceite ----
    const cat = (await api('GET', '/api/catalog', C)).json?.catalog?.[0];
    const mk = async (tag) => (await api('POST', '/api/orders', C, { catalog_id: cat.id, service_address: `Rua cancel ${tag}, Lisboa`, scheduled_at: new Date(Date.now() + 5 * 864e5).toISOString(), appliance_type: 'Outro' })).json.order;

    const o1 = await mk('1');
    const acc1 = await api('PATCH', `/api/orders/${o1.id}`, T, { status: 'accepted' });
    check('Técnico aceita a ordem de teste', acc1.status === 200, acc1.status);
    const c1 = await api('POST', `/api/orders/${o1.id}/cancel`, C, {});
    check('Cliente cancela ordem já aceite (200)', c1.status === 200 && c1.json?.order?.status === 'cancelled', c1.status);
    check('Com 0% o técnico recebe 0 € no cancelamento', c1.json?.technicianPayout === 0, c1.json?.technicianPayout);

    const pct = await api('PUT', '/api/business-parameters/cancel_after_accept_tech_pct', A, { value: 40, effective_from: new Date().toISOString().slice(0, 10), reason: 'Teste: 40% no cancelamento' });
    check('Gestão define 40% para cancelamento depois de aceite', pct.status === 200, pct.status);
    const o2 = await mk('2');
    await api('PATCH', `/api/orders/${o2.id}`, T, { status: 'accepted' });
    const before = await api('GET', '/api/payouts/by-technician', A);
    const jb = before.json.technicians.find((t) => t.technicianId === 'user-tech-joao');
    const c2 = await api('POST', `/api/orders/${o2.id}/cancel`, C, {});
    const after = await api('GET', '/api/payouts/by-technician', A);
    const ja = after.json.technicians.find((t) => t.technicianId === 'user-tech-joao');
    const fee = Number(c2.json?.order?.service_fee || 0);
    check('Com 40% o técnico recebe 40% da taxa de serviço', Math.abs(c2.json?.technicianPayout - Math.round(0.4 * fee * 100) / 100) < 0.01, `pago=${c2.json?.technicianPayout} taxa=${fee}`);
    check('Cancelamento com valor entra na previsão do técnico', ja && jb && ja.aLiberar > jb.aLiberar, `antes=${jb?.aLiberar} depois=${ja?.aLiberar}`);
    const c3 = await api('POST', `/api/orders/${o2.id}/cancel`, C, {});
    check('Segundo cancelamento da mesma ordem é recusado (400)', c3.status === 400, c3.status);
    const cn = await api('POST', `/api/orders/${o1.id}/cancel`, T, {});
    check('Técnico não cancela pelo cliente (403)', cn.status === 403, cn.status);
    await api('PUT', '/api/business-parameters/cancel_after_accept_tech_pct', A, { value: 0, effective_from: new Date().toISOString().slice(0, 10), reason: 'Teste: voltar a 0%' });

    // ---- Restauração em duas etapas ----
    const dl = await fetch(`${BASE}/api/admin/backup/database`, { headers: { cookie: A } });
    const bytes = Buffer.from(await dl.arrayBuffer());
    const copyFile = path.join(DIR, 'cópia-para-restauro.db');
    fs.writeFileSync(copyFile, bytes);
    check('Baixa a cópia da base atual', dl.status === 200 && bytes.length > 1000, `bytes=${bytes.length}`);

    const apt = (await api('GET', '/api/appliance-types?all=1', A)).json.appliance_types.find((x) => x.name === 'Outro');
    const ren = await api('PATCH', `/api/appliance-types/${apt.id}`, A, { name: 'Outro (depois da cópia)' });
    check('Muda um dado depois da cópia (marcador de teste)', ren.status === 200, ren.status);

    const txt = await fetch(`${BASE}/api/admin/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'XMLHttpRequest', 'X-Restore-Confirm': 'RESTAURAR', cookie: A }, body: 'isto não é uma base' });
    check('Arquivo que não é base SQLite é recusado (400)', txt.status === 400, txt.status);
    const noWord = await fetch(`${BASE}/api/admin/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'XMLHttpRequest', cookie: A }, body: bytes });
    check('Sem a palavra RESTAURAR a restauração é recusada (400)', noWord.status === 400, noWord.status);
    const staged = await fetch(`${BASE}/api/admin/backup/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'XMLHttpRequest', 'X-Restore-Confirm': 'RESTAURAR', cookie: A }, body: bytes });
    const sj = await staged.json();
    check('Cópia válida fica em espera e a base atual é guardada', staged.status === 200 && sj.staged === true && sj.previousBackup, JSON.stringify(sj));
    const stillChanged = await api('GET', '/api/appliance-types?all=1', A);
    check('Antes do reinício, a base ainda é a atual (marcador presente)', stillChanged.json.appliance_types.some((x) => x.name === 'Outro (depois da cópia)'), '');
    console.log(JSON.stringify({ phase: 'A', copyFile }));
  } else {
    const aplicados = await api('GET', '/api/appliance-types?all=1', A);
    check('Depois do reinício, a cópia foi aplicada (marcador antigo volta)', aplicados.json?.appliance_types?.some((x) => x.name === 'Outro'), '');
    check('Depois do reinício, o marcador de depois da cópia sumiu', !aplicados.json?.appliance_types?.some((x) => x.name === 'Outro (depois da cópia)'), '');
  }

  for (const r of out) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.name} :: ${r.detail}`);
  console.log(`TOTAL ${out.length} OK ${out.filter((r) => r.ok).length}`);
})().catch((e) => { console.error('ERRO', e); process.exit(1); });
