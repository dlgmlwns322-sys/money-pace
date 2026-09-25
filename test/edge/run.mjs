// Edge Function index.ts를 Deno 흉내로 실제 실행하는 통합 테스트.
// supabase/functions를 임시 폴더에 복사하고 package.json {"type":"module"}로 .js를 ESM으로(Deno와 같게) 만든 뒤,
// Deno.env/Deno.serve, fetch(PostgREST·텔레그램), esm.sh supabase-js를 흉내 낸다.
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import assert from 'node:assert';

const SRC = process.argv[2];
const WORK = process.argv[3];
fs.rmSync(WORK, { recursive: true, force: true });
fs.cpSync(SRC, path.join(WORK, 'functions'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'package.json'), '{"type":"module"}');
// esm.sh supabase-js → 로컬 흉내 모듈
fs.writeFileSync(path.join(WORK, 'sb-stub.mjs'), `export function createClient(){ return globalThis.__sbClient; }`);
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next){
  if (spec.startsWith('https://esm.sh/@supabase/supabase-js')) return { url: ${JSON.stringify('file:///' + path.join(WORK, 'sb-stub.mjs').replace(/\\/g, '/'))}, shortCircuit: true };
  return next(spec, ctx);
}`));

let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('ok -', n); };
const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE', TX_INGEST_SECRET: 'INGEST-KEY', TX_READ_SECRET: 'READ-KEY',
  TELEGRAM_BOT_TOKEN: 'BOT', TELEGRAM_CHAT_ID: '1' };
let handler = null;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

// PostgREST 흉내(tx, tx_unparsed)
const db = { tx: [], tx_unparsed: [], seq: 0, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); db.calls.push({ url, method: init.method || 'GET', headers: init.headers });
  if (url.startsWith('https://proj.supabase.co/rest/v1/')) {
    const h = init.headers || {};
    assert.strictEqual(h.apikey, 'SERVICE', 'service role 키로 호출');
    const u = new URL(url); const table = u.pathname.split('/').pop();
    if ((init.method || 'GET') === 'POST') {
      const row = JSON.parse(init.body);
      if (table === 'tx') {
        if (db.tx.some((r) => r.key === row.key)) return new Response('[]', { status: 201 });
        const rec = { id: ++db.seq, created_at: new Date().toISOString(), ...row, at: new Date(row.at).toISOString().replace('Z', '+00:00') };
        db.tx.push(rec); return new Response(JSON.stringify([{ id: rec.id }]), { status: 201 });
      }
      db.tx_unparsed.push(row); return new Response('', { status: 201 });
    }
    // GET tx?select=...&id=gt.N 또는 created_at=gte.ISO
    const cols = u.searchParams.get('select').split(',');
    let rows = db.tx;
    const idgt = u.searchParams.get('id'); const cgte = u.searchParams.get('created_at'); const bank = u.searchParams.get('bank');
    if (idgt) rows = rows.filter((r) => r.id > Number(idgt.replace('gt.', '')));
    if (cgte) rows = rows.filter((r) => r.created_at >= cgte.replace('gte.', ''));
    if (bank) rows = rows.filter((r) => r.bank === bank.replace('eq.', ''));
    rows = [...rows].sort((a, b) => a.id - b.id);
    if ((u.searchParams.get('order') || '').endsWith('desc')) rows.reverse();
    const lim = Number(u.searchParams.get('limit') || 0); if (lim) rows = rows.slice(0, lim);
    return new Response(JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))), { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};
const dbFetch = globalThis.fetch;

const fn = (name) => 'file:///' + path.join(WORK, 'functions', name, 'index.ts').replace(/\\/g, '/');
const call = (body, headers = {}) => handler(new Request('https://proj.supabase.co/functions/v1/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));

await t('tx-ingest index.ts 로드(ESM·_shared import·TxParse 전역)', async () => {
  await import(fn('tx-ingest'));
  assert.ok(handler, 'Deno.serve 호출됨'); assert.ok(globalThis.TxParse && globalThis.TxParse.parseNotification, 'TxParse 전역 설정');
});
const ingest = handler;
const kakao = { app: 'com.kakao.talk', title: '카카오뱅크', text: '09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원' };
const kb = { app: 'com.kbstar.kbbank', title: '출금 100원', text: '홍*동님 09/25 02:08 123456-**-***789 토스홍길동 오픈뱅킹출금 100 잔액376,715' };

await t('실제 알림 2건 저장, 같은 알림 다시 오면 dup, 키 틀리면 401', async () => {
  handler = ingest;
  let r = await call(JSON.stringify(kakao), { 'x-ingest-secret': 'INGEST-KEY' }); assert.strictEqual(await r.text(), 'ok');
  r = await call(JSON.stringify(kb), { 'x-ingest-secret': 'INGEST-KEY' }); assert.strictEqual(await r.text(), 'ok');
  r = await call(JSON.stringify(kb), { 'x-ingest-secret': 'INGEST-KEY' }); assert.strictEqual(await r.text(), 'dup');
  r = await call(JSON.stringify(kb), { 'x-ingest-secret': 'nope' }); assert.strictEqual(r.status, 401);
  assert.strictEqual(db.tx.length, 2);
  assert.ok(db.tx.every((x) => x.raw && x.key), '원문·키 저장');
});

await t('일반 카톡은 DB 호출조차 안 함, 해석 안 되는 KB 알림은 unparsed', async () => {
  const before = db.calls.length;
  let r = await call(JSON.stringify({ app: 'com.kakao.talk', title: '엄마', text: '밥은?' }), { 'x-ingest-secret': 'INGEST-KEY' });
  assert.strictEqual(await r.text(), 'skip'); assert.strictEqual(db.calls.length, before, 'DB 호출 없음');
  r = await call(JSON.stringify({ app: 'com.kbstar.kbbank', title: '이벤트', text: '포인트' }), { 'x-ingest-secret': 'INGEST-KEY' });
  assert.strictEqual(await r.text(), 'unparsed'); assert.strictEqual(db.tx_unparsed.length, 1);
});

await t('tx-read index.ts: 읽기 키·CORS·원문/계좌 미포함·after/since', async () => {
  handler = null; await import(fn('tx-read')); const read = handler;
  let r = await read(new Request('https://proj.supabase.co/functions/v1/tx-read?after=0', { headers: { 'x-read-secret': 'INGEST-KEY', origin: 'https://dlgmlwns322-sys.github.io' } }));
  assert.strictEqual(r.status, 401, '쓰기 키로는 못 읽음');
  r = await read(new Request('https://proj.supabase.co/functions/v1/tx-read?after=0', { headers: { 'x-read-secret': 'READ-KEY', origin: 'https://dlgmlwns322-sys.github.io' } }));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('access-control-allow-origin'), 'https://dlgmlwns322-sys.github.io');
  const rows = await r.json();
  assert.strictEqual(rows.length, 2); assert.ok(rows.every((x) => !('raw' in x) && !('account' in x) && !('key' in x)));
  assert.ok(rows[0].at.endsWith('+00:00'), 'DB는 UTC 형식으로 돌려줌');
  r = await read(new Request('https://proj.supabase.co/functions/v1/tx-read?after=1', { headers: { 'x-read-secret': 'READ-KEY' } }));
  assert.strictEqual((await r.json()).length, 1);
  r = await read(new Request('https://proj.supabase.co/functions/v1/tx-read', { method: 'OPTIONS', headers: { origin: 'https://dlgmlwns322-sys.github.io' } }));
  assert.strictEqual(r.status, 204); assert.ok(r.headers.get('access-control-allow-headers').includes('x-read-secret'));
  globalThis.__rowsForApp = rows;
});

await t('daily-report index.ts: 알람 시각 전엔 전체 조회 안 함, 발송 시각엔 거래 포함 계산·전송', async () => {
  const sent = []; const queries = [];
  const S = { alarmTime: '00:00', budget: 1000000, weeklyBudget: 250000, budgetStart: '2026-09-25', budgetEnd: '2026-10-24',
    txSince: '2026-09-26', ownerNames: '홍길동', balances: { kakao: 235300, kb: 376715 }, captures: [], fixed: [], memos: {} };
  const q = (table) => {
    const st = { table, sel: null, filters: [] };
    const api = {
      select(s) { st.sel = s; return api; }, eq(a, b) { st.filters.push(['eq', a, b]); return api; }, gte(a, b) { st.filters.push(['gte', a, b]); return api; },
      order() { return api; }, limit() { return api; },
      insert() { queries.push({ table, op: 'insert' }); return Promise.resolve({ error: null }); },
      delete() { return { eq: () => Promise.resolve({}) }; },
      single() { queries.push({ table, sel: st.sel }); return Promise.resolve(st.sel.startsWith('alarm') ? { data: { alarm: S.alarmTime } } : { data: { data: S } }); },
      then(res, rej) { queries.push({ table, sel: st.sel, filters: st.filters }); return Promise.resolve({ data: globalThis.__rowsForApp.map((r) => ({ ...r, id: r.id })), error: null }).then(res, rej); },
    };
    return api;
  };
  globalThis.__sbClient = { from: q };
  globalThis.fetch = async (url, init) => { if (String(url).includes('api.telegram.org')) { sent.push(JSON.parse(init.body).text); return new Response('{}'); } throw new Error('unexpected ' + url); };
  handler = null; await import(fn('daily-report')); const report = handler;
  // 알람 시각과 다르면(현재 KST 시각으로 비교) 알람만 조회
  S.alarmTime = '25:99';
  let r = await report(new Request('https://x')); assert.strictEqual(await r.text(), 'not time yet');
  assert.ok(queries.every((x) => x.sel && x.sel.startsWith('alarm')), '알람만 조회');
  // 지금 시각으로 맞춰 발송
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  S.alarmTime = now;
  r = await report(new Request('https://x')); const txt = await r.text();
  assert.strictEqual(txt, 'sent', txt);
  assert.ok(queries.some((x) => x.table === 'tx' && x.sel.includes('balance') && !x.sel.includes('raw')), '거래는 필요한 칼럼만');
  assert.strictEqual(sent.length, 1); assert.ok(sent[0].includes('머니페이스 일일 리포트'));
  console.log('   리포트 미리보기:', sent[0].split('\n').slice(0, 4).join(' / '));
});

await t('② 결제→취소→같은 금액 재결제(같은 분): 3건 모두 저장, 같은 알림 재전송은 dup', async () => {
  globalThis.fetch = dbFetch; handler = ingest;
  const k = (type, bal) => ({ app: 'com.kakao.talk', title: '카카오뱅크', text: `09/26 10:00
