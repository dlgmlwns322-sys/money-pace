// 무작위 대량 시험: 금액·잔액이 여러 자리수로 바뀌어도, 알림이 두 번 오거나 순서가 섞여도,
// 알림 원문 → 실제 tx-ingest(index.ts) → DB → tx-read(index.ts) → 계산(calc.js)까지 숫자가 정확히 맞는지.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const SRC = process.argv[2], WORK = process.argv[3], SEED = Number(process.argv[4] || 1);
fs.rmSync(WORK, { recursive: true, force: true });
fs.cpSync(SRC, path.join(WORK, 'functions'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'package.json'), '{"type":"module"}');

// 재현 가능한 난수
let s = SEED >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pickN = (a) => a[Math.floor(rnd() * a.length)];
const comma = (n) => n.toLocaleString('en-US');

const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'SR', TX_INGEST_SECRET: 'IN', TX_READ_SECRET: 'RD' };
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const db = { tx: [], seq: 0, unparsed: 0 };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const table = u.pathname.split('/').pop();
  if ((init.method || 'GET') === 'POST') {
    const row = JSON.parse(init.body);
    if (table === 'tx_unparsed') { db.unparsed++; return new Response('', { status: 201 }); }
    if (db.tx.some((r) => r.key === row.key)) return new Response('[]', { status: 201 });
    const rec = { id: ++db.seq, created_at: new Date().toISOString(), ...row, at: new Date(row.at).toISOString().replace('Z', '+00:00') };
    db.tx.push(rec); return new Response(JSON.stringify([{ id: rec.id }]), { status: 201 });
  }
  const cols = u.searchParams.get('select').split(','); const idgt = u.searchParams.get('id'); const bank = u.searchParams.get('bank');
  let rows = db.tx; if (idgt) rows = rows.filter((r) => r.id > Number(idgt.replace('gt.', '')));
  if (bank) rows = rows.filter((r) => r.bank === bank.replace('eq.', ''));
  rows = [...rows].sort((a, b) => a.id - b.id);
  if ((u.searchParams.get('order') || '').endsWith('desc')) rows.reverse();
  const lim = Number(u.searchParams.get('limit') || 0); if (lim) rows = rows.slice(0, lim);
  return new Response(JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))), { status: 200 });
};
const fn = (n) => 'file:///' + path.join(WORK, 'functions', n, 'index.ts').replace(/\\/g, '/');
await import(fn('tx-ingest')); const ingest = handler;
await import(fn('tx-read')); const read = handler;
const calc = createRequire(import.meta.url)('../calc-shim.js'); // 옛 서버 계산 자리(앱 코드로 계산, 2026-09-26)

// ── 무작위 거래 만들기 (잔액이 앞뒤로 맞게) ──
const AMOUNTS = [1, 7, 99, 100, 999, 1000, 4500, 12345, 99999, 100000, 1234567, 9999999, 50000000, 123456789, 2000000000];
const bal = { kakao: 3000000, kb: 5000000 };
const truth = []; // 실제 거래(정답)
// 실제 알림처럼 '지금'까지 끝나게: 약 12일 전부터 시작
let t0 = Date.now() - 400 * 46 * 60e3;
const others = ['스타벅스', '편의점 GS25', 'CU 난바점', '회사(급여)', '김 철수', '토스홍길동', '홍길동', '쿠팡(주)', 'A→B상사'];
for (let i = 0; i < 400; i++) {
  const bank = rnd() < 0.5 ? 'kakao' : 'kb';
  let type = rnd() < 0.7 ? 'out' : 'in';
  let amount = rnd() < 0.3 ? pickN(AMOUNTS) : Math.max(1, Math.floor(rnd() * 300000));
  if (type === 'out' && amount > bal[bank]) type = 'in';
  bal[bank] += type === 'in' ? amount : -amount;
  t0 += Math.floor(rnd() * 90 + 1) * 60e3; // 1~90분 뒤
  let cp = pickN(others); if (cp.includes('→')) cp = 'AB상사';
  truth.push({ bank, type, amount, balance: bal[bank], counterparty: cp, at: new Date(t0) });
}

// ── 은행 알림 원문으로 바꾸기 (실제 형식) ──
const kst = (d) => { const k = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return { md: `${p(k.getUTCMonth() + 1)}/${p(k.getUTCDate())}`, hm: `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}` }; };
function toNotification(x) {
  const { md, hm } = kst(x.at);
  if (x.bank === 'kakao') {
    const flow = x.type === 'in' ? `${x.counterparty} → 입출금통장(0000)` : `입출금통장(0000) → ${x.counterparty}`;
    return { app: 'com.kakao.talk', title: '카카오뱅크', text: `${md} ${hm}\n${x.type === 'in' ? '입금' : '출금'} ${comma(x.amount)}원\n${flow}\n잔액 ${comma(x.balance)}원` };
  }
  const word = x.type === 'in' ? '입금' : '출금';
  return { app: 'com.kbstar.kbbank', title: `${word} ${comma(x.amount)}원`, text: `홍*동님 ${md} ${hm} 123456-**-***789 ${x.counterparty.replace(/\s/g, '')} ${x.type === 'in' ? '급여' : '체크카드'} ${comma(x.amount)} 잔액${comma(x.balance)}` };
}

