// Codex(astra) 최종 감사가 제시한 시험 사례(앱과 리포트 계산이 같은 답을 내는지 포함). 실행: node test/audit-cases.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const pick = (re) => { const m = html.match(re); assert(m, 'not found: ' + re); return m[0]; };
const txBlock = html.slice(html.indexOf('// ── 입출금 알림 거래 ──'), html.indexOf('function getBD(){'));
const src = txBlock + '\n' + [
  /const ACCOUNTS=[^\n]*/, /const sumAcc=[^\n]*/, /const fxSigned=[^\n]*/, /const totFixed=[^\n]*/, /const effectiveBudget=[^\n]*/,
  /const unpaidFixed=[^\n]*/, /const fixedPaidInRange=[^\n]*/, /const usableBal=[^\n]*/, /const totBal=[^\n]*/,
  /function timeToMinutes\(t\)\{[\s\S]*?\n\}/, /function getDailySpent\(dateStr\)\{[\s\S]*?\n\}/, /function sumSpentInRange\(fromStr, toStr\)\{[\s\S]*?\n\}/,
  /const dayAfter=[^\n]*/, /const dayBefore=[^\n]*/,
].map(pick).join('\n');
const TxParse = require('../txparse.js'); globalThis.TxParse = TxParse;
let today = '2026-09-30'; let saved = 0;
const app = new Function('ctx', `with(ctx){let S;${src}
  return{setS:v=>{S=v},getS:()=>S,setTX:v=>{TX=v},sumSpentInRange,applyTxToState,txGaps};}`)({
  toStr: () => today, localStorage: { getItem: () => null, setItem: () => {} }, window: { TxParse }, render: () => {}, save: () => { saved++; },
  escapeHtml: (x) => x, won: (x) => x, document: { getElementById: () => null },
});
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('ok -', n); };
const at = (d, hm) => `${d}T${hm}:00+09:00`;
const base = (extra = {}) => ({ budget: 1000000, budgetStart: '2026-09-25', budgetEnd: '2026-10-24', txSince: '2026-09-25', captures: [], fixed: [], balances: {}, ...extra });

