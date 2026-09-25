// 끝에서 끝까지(알림 → tx-ingest → tx-read → 앱 계산). 실행: node test/edge/e2e.mjs <supabase/functions 경로> <임시 폴더>
// (서버 흉내 준비는 run.mjs와 같다)
// supabase/functions를 임시 폴더에 복사하고 package.json {"type":"module"}로 .js를 ESM으로(Deno와 같게) 만든 뒤,
// Deno.env/Deno.serve, fetch(PostgREST·텔레그램), esm.sh supabase-js를 흉내 낸다.
import fs from 'node:fs';
import path from 'node:path';
import { register, createRequire } from 'node:module';
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
const db = { tx: [], tx_unparsed: [], card_hint: [], seq: 0, hseq: 0, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); db.calls.push({ url, method: init.method || 'GET', headers: init.headers });
  if (url.startsWith('https://proj.supabase.co/rest/v1/')) {
    const h = init.headers || {};
    assert.strictEqual(h.apikey, 'SERVICE', 'service role 키로 호출');
    const u = new URL(url); const table = u.pathname.split('/').pop();
    if ((init.method || 'GET') === 'POST') {
      const row = JSON.parse(init.body);
      if (table === 'ingest_heartbeat') {
        assert.ok(u.searchParams.get('on_conflict') === 'id' && /merge-duplicates/.test(h.Prefer), '한 행 덮어쓰기');
        db.hb = row; return new Response('', { status: 201 });
      }
      if (table === 'card_hint') {
        if (!db.card_hint.some((r) => r.key === row.key)) db.card_hint.push({ id: ++db.hseq, created_at: new Date().toISOString(), ...row });
        return new Response('', { status: 201 });
      }
      if (table === 'tx') {
        if (db.tx.some((r) => r.key === row.key)) return new Response('[]', { status: 201 });
        const rec = { id: ++db.seq, created_at: new Date().toISOString(), ...row, at: new Date(row.at).toISOString().replace('Z', '+00:00') };
        db.tx.push(rec); return new Response(JSON.stringify([{ id: rec.id }]), { status: 201 });
      }
      db.tx_unparsed.push({ created_at: new Date().toISOString(), ...row }); return new Response('', { status: 201 });
    }
    if (table === 'ingest_heartbeat') return new Response(JSON.stringify(db.hb ? [{ at: db.hb.at }] : []), { status: 200 });
    if (table === 'tx_unparsed') {
      const gte = (u.searchParams.get('created_at') || '').replace('gte.', '');
      const list = db.tx_unparsed.filter((r) => (r.created_at || '9') >= gte).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      assert.ok(/count=exact/.test(h.Prefer || ''), '개수는 count=exact로');
      return new Response(JSON.stringify(list.slice(0, 1).map((r) => ({ created_at: r.created_at }))), { status: 200, headers: { 'content-range': list.length ? `0-0/${list.length}` : '*/0' } });
    }
    // GET tx?select=...&id=gt.N 또는 created_at=gte.ISO
    const cols = u.searchParams.get('select').split(',');
    let rows = table === 'card_hint' ? db.card_hint : db.tx;
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

let handlerTmp;
await import(fn('tx-ingest')); const ingest = handler;

// ── 끝에서 끝까지: 실제 형식의 알림을 tx-ingest로 보내고 → tx-read로 읽어 → 앱이 월급 주기·저축·고정지출을 계산 ──
globalThis.fetch = dbFetch; handler = ingest;
const send = async (n) => (await call(JSON.stringify(n), { 'x-ingest-secret': 'INGEST-KEY' })).text();
const kakao = (text) => ({ app: 'com.kakao.talk', title: '카카오뱅크', text, big: text });
const kb = (title, text) => ({ app: 'com.kbstar.kbbank', title, text, big: text });
const results = {};
results.first = await send(kakao('09/20 12:00\n출금 1,000원\n입출금통장(0000) → 편의점\n잔액 500,000원'));
results.kbFirst = await send(kb('출금 12,000원', '홍*동님 09/20 13:00 123456-**-***789 식당 체크카드출금 12,000 잔액1,000,000'));
results.salary = await send(kakao('09/23 09:00\n입금 3,100,000원\n급여 → 입출금통장(0000)\n잔액 3,600,000원'));
results.salaryDup = await send(kakao('09/23 09:00\n입금 3,100,000원\n급여 → 입출금통장(0000)\n잔액 3,600,000원'));
results.expense = await send(kakao('09/23 15:00\n입금 850,000원\n오피엠에스 → 입출금통장(0000)\n잔액 4,450,000원'));
results.card = await send(kakao('09/24 00:09\n카드 결제 600원\n체크카드(0000) | 더 까까주까\n잔액 4,449,400원\n\n이번달 총 이용금액과 캐시백은 얼마?\n카드 이용내역에서 확인해보세요!⬇️'));
results.savings = await send(kakao('09/24 10:00\n출금 300,000원\n입출금통장(0000) → 홍길동\n잔액 4,149,400원'));
results.fixed = await send(kb('출금 55,000원', '홍*동님 09/24 09:00 123456-**-***789 케이티모바일 자동이체 55,000 잔액945,000'));
results.truncated = await send({ app: 'com.kbstar.kbbank', title: '출금 5,000원', text: '홍*동님 09/25 19:29 123456-**-***789 이니시스( 체크카드출금 5,000 잔액940,...' });
results.kbPay = await send({ app: 'com.kbcard.cxh.appcard', title: 'KB Pay', text: '[KB Pay 사용 알림] 체크 0000 09/25 19:29 5,000원 쿤자PC방 승인' });
results.chat = await send({ app: 'com.kakao.talk', title: '친구', text: '밥 먹었어?' });
results.heartbeat = await send({ kind: 'heartbeat' });

await t('알림 보내기: 은행 알림만 거래로 저장, 같은 알림은 한 번, KB Pay는 가게 이름 힌트만, 일반 카톡은 버림, 생존 신호', async () => {
  assert.deepStrictEqual(results, { first: 'ok', kbFirst: 'ok', salary: 'ok', salaryDup: 'dup', expense: 'ok', card: 'ok', savings: 'ok', fixed: 'ok',
    truncated: 'ok', kbPay: 'hint', chat: 'skip', heartbeat: 'alive' });
  assert.strictEqual(db.tx.length, 8); assert.strictEqual(db.card_hint.length, 1);
});

handler = null; await import(fn('tx-read') + '?e2e'); const read = handler;
const since = encodeURIComponent(new Date(Date.parse('2026-09-19T00:00:00+09:00')).toISOString());
const rr = await read(new Request(`https://proj.supabase.co/functions/v1/tx-read?since=${since}`, { headers: { 'x-read-secret': 'READ-KEY' } }));
const rows = await rr.json();
const hints = await (await read(new Request('https://proj.supabase.co/functions/v1/tx-read?hints=1&after=0', { headers: { 'x-read-secret': 'READ-KEY' } }))).json();

await t('읽어 온 거래: 잘린 잔액은 비움, 새벽 00:09 결제는 23일 가계부', async () => {
  const tr = rows.find((r) => r.amount === 5000);
  assert.strictEqual(tr.balance, null, '잘린 미리보기 잔액 버림');
  assert.strictEqual(rows.find((r) => r.amount === 600).counterparty, '더 까까주까');
});

await t('앱: "급여" 310만 입금으로 9/23 새 주기(종료 10/22), 개인경비 85만은 월급 아님, 저축·통신비 자동 체크', async () => {
  const makeApp = createRequire(import.meta.url)('../app.js');
  const app = makeApp({ now: '2026-09-26T12:00:00+09:00' });
  const S = { budget: 1000000, budgetStart: '2026-08-25', budgetEnd: '2026-09-24', ownerNames: '홍길동', payer: '오피엠에스', payDay: 25,
    fixed: [{ id: 'm', name: '통신', kw: '모바일', amount: 55000, paid: false, paidDate: '' }] };
  app.set({ S, TX: { rows, hints } });
  app.fn.applyTxToState(null);
  assert.strictEqual(S.budgetStart, '2026-09-23'); assert.strictEqual(S.budgetEnd, '2026-10-22');
  assert.strictEqual(S.salaryAmount, 3100000, '"급여"로 들어온 310만');
  assert.strictEqual(S.carry, 945000, '지난 주기: 100만 − 고정 5.5만 − 지출 0');
  assert.strictEqual(S.budget, 3100000 + 945000);
  assert.ok(S.fixed[0].paid && S.fixed[0].actual === 55000, '통신비 자동 체크');
  assert.strictEqual(app.fn.cycleSavings(), 300000, '본인 이름 30만 = 저축');
  assert.strictEqual(app.fn.effectiveBudget(), 3100000 + 945000 - 55000 - 300000);
  assert.strictEqual(app.fn.totSpent(), 600 + 5000, '카드 600 + 잘린 알림 5천(통신비·저축·경비 입금은 지출 아님)');
  const pg = app.fn.txWithFlags().find((r) => r.amount === 5000);
  assert.strictEqual(pg.merchant, '쿤자PC방', 'KB Pay 알림의 실제 가게 이름이 통장 출금(이니시스)에 붙음');
  assert.strictEqual(app.fn.txCategory(pg), '피시방');
  assert.strictEqual(app.fn.cycleCategoryTotals().out['피시방'], 5000);
  const notes = app.fn.computeNotices().map((n) => n.id.split('-')[0]);
  assert.ok(notes.includes('salnew') && !notes.includes('salpick'), '새 주기 안내, 월급 선택 질문 없음');
});

globalThis.fetch = realFetch;
console.log(`\n통과 ${ok}개 (알림 → 저장 → 읽기 → 앱 계산)`);