// ── 보내기: 순서 일부 섞기, 20%는 두 번, 형식(JSON·줄바꿈 날것·폼) 무작위 ──
const sends = truth.map((x, i) => ({ i, n: toNotification(x) }));
for (let i = 0; i < sends.length - 1; i++) if (rnd() < 0.15) [sends[i], sends[i + 1]] = [sends[i + 1], sends[i]];
const queue = [];
for (const sd of sends) { queue.push(sd); if (rnd() < 0.2) queue.push(sd); }
const results = { ok: 0, dup: 0, other: [] };
for (const sd of queue) {
  const mode = pickN(['json', 'rawjson', 'form']);
  let body, ct = 'application/json';
  if (mode === 'json') body = JSON.stringify(sd.n);
  else if (mode === 'rawjson') body = `{"app":"${sd.n.app}","title":"${sd.n.title}","text":"${sd.n.text}","big":"${sd.n.text}"}`;
  else { body = new URLSearchParams({ ...sd.n, big: sd.n.text }).toString(); ct = 'application/x-www-form-urlencoded'; }
  const r = await ingest(new Request('https://p/functions/v1/tx-ingest', { method: 'POST', headers: { 'content-type': ct, 'x-ingest-secret': 'IN' }, body }));
  const txt = await r.text();
  if (txt === 'ok') results.ok++; else if (txt === 'dup') results.dup++; else results.other.push([sd.i, mode, r.status, txt]);
}
assert.deepStrictEqual(results.other, [], '모든 알림이 ok 또는 dup');
assert.strictEqual(results.ok, truth.length, `저장 ${results.ok} = 실제 ${truth.length}`);
assert.strictEqual(db.unparsed, 0);

// ── 읽기(앱처럼 페이지 넘기며) ──
let got = [], after = 0;
for (;;) {
  const r = await read(new Request(`https://p/functions/v1/tx-read?after=${after}`, { headers: { 'x-read-secret': 'RD' } }));
  const page = await r.json(); if (!page.length) break; got.push(...page); after = page[page.length - 1].id;
  if (page.length < 500) break;
}
assert.strictEqual(got.length, truth.length);

// ── 거래 하나하나 정답과 비교 ──
const key = (x) => `${x.bank}|${x.type}|${x.amount}|${x.balance}|${new Date(x.at).getTime()}`;
const truthKeys = new Set(truth.map((x) => key({ ...x, at: new Date(Math.floor(x.at.getTime() / 60000) * 60000) })));
for (const r of got) assert.ok(truthKeys.has(key(r)), '정답에 없는 거래: ' + JSON.stringify(r));

// ── 계산: 잔액 연결이 모두 맞으면 누락 0, 지출 = 출금 합(이동·환불 없음 조건) ──
// 가계부 날짜(새벽 6시 시작) 기준 — 실행 시각에 따라 첫·마지막 거래가 새벽이면 전날로 들어간다
const ledgerDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d.getTime() - 6 * 3600e3));
const firstDay = ledgerDay(truth[0].at);
const S = { budget: 1e9, budgetStart: firstDay, budgetEnd: '2099-12-31', txSince: firstDay, captures: [], fixed: [], balances: {} };
assert.deepStrictEqual(calc.txGaps(got, S), [], '잔액 연결이 모두 맞으면 누락 없음');
const lastDay = ledgerDay(truth[truth.length - 1].at);
const expectedOut = truth.filter((x) => x.type === 'out' && !['토스홍길동', '홍길동'].includes(x.counterparty)).reduce((a, x) => a + x.amount, 0);
const spent = calc.sumSpentInRange({ ...S, ownerNames: '' }, firstDay, lastDay, got);
const allOut = truth.filter((x) => x.type === 'out').reduce((a, x) => a + x.amount, 0);
assert.strictEqual(spent, allOut, `이름 설정 없으면 지출 = 모든 출금 합 (${spent} vs ${allOut})`);
// 거래 몇 건을 일부러 빼면 누락이 정확히 그 금액만큼 잡힌다
const drop = got.filter((r, i) => i % 37 === 5);
const kept = got.filter((r) => !drop.includes(r));
const gapSum = calc.txGaps(kept, S).reduce((a, g) => a + g.amount, 0);
const dropNet = drop.reduce((a, r) => a + (r.type === 'out' ? r.amount : -r.amount), 0);
const lastPerBank = (rows, b) => rows.filter((r) => r.bank === b).sort((x, y) => x.id - y.id).pop();
// 은행별 첫 거래(비교할 앞 잔액이 없음)·마지막 거래(비교할 뒤 잔액이 없음)가 빠진 것은 원리상 감지할 수 없어 제외
const keptFirstId = (b) => kept.filter((r) => r.bank === b).sort((x, y) => x.id - y.id)[0]?.id ?? Infinity;
const undetectable = drop.filter((r) => ['kakao', 'kb'].some((b) => r.bank === b && (lastPerBank(got, b).id === r.id || r.id < keptFirstId(b))));
const undetNet = undetectable.reduce((a, r) => a + (r.type === 'out' ? r.amount : -r.amount), 0);
assert.strictEqual(gapSum, dropNet - undetNet, `빠진 ${drop.length}건 순액 ${dropNet} = 감지 ${gapSum}(은행별 맨 앞·맨 뒤 제외 ${undetectable.length}건)`);
console.log(`seed ${SEED}: 거래 ${truth.length}건(금액 1원~20억), 보낸 알림 ${queue.length}건(중복 ${results.dup}), 모두 정확히 저장·읽기, 지출 ${spent.toLocaleString()}원 일치, 누락 ${drop.length}건 감지 정확`);