(async () => {
  const calc = await import('../supabase/functions/daily-report/calc.js');
  const both = (S, tx, from, to) => {
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    const a = app.sumSpentInRange(from, to), c = calc.sumSpentInRange(S, from, to, tx);
    assert.strictEqual(a, c, `앱 ${a} ≠ 리포트 ${c}`); return a;
  };

  await t('③ 잔액 없는 거래: 전날 1,000 → 출금 100(잔액 없음) → 출금 100(잔액 800) = 지출 200, 누락 0', async () => {
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 1, balance: 1000, at: at('2026-09-25', '09:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 100, balance: null, at: at('2026-09-26', '09:00') },
      { id: 3, bank: 'kb', type: 'out', amount: 100, balance: 800, at: at('2026-09-26', '10:00') },
    ];
    assert.strictEqual(both(base(), tx, '2026-09-26', '2026-09-26'), 200);
    assert.deepStrictEqual(calc.txGaps(tx), []);
  });

  await t('⑥ 고정비 5만원이 납부 표시만 있고 출금 알림이 없으면 일반 지출 1만원은 그대로', async () => {
    const S = base({ fixed: [{ name: '보험', amount: 50000, paid: true, paidDate: '2026-09-26' }] });
    const tx = [{ id: 1, bank: 'kakao', type: 'out', amount: 10000, balance: 90000, counterparty: '식당', at: at('2026-09-26', '12:00') }];
    assert.strictEqual(both(S, tx, '2026-09-26', '2026-09-26'), 10000);
  });

  await t('⑥-2 고정비와 같은 금액 출금이 있으면 그것만 빼고(한 번만), 나머지 지출은 유지', async () => {
    const S = base({ fixed: [{ name: '보험', amount: 50000, paid: true, paidDate: '2026-09-26' }, { name: '통신', amount: 30000, paid: true, paidDate: '2026-09-26' }] });
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 50000, balance: 950000, counterparty: '보험사', at: at('2026-09-26', '08:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 10000, balance: 940000, counterparty: '식당', at: at('2026-09-26', '12:00') },
    ];
    assert.strictEqual(both(S, tx, '2026-09-26', '2026-09-26'), 10000, '보험 5만 차감, 통신 3만은 출금 없어 차감 안 함');
  });

  await t('② 결제 → 취소(입금) → 같은 금액 재결제(같은 분): 지출 100(환불 반영)', async () => {
    const tx = [
      { id: 1, bank: 'kakao', type: 'out', amount: 100, balance: 900, counterparty: '가게', at: at('2026-09-26', '10:00') },
      { id: 2, bank: 'kakao', type: 'in', amount: 100, balance: 1000, counterparty: '가게', method: '취소', at: at('2026-09-26', '10:00') },
      { id: 3, bank: 'kakao', type: 'out', amount: 100, balance: 900, counterparty: '가게', at: at('2026-09-26', '10:00') },
    ];
    assert.strictEqual(both(base(), tx, '2026-09-26', '2026-09-26'), 100);
  });

  await t('④ 같은 분에 두 거래가 오면 잔액은 뒤 거래(900 → 800)', async () => {
    const S = base({ balances: { kakao: 0, kb: 0 }, balanceAt: {}, balanceTxId: {} });
    app.setS(S);
    app.setTX({ rows: [
      { id: 7, bank: 'kb', type: 'out', amount: 100, balance: 900, at: at('2026-09-26', '10:00') },
      { id: 8, bank: 'kb', type: 'out', amount: 100, balance: 800, at: at('2026-09-26', '10:00') },
    ] });
    app.applyTxToState(null);
    assert.strictEqual(app.getS().balances.kb, 800);
    // 나중에 같은 분 거래가 하나 더(받는 순서가 나중)
    app.setTX({ rows: [
      { id: 7, bank: 'kb', type: 'out', amount: 100, balance: 900, at: at('2026-09-26', '10:00') },
      { id: 8, bank: 'kb', type: 'out', amount: 100, balance: 800, at: at('2026-09-26', '10:00') },
      { id: 9, bank: 'kb', type: 'out', amount: 100, balance: 700, at: at('2026-09-26', '10:00') },
    ] });
    app.applyTxToState();
    assert.strictEqual(app.getS().balances.kb, 700);
  });

  await t('⑧ 받기 실패로 불완전 마감된 주기는 거래를 받으면 다시 계산', async () => {
    const S = base({ budgetStart: '2026-10-25', budgetEnd: '2026-11-24', balances: { kakao: 0, kb: 0 },
      cycles: [{ start: '2026-09-25', end: '2026-10-24', spent: 0, incomplete: true }] });
    app.setS(S);
    app.setTX({ rows: [
      { id: 1, bank: 'kakao', type: 'out', amount: 10000, balance: 90000, counterparty: '가게', at: at('2026-10-20', '12:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 5000, balance: 95000, counterparty: '가게', at: at('2026-10-21', '12:00') },
    ] });
    app.applyTxToState(Date.parse('2026-10-15T00:00:00+09:00')); // 최근 며칠만(주기 시작 뒤부터) 받은 경우 → 확정하면 안 됨
    assert.strictEqual(app.getS().cycles[0].incomplete, true, '일부 범위만 받으면 불완전 유지');
    app.applyTxToState(Date.parse('2026-09-24T00:00:00+09:00')); // 주기 시작 전날부터 전부 받음
    const c = app.getS().cycles[0];
    assert.strictEqual(c.spent, 15000); assert.ok(!c.incomplete);
  });

  await t('⑧-2 불완전 주기가 두 개 연속이면 둘 다(덮는 범위만큼) 다시 계산', async () => {
    const S = base({ budgetStart: '2026-11-25', budgetEnd: '2026-12-24', balances: { kakao: 0, kb: 0 },
      cycles: [{ start: '2026-09-25', end: '2026-10-24', spent: 0, incomplete: true }, { start: '2026-10-25', end: '2026-11-24', spent: 0, incomplete: true }] });
    app.setS(S);
    app.setTX({ rows: [
      { id: 1, bank: 'kakao', type: 'out', amount: 1000, balance: 99000, counterparty: '가', at: at('2026-10-01', '12:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 2000, balance: 98000, counterparty: '나', at: at('2026-11-01', '12:00') },
    ] });
    app.applyTxToState(Date.parse('2026-10-24T00:00:00+09:00')); // 두 번째 주기만 덮음
    assert.strictEqual(app.getS().cycles[0].incomplete, true); assert.ok(!app.getS().cycles[1].incomplete);
    assert.strictEqual(app.getS().cycles[1].spent, 2000);
    app.applyTxToState(Date.parse('2026-09-24T00:00:00+09:00')); // 첫 번째도 덮음
    assert.ok(!app.getS().cycles[0].incomplete); assert.strictEqual(app.getS().cycles[0].spent, 1000);
  });

  await t('누락 감지: 잔액이 안 맞으면 차액만큼(나간 쪽만) 그날 지출로', async () => {
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 1000, balance: 99000, at: at('2026-09-26', '09:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 1000, balance: 93000, at: at('2026-09-26', '12:00') }, // 5,000 누락
      { id: 3, bank: 'kb', type: 'in', amount: 1000, balance: 97000, at: at('2026-09-27', '09:00') }, // 3,000 입금 누락(지출 아님)
    ];
    assert.strictEqual(both(base(), tx, '2026-09-26', '2026-09-27'), 7000);
  });

  console.log(`\n통과 ${ok}개`);
})().catch((e) => { console.error(e); process.exit(1); });
