// 가짜 거래로 본인 이름 입금 확인·중복 계산·늦은 출금 수신을 검증한다.
const assert = require('assert');
const makeApp = require('./app');
const now = '2026-10-04T03:30:00+09:00';
const row = (id, extra = {}) => ({ id, bank: 'kakao', type: 'in', amount: 17000,
  balance: 517000, counterparty: '홍길동', at: '2026-10-03T21:09:00+09:00', ...extra });
const state = () => ({ budget: 800000, budgetStart: '2026-09-23', budgetEnd: '2026-10-22',
  txSince: '2026-09-29', ownerNames: '홍길동', fixed: [], captures: [], memos: {},
  balances: { kakao: 517000, kb: 0 }, spentAdjust: { date: '2026-09-23', amount: 300000 } });
const setup = rows => { const app = makeApp({ now }); app.set({ S: state(), TX: { rows } }); return app; };
let count = 0;
function test(name, fn) { fn(); console.log('ok -', name); count++; }

test('대응 출금 없는 본인 이름 입금: 금액·제외 이유와 두 선택지를 표시', () => {
  const app = setup([row(1)]);
  assert.strictEqual(app.fn.cycleIncome(), 0);
  const notice = app.fn.computeNotices().find(n => n.id === 'ownin-1');
  assert.ok(notice.title.includes('17,000원') && notice.body.includes('예산에서 제외'));
  assert.deepStrictEqual(notice.acts.map(a => a.t), ['새로 받은 돈', '내 계좌 이동']);
});

test('새 수입 선택: 남은 예산만 입금액만큼 증가, 재선택·재수신·재로딩에도 한 번만 반영', () => {
  const app = setup([row(1)]);
  const before = app.fn.effectiveBudget() - app.fn.totSpent();
  app.fn.resolveOwnIncome(1, false);
  assert.strictEqual(app.fn.effectiveBudget() - app.fn.totSpent(), before + 17000);
  assert.strictEqual(app.S.txOverrides[1].transfer, false);
  assert.strictEqual(app.fn.pendingOwnIncomeRows().length, 0);
  app.fn.resolveOwnIncome(1, true); // 이미 처리한 알림은 무시
  app.set({ TX: { rows: [row(1)] } });
  assert.strictEqual(app.fn.cycleIncome(), 17000);
  const reopened = makeApp({ now });
  reopened.set({ S: JSON.parse(JSON.stringify(app.S)), TX: { rows: [row(1)] } });
  assert.strictEqual(reopened.fn.cycleIncome(), 17000);
  assert.ok(!reopened.fn.computeNotices().some(n => n.id === 'ownin-1'));
});

test('내 계좌 이동 선택: 예산 증가 없이 확인 알림 해제', () => {
  const app = setup([row(1)]);
  app.fn.resolveOwnIncome(1, true);
  assert.strictEqual(app.fn.cycleIncome(), 0);
  assert.ok(app.fn.txWithFlags()[0].isTransfer);
  assert.strictEqual(app.fn.pendingOwnIncomeRows().length, 0);
});

test('새 수입 확정 뒤 늦게 도착한 출금: 한쪽만 이동으로 면제하지 않고 각각 계산', () => {
  const app = setup([row(1)]);
  const before = app.fn.effectiveBudget();
  app.fn.resolveOwnIncome(1, false);
  app.set({ TX: { rows: [row(1), row(2, { bank: 'kb', type: 'out', balance: 100000, at: '2026-10-03T21:08:00+09:00' })] } });
  assert.ok(app.fn.txWithFlags().every(r => !r.isTransfer));
  assert.strictEqual(app.fn.cycleIncome(), 17000, '사용자가 확정한 새 수입은 유지');
  assert.strictEqual(app.fn.cycleSavings(), 17000, '본인 이름 출금은 기존 저축 분류로 반영');
  assert.strictEqual(app.fn.effectiveBudget(), before, '수입만 더하고 출금은 무시하는 과대계산 없음');
});

test('국민 출금·카카오 입금이 같은 금액·10분 이내면 자동 이동, 늦게 도착해도 낡은 확인 무시', () => {
  const app = setup([row(1)]);
  assert.strictEqual(app.fn.pendingOwnIncomeRows().length, 1);
  app.set({ TX: { rows: [row(1), row(2, { bank: 'kb', type: 'out', balance: 100000, at: '2026-10-03T21:08:00+09:00' })] } });
  assert.ok(app.fn.txWithFlags().every(r => r.isTransfer));
  assert.strictEqual(app.fn.pendingOwnIncomeRows().length, 0);
  app.fn.resolveOwnIncome(1, false);
  assert.strictEqual(app.fn.cycleIncome(), 0);
  assert.ok(!app.S.txOverrides);
});

test('금액·시각 조건 불일치는 계속 확인, 본인 이름 없는 일반 입금은 바로 반영', () => {
  const app = setup([row(1), row(2, { bank: 'kb', type: 'out', amount: 16000 }),
    row(3, { bank: 'kb', type: 'out', at: '2026-10-03T20:00:00+09:00' }), row(4, { counterparty: '김철수' })]);
  assert.deepStrictEqual(app.fn.pendingOwnIncomeRows().map(r => r.id), [1]);
  assert.strictEqual(app.fn.cycleIncome(), 17000);
});

test('월급·환불·과거·미래·이미 예산 제외한 입금은 확인 후보에서 제외, 고정 입금과 중복 방지', () => {
  const app = setup([row(1, { counterparty: '홍길동 환불' }),
    row(2, { amount: 2500000, counterparty: '홍길동 급여', at: '2026-09-25T12:00:00+09:00' }),
    row(3, { at: '2026-09-22T12:00:00+09:00' }), row(4, { at: '2026-10-04T12:00:00+09:00' }), row(5), row(6)]);
  app.S.txSince = '2026-09-23'; app.S.txIncomeOff = { 5: true };
  app.S.fixed = [{ id: 'income', type: 'income', amount: 17000 }];
  assert.deepStrictEqual(app.fn.pendingOwnIncomeRows().map(r => r.id), [6]);
  app.fn.resolveOwnIncome(6, false);
  assert.strictEqual(app.fn.cycleIncome(), 0, '고정 입금으로 이미 배정한 금액을 또 더하지 않음');
});
console.log(`통과 ${count}개`);
