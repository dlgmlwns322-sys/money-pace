// 가계부 하루 = 새벽 6시 ~ 다음 날 새벽 6시(2026-09-25 사용자 요청). 실행: node test/daystart.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
let nowMs = Date.parse('2026-09-24T12:00:00+09:00');
const makeApp = require('./app');
const A = makeApp({ nowFn: () => nowMs });
// 예전 조각 추출 대신 앱 전체(test/app.js)를 쓴다. 테스트 코드는 그대로 두려고 같은 이름으로 연결.
const app = { setS: (v) => A.set({ S: v }), getS: () => A.S, setTX: (v) => A.set({ TX: v }), ...A.fn };
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('ok -', n); };
const at = (d, hm) => `${d}T${hm}:00+09:00`;
const base = (extra = {}) => ({ budget: 1000000, budgetStart: '2026-09-20', budgetEnd: '2026-10-19', txSince: '2026-09-21', captures: [], fixed: [], balances: {}, ...extra });

(async () => {
  const calc = require('./calc-shim'); // 옛 서버 계산 자리(앱 코드로 계산)
  await t('오늘 날짜: 24일 새벽 5:59까지는 23일, 6:00부터 24일', async () => {
    nowMs = Date.parse(at('2026-09-24', '05:59')); assert.strictEqual(app.toStr(), '2026-09-23');
    nowMs = Date.parse(at('2026-09-24', '06:00')); assert.strictEqual(app.toStr(), '2026-09-24');
    nowMs = Date.parse(at('2026-09-24', '00:30')); assert.strictEqual(app.toStr(), '2026-09-23');
    nowMs = Date.parse(at('2026-10-01', '03:00')); assert.strictEqual(app.toStr(), '2026-09-30', '달이 바뀌는 새벽도 전날(전달)');
  });
  await t('거래 날짜: 새벽 3시 결제는 전날, 서버 계산도 같음', async () => {
    for (const [a, d] of [[at('2026-09-24', '03:30'), '2026-09-23'], [at('2026-09-24', '05:59'), '2026-09-23'], [at('2026-09-24', '06:00'), '2026-09-24'], ['2026-09-23T20:30:00Z', '2026-09-23']]) {
      assert.strictEqual(app.txDate(a), d, a); assert.strictEqual(calc.txDate(a), d, 'calc ' + a);
    }
  });
  await t('23일 밤 11시 5만 + 24일 새벽 3시 5만 = 23일 지출 10만, 24일 0원(앱=리포트)', async () => {
    nowMs = Date.parse(at('2026-09-24', '12:00'));
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 1, balance: 1000000, at: at('2026-09-22', '12:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 50000, balance: 950000, counterparty: '술집', at: at('2026-09-23', '23:00') },
      { id: 3, bank: 'kb', type: 'out', amount: 50000, balance: 900000, counterparty: '편의점', at: at('2026-09-24', '03:00') },
    ];
    const S = base();
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    for (const [d, want] of [['2026-09-23', 100000], ['2026-09-24', 0]]) {
      const a = app.sumSpentInRange(d, d), c = calc.sumSpentInRange(S, d, d, tx);
      assert.strictEqual(a, want, `${d} 앱 ${a}`); assert.strictEqual(c, want, `${d} 리포트 ${c}`);
    }
    assert.deepStrictEqual(calc.txGaps(tx), [], '경계 넘는 연속 거래에 누락 오탐 없음');
  });
  await t('캡처 순서: 모두 실제 시각으로(새 캡처 at, 예전 캡처는 기록된 날짜·시각을 한국시간으로)', async () => {
    assert.ok(app.capMs({ at: at('2026-09-24', '02:00') }) > app.capMs({ at: at('2026-09-23', '23:00') }));
    assert.strictEqual(app.capMs({ at: '2026-09-23T21:00:00Z' }), Date.parse(at('2026-09-24', '06:00')), 'UTC 표기도 같은 결과');
    assert.strictEqual(app.capMs({ date: '2026-09-23', time: '오후 8:00' }), Date.parse(at('2026-09-23', '20:00')));
    assert.ok(app.capMs({ date: '2026-09-23', time: '오전 2:00' }) < app.capMs({ date: '2026-09-23', time: '오후 11:00' }), '예전 캡처는 옮기지 않고 자정 기준');
    // (Codex 재현) 같은 날 예전 캡처 20시 9만 + 새 캡처 23시 7만 → 그날 마지막은 7만(새 캡처), 지출 3만
    nowMs = Date.parse(at('2026-09-24', '12:00'));
    const M = { ...base({ txSince: null }), captures: [
      { id: 'p', date: '2026-09-22', time: '오후 9:00', balances: { kakao: 0, kb: 100000 } },
      { id: 'o', date: '2026-09-23', time: '오후 8:00', balances: { kakao: 0, kb: 90000 } },
      { id: 'n', at: at('2026-09-23', '23:00'), date: '2026-09-23', time: '오후 11:00', balances: { kakao: 0, kb: 70000 } },
    ] };
    app.setS(JSON.parse(JSON.stringify(M))); app.setTX({ rows: [] });
    assert.strictEqual(app.getDailySpent('2026-09-23').spent, 30000);
    assert.strictEqual(calc.getDailySpent(M, '2026-09-23', []).spent, 30000);
    // 캡처 기반(알림 전) 지출: 23일 밤 11시 98만 → 24일 새벽 2시(가계부 23일) 95만 = 23일 마지막 잔액은 95만
    nowMs = Date.parse(at('2026-09-24', '12:00'));
    const S = { ...base({ txSince: null }), captures: [
      { id: 'a', date: '2026-09-22', time: '오후 9:00', balances: { kakao: 0, kb: 1000000 } },
      { id: 'b', at: at('2026-09-23', '23:00'), date: '2026-09-23', time: '오후 11:00', balances: { kakao: 0, kb: 980000 } },
      { id: 'c', at: at('2026-09-24', '02:00'), date: '2026-09-23', time: '오전 02:00', balances: { kakao: 0, kb: 950000 } },
    ] };
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: [] });
    const r = app.getDailySpent('2026-09-23');
    assert.ok(r && r.spent === 50000, JSON.stringify(r));
    const c = calc.getDailySpent(S, '2026-09-23', []);
    assert.ok(c && c.spent === 50000, '리포트 ' + JSON.stringify(c));
  });
  await t('새벽 자동이체 고정비(25일 00:30 출금, 납부 표시 25일): 24일에서 한 번만 빼고, 25일엔 영향 없음(앱=리포트)', async () => {
    nowMs = Date.parse(at('2026-09-26', '12:00'));
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 1, balance: 1000000, at: at('2026-09-22', '12:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 10000, balance: 990000, counterparty: '식당', at: at('2026-09-24', '19:00') },
      { id: 3, bank: 'kb', type: 'out', amount: 55000, balance: 935000, counterparty: '통신사', at: at('2026-09-25', '00:30') },
      { id: 4, bank: 'kb', type: 'out', amount: 7000, balance: 928000, counterparty: '카페', at: at('2026-09-25', '10:00') },
    ];
    const S = base({ fixed: [{ name: '통신', amount: 55000, paid: true, paidDate: '2026-09-25' }] });
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    for (const [d, want] of [['2026-09-24', 10000], ['2026-09-25', 7000]]) {
      assert.strictEqual(app.sumSpentInRange(d, d), want, `${d} 앱`); assert.strictEqual(calc.sumSpentInRange(S, d, d, tx), want, `${d} 리포트`);
    }
    // 25일 낮에 같은 금액 출금이 나중에 들어와도 24일(이미 지난 날) 결과는 바뀌지 않는다(미래 거래를 안 봄).
    // 고정비는 새벽 출금과 이미 짝지어졌으므로 낮 출금은 일반 지출 → 이중 차감 없음
    const tx2 = [...tx, { id: 5, bank: 'kb', type: 'out', amount: 55000, balance: 873000, counterparty: '통신사', at: at('2026-09-25', '14:00') }];
    app.setTX({ rows: JSON.parse(JSON.stringify(tx2)) });
    for (const [d, want] of [['2026-09-24', 10000], ['2026-09-25', 62000]]) {
      assert.strictEqual(app.sumSpentInRange(d, d), want, `${d} 앱(나중 거래)`); assert.strictEqual(calc.sumSpentInRange(S, d, d, tx2), want, `${d} 리포트(나중 거래)`);
    }
    // 새벽 출금이 없고 25일 낮에만 있으면 25일에서 뺀다
    const tx4 = [tx[0], tx[1], { ...tx[3], balance: 983000 }, { ...tx2[4], balance: 928000 }]; // 잔액도 맞춰서(누락 오탐 없게)
    app.setTX({ rows: JSON.parse(JSON.stringify(tx4)) });
    assert.strictEqual(app.sumSpentInRange('2026-09-25', '2026-09-25'), 7000);
    assert.strictEqual(calc.sumSpentInRange(S, '2026-09-25', '2026-09-25', tx4), 7000);
    // 납부 표시를 24일(가계부 날짜)로 해도 똑같이 24일에서 빠짐
    const S3 = base({ fixed: [{ name: '통신', amount: 55000, paid: true, paidDate: '2026-09-24' }] });
    app.setS(JSON.parse(JSON.stringify(S3))); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    assert.strictEqual(app.sumSpentInRange('2026-09-24', '2026-09-25'), 17000);
    assert.strictEqual(calc.sumSpentInRange(S3, '2026-09-24', '2026-09-25', tx), 17000);
  });
  await t('주기 경계: 24일이 종료일일 때 25일 새벽 3시 결제는 지난 주기(24일)에 들어감', async () => {
    nowMs = Date.parse(at('2026-09-25', '12:00'));
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 1, balance: 1000000, at: at('2026-09-20', '12:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 30000, balance: 970000, counterparty: '편의점', at: at('2026-09-25', '03:00') },
      { id: 3, bank: 'kb', type: 'out', amount: 5000, balance: 965000, counterparty: '카페', at: at('2026-09-25', '09:00') },
    ];
    const S = base({ budgetStart: '2026-08-25', budgetEnd: '2026-09-24' });
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    assert.strictEqual(app.sumSpentInRange('2026-08-25', '2026-09-24'), 30000);
    assert.strictEqual(app.sumSpentInRange('2026-09-25', '2026-09-25'), 5000);
    assert.strictEqual(calc.sumSpentInRange(S, '2026-08-25', '2026-09-24', tx), 30000);
  });
  await t('마감 뒤 납부 체크: 25일 00:30 자동이체(24일 종료 주기)에 25일 납부 체크하면 지난 주기 결산을 다시 계산', async () => {
    nowMs = Date.parse(at('2026-09-25', '12:00'));
    const tx = [
      { id: 1, bank: 'kb', type: 'out', amount: 1, balance: 1000000, at: at('2026-09-20', '12:00') },
      { id: 2, bank: 'kb', type: 'out', amount: 10000, balance: 990000, counterparty: '식당', at: at('2026-09-24', '19:00') },
      { id: 3, bank: 'kb', type: 'out', amount: 55000, balance: 935000, counterparty: '통신사', at: at('2026-09-25', '00:30') },
    ];
    const S = base({ budgetStart: '2026-09-25', budgetEnd: '2026-10-24', txSince: '2026-09-21',
      cycles: [{ start: '2026-08-25', end: '2026-09-24', spent: 65000 }], fixed: [{ id: 'f1', name: '통신', amount: 55000, paid: false, paidDate: '' }] });
    app.setS(S); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    app.toggleFixed('f1');
    assert.strictEqual(S.fixed[0].paidDate, '2026-09-25');
    // 바로 덮어쓰지 않음: 기존 결산 보존 + 불완전 표시(→ 그 주기 범위를 서버에서 다시 받음)
    assert.strictEqual(S.cycles[0].spent, 65000); assert.strictEqual(S.cycles[0].incomplete, true);
    // 일부 범위만 받았으면(주기 시작 뒤부터) 확정 안 함 — 이 기기 캐시에 빈 곳이 있어도 결산이 틀어지지 않게
    app.applyTxToState(Date.parse(at('2026-09-20', '00:00')));
    assert.strictEqual(S.cycles[0].spent, 65000); assert.strictEqual(S.cycles[0].incomplete, true);
    // 주기 시작 전날부터 끝까지 받았을 때만 다시 계산·확정
    app.applyTxToState(Date.parse(at('2026-08-24', '00:00')));
    assert.strictEqual(S.cycles[0].spent, 10000, '지난 주기에서 고정비 빠짐'); assert.ok(!S.cycles[0].incomplete);
    // 체크 해제 → 다시 불완전 → 다시 받으면 일반 지출로 복원
    app.toggleFixed('f1'); app.applyTxToState(Date.parse(at('2026-08-24', '00:00')));
    assert.strictEqual(S.cycles[0].spent, 65000);
    // 알림 전에 끝난(캡처 기반) 주기와 서버 보관 기간(45일)이 지난 주기는 표시도 안 함(자동 재수신 대상 아님)
    S.cycles.unshift({ start: '2026-07-25', end: '2026-08-24', spent: 123 });
    app.toggleFixed('f1');
    assert.strictEqual(S.cycles[0].spent, 123); assert.ok(!S.cycles[0].incomplete);
    const S3 = base({ budgetStart: '2026-09-25', budgetEnd: '2026-10-24', txSince: '2026-07-01',
      cycles: [{ start: '2026-07-25', end: '2026-08-24', spent: 777 }], fixed: [{ id: 'f1', name: '통신', amount: 55000, paid: true, paidDate: '2026-08-10' }] });
    app.setS(S3); app.setTX({ rows: [] });
    app.toggleFixed('f1');
    assert.strictEqual(S3.cycles[0].spent, 777); assert.ok(!S3.cycles[0].incomplete, '45일 넘은 주기는 다시 받을 수 없어 그대로');
  });
  await t('(Codex 재현) 예전 새벽 캡처도 계산에선 전날: 22일 10만 → 예전 24일 02시 9만 → 새 24일 03시 8만 → 25일 정오 7만 = 합계 3만', async () => {
    nowMs = Date.parse(at('2026-09-25', '18:00'));
    const S = { ...base({ txSince: null }), captures: [
      { id: 'a', date: '2026-09-22', time: '오후 9:00', balances: { kakao: 0, kb: 100000 } },
      { id: 'b', date: '2026-09-24', time: '오전 2:00', balances: { kakao: 0, kb: 90000 } },
      { id: 'c', at: at('2026-09-24', '03:00'), date: '2026-09-23', time: '오전 03:00', balances: { kakao: 0, kb: 80000 } },
      { id: 'd', at: at('2026-09-25', '12:00'), date: '2026-09-25', time: '오후 12:00', balances: { kakao: 0, kb: 70000 } },
    ] };
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: [] });
    const days = ['2026-09-23', '2026-09-24', '2026-09-25'].map((d) => (app.getDailySpent(d) || {}).spent);
    assert.deepStrictEqual(days, [20000, 0, 10000], '23일(새벽 두 캡처 모두) 2만, 24일 0, 25일 1만');
    assert.strictEqual(app.sumSpentInRange('2026-09-23', '2026-09-25'), 30000);
    assert.strictEqual(calc.sumSpentInRange(S, '2026-09-23', '2026-09-25', []), 30000);
  });
  await t('(Codex 재현) 시작 잔액: 23일 23시 거래 잔액 8만 → 예전 24일 03시 캡처 7만이면 24일 시작 잔액은 7만', async () => {
    nowMs = Date.parse(at('2026-09-24', '12:00'));
    const tx = [{ id: 1, bank: 'kb', type: 'out', amount: 20000, balance: 80000, counterparty: '가게', at: at('2026-09-23', '23:00') }];
    const S = { ...base({ txSince: '2026-09-24' }), captures: [
      { id: 'o', date: '2026-09-24', time: '오전 3:00', balances: { kakao: 0, kb: 70000 } },
    ] };
    app.setS(JSON.parse(JSON.stringify(S))); app.setTX({ rows: JSON.parse(JSON.stringify(tx)) });
    assert.strictEqual(app.getDailySpent('2026-09-24').prevTotal, 70000);
    assert.strictEqual(calc.getDailySpent(S, '2026-09-24', tx).prevTotal, 70000);
  });
  await t('(Codex 9차) 잔액 없는 알림 추정: 사이에 빠졌던 거래가 늦게 들어오면 같은 마지막 거래여도 저장 잔액을 다시 맞춤', async () => {
    nowMs = Date.parse(at('2026-09-26', '12:00'));
    const S = base({ balances: {}, balanceAt: {}, balanceTxId: {} });
    const r1 = { id: 1, bank: 'kb', type: 'out', amount: 1, balance: 10000, at: at('2026-09-25', '10:00') };
    const r3 = { id: 3, bank: 'kb', type: 'out', amount: 2000, balance: null, at: at('2026-09-25', '12:00') };
    app.setS(S); app.setTX({ rows: [r1, r3] }); app.applyTxToState(null);
    assert.strictEqual(S.balances.kb, 8000); assert.strictEqual(S.balanceEst.kb, true);
    const r2 = { id: 2, bank: 'kb', type: 'out', amount: 3000, balance: null, at: at('2026-09-25', '11:00') };
    app.setTX({ rows: [r1, r2, r3] }); app.applyTxToState(null);
    assert.strictEqual(S.balances.kb, 5000, '늦게 온 3천 출금 반영');
    // 잔액 있는 알림이 오면 확정값으로, 추정 표시 해제
    app.setTX({ rows: [r1, r2, r3, { id: 4, bank: 'kb', type: 'out', amount: 1000, balance: 4000, at: at('2026-09-25', '13:00') }] }); app.applyTxToState(null);
    assert.strictEqual(S.balances.kb, 4000); assert.strictEqual(S.balanceEst.kb, false);
  });
  console.log(`\n통과 ${ok}개`);
})().catch((e) => { console.error(e); process.exit(1); });