${type === 'in' ? '취소' : '출금'} 100원
${type === 'in' ? '가게 → 입출금통장(0000)' : '입출금통장(0000) → 가게'}
잔액 ${bal}원` });
  const before = db.tx.length;
  const send = async (n) => (await call(JSON.stringify(n), { 'x-ingest-secret': 'INGEST-KEY' })).text();
  assert.strictEqual(await send(k('out', '900')), 'ok');
  assert.strictEqual(await send(k('out', '900')), 'dup', '같은 알림 두 번');
  assert.strictEqual(await send(k('in', '1,000')), 'ok');
  assert.strictEqual(await send(k('out', '900')), 'ok', '취소 뒤 재결제는 새 거래');
  assert.strictEqual(await send(k('out', '900')), 'dup', '재결제 알림이 두 번 온 것');
  assert.strictEqual(db.tx.length - before, 3);
});

await t('① 501건: tx-read가 500건씩 since+after로 끝까지', async () => {
  handler = null; await import(fn('tx-read') + '?v2'); const read = handler;
  const start = db.seq;
  for (let i = 0; i < 501; i++) db.tx.push({ id: ++db.seq, created_at: new Date().toISOString(), key: 'k' + i, bank: 'kb', type: 'out', amount: 1, balance: 1, at: '2026-09-26T00:00:00+00:00' });
  const since = encodeURIComponent(new Date(Date.now() - 86400e3).toISOString());
  let got = [], after = null;
  for (let p = 0; p < 5; p++) {
    const q = after == null ? `since=${since}` : `since=${since}&after=${after}`;
    const r = await read(new Request(`https://proj.supabase.co/functions/v1/tx-read?${q}`, { headers: { 'x-read-secret': 'READ-KEY' } }));
    const part = await r.json(); got.push(...part); if (part.length < 500) break; after = part[part.length - 1].id;
  }
  const ids = new Set(got.map((x) => x.id));
  for (let id = start + 1; id <= db.seq; id++) assert.ok(ids.has(id), 'id ' + id + ' 누락');
});

globalThis.fetch = realFetch;
console.log(`\n통과 ${ok}개 (Edge Function 실제 실행)`);
