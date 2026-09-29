// 앞으로 15개월 월급 주기 연속 시뮬레이션(2026-09-29): 매달 예상 월급일에 '급여' 입금 알림 → 주기 초기화가 맞는지.
// 실행: node test/cycle-sim.test.js  (이름은 가짜 '홍길동')
const assert = require('assert');
const makeApp = require('./app');
const Payday = require('../payday.js');
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok -', n); };
const at = (d, hm) => `${d}T${hm}:00+09:00`;
let id = 0;
const tx = (bank, type, amount, balance, cp, d, hm = '12:00') => ({ id: ++id, bank, type, amount, balance, counterparty: cp, at: at(d, hm), needs_review: false });
const nextYm = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

// 지금 실제 상태와 같은 모양: 9월 주기 2026-09-23~10-22(수동 설정), 월급 228만
const startS = () => ({ budget: 2280000, budgetStart: '2026-09-23', budgetEnd: '2026-10-22', salaryMonth: '2026-09', salaryAmount: 2280000,
  txSince: '2026-09-21', ownerNames: '홍길동', payer: '오피엠에스', payDay: 25, fixed: [] });

t('2026-10 ~ 2027-12 매달 예상 월급일에 "급여" 입금 → 그날 새 주기, 끝은 다음 예상 월급일 전날, 한 번만 시작', () => {
  const rows = [tx('kb', 'out', 1, 1000000, '가게', '2026-09-22'), tx('kakao', 'out', 1, 500000, '가게', '2026-09-22')];
  let S = startS(); let bal = 499999; let y = 2026, m = 10;
  const log = [];
  for (let i = 0; i < 15; i++) {
    const pay = Payday.expectedPayday(y, m, 25);
    const [ny, nm] = nextYm(y, m);
    const end = (() => { const p = Payday.expectedPayday(ny, nm, 25); const d = new Date(p + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
    bal += 3000000; rows.push(tx('kakao', 'in', 3000000, bal, '급여', pay, '09:00'));
    bal -= 50000; rows.push(tx('kakao', 'out', 50000, bal, '마트', pay, '19:00'));
    const app = makeApp({ now: at(pay, '20:00') });
    app.set({ S, TX: { rows: [...rows] } });
    app.fn.applyTxToState(null);
    S = app.S;
    assert.strictEqual(S.budgetStart, pay, `${y}-${m} 시작`); assert.strictEqual(S.budgetEnd, end, `${y}-${m} 끝`);
    assert.strictEqual(S.salaryMonth, `${y}-${String(m).padStart(2, '0')}`);
    const n = S.cycles.length;
    app.fn.applyTxToState(null); assert.strictEqual(app.S.cycles.length, n, '다시 계산해도 주기 한 번만');
    log.push(`${pay}(${'일월화수목금토'[new Date(pay + 'T00:00:00Z').getUTCDay()]})~${end}`);
    [y, m] = [ny, nm];
  }
  console.log('   ' + log.join('\n   '));
});

t('월급이 예상일보다 하루 늦게(다음 영업일) 들어와도 그 달 주기로 시작, 끝은 그대로', () => {
  const app = makeApp({ now: '2026-10-26T20:00:00+09:00' });
  const rows = [tx('kb', 'out', 1, 1000000, '가게', '2026-09-22'), tx('kakao', 'in', 3000000, 3500000, '급여', '2026-10-26', '09:00')];
  app.set({ S: startS(), TX: { rows } }); app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-10-26'); assert.strictEqual(app.S.budgetEnd, '2026-11-24'); assert.strictEqual(app.S.salaryMonth, '2026-10');
});

t('월급 알림을 놓친 경우: 주기가 저절로 넘어가지 않음 → 알림(벨)에 알려야 함', () => {
  const app = makeApp({ now: '2026-10-28T20:00:00+09:00' });
  const rows = [tx('kb', 'out', 1, 1000000, '가게', '2026-09-22'), tx('kakao', 'out', 10000, 490000, '마트', '2026-10-27')];
  app.set({ S: startS(), TX: { rows } }); app.fn.applyTxToState(null);
  const ids = app.fn.computeNotices().map((n) => n.id.split('-')[0]);
  console.log('   주기', app.S.budgetStart, '~', app.S.budgetEnd, '· 벨 알림', ids);
  assert.ok(ids.includes('sallate'), '월급 늦음 안내');
  assert.strictEqual(app.fn.totSpent(), 10000, '(Codex) 종료일 뒤 월급 기다리는 동안 지출도 쓴 돈에 포함');
});

t('공휴일 표 범위: 2028년은 표에 없음(주말만 반영) → 2028-12-25(월, 성탄절)이 월급일로 잡힘', () => {
  console.log('   2028-12 예상 월급일', Payday.expectedPayday(2028, 12, 25), '· 2027-12', Payday.expectedPayday(2027, 12, 25));
});

console.log(`\n통과 ${ok}개`);
