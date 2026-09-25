// 월급날·주기 자동 계산 검증. 실행: node test/payday.test.js
const assert = require('assert');
const P = require('../payday.js');
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok -', n); };

t('예상 월급일: 추석(9/24·25) → 9/23, 10/25 일요일 → 10/23, 평일은 그대로', () => {
  assert.strictEqual(P.expectedPayday(2026, 9), '2026-09-23');
  assert.strictEqual(P.expectedPayday(2026, 10), '2026-10-23');
  assert.strictEqual(P.expectedPayday(2026, 11), '2026-11-25');
  assert.strictEqual(P.expectedPayday(2027, 1), '2027-01-25');
  assert.strictEqual(P.expectedPayday(2026, 7), '2026-07-24', '7/25 토요일 → 금요일');
});
t('주기 종료일 = 다음 달 예상 월급일 전날(연휴 반영)', () => {
  assert.strictEqual(P.cycleEndFor('2026-09'), '2026-10-22');
  assert.strictEqual(P.cycleEndFor('2026-12'), '2027-01-24');
});
t('귀속 달: 늦게 들어온 월급도 한 달을 건너뛰지 않음', () => {
  assert.deepStrictEqual(P.payMonthOf('2026-09-23'), { month: '2026-09', gap: 0 });
  assert.strictEqual(P.payMonthOf('2026-10-01').month, '2026-09', '8일 늦어도 9월분');
  assert.strictEqual(P.payMonthOf('2026-10-20').month, '2026-10');
});
const row = (id, date, amount, cp = '오피엠에스', type = 'in') => ({ id, date, amount, counterparty: cp, type });
t('월급 판정: 회사 이름 + 200만 이상 + 예상일 ±7일', () => {
  const rows = [row(1, '2026-09-23', 3100000), row(2, '2026-09-22', 450000), row(3, '2026-09-23', 3000000, '다른회사'),
    row(4, '2026-09-10', 3000000), row(5, '2026-09-23', 3000000, '오피엠에스', 'out'), row(6, '2026-10-23', 3100000, '(주)오 피 엠 에 스')];
  const r = P.findSalaries(rows, { payer: '오피엠에스' });
  assert.deepStrictEqual(r.map((x) => [x.month, x.picks.map((p) => p.id)]), [['2026-09', [1]], ['2026-10', [6]]]);
});
t('같은 달 200만 이상 입금이 둘이면(상여 등) 확정하지 않음 → 사용자 확인', () => {
  const r = P.findSalaries([row(1, '2026-09-23', 3100000), row(2, '2026-09-24', 2500000)], { payer: '오피엠에스' });
  assert.strictEqual(r[0].picks.length, 2);
  const r2 = P.findSalaries([row(1, '2026-09-23', 3100000), row(2, '2026-09-24', 2500000)], { payer: '오피엠에스', rejected: new Set([2]) });
  assert.deepStrictEqual(r2[0].picks.map((p) => p.id), [1], '사용자가 "월급 아님"으로 표시한 건 제외');
});
t('회사 이름이 비어 있으면 아무것도 월급으로 보지 않음', () => {
  assert.deepStrictEqual(P.findSalaries([row(1, '2026-09-23', 3100000)], { payer: '' }), []);
});
t('공휴일 표 범위 밖(2028)은 추정으로 알림', () => {
  assert.ok(P.holidayKnown('2027-05-01')); assert.ok(!P.holidayKnown('2028-01-25'));
});
// Codex가 뽑은 까다로운 알림(실제 카카오 입금 문구를 해석기로 읽어서 판정)
const { parseNotification } = require('../txparse.js');
const salaryOf = (lines, date = '2026-09-23') => {
  const r = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', text: `${date.slice(5).replace('-', '/')} 09:00\n${lines}\n잔액 9,000,000원`, postedAt: date + 'T00:00:00Z' });
  return P.findSalaries([{ id: 1, type: r.type, amount: r.amount, counterparty: r.counterparty, method: r.method, date }], { payer: ['오피엠에스', '급여'] }).length === 1;
};
t('경계값·띄어쓰기·받는 통장 이름·경비 문구', () => {
  assert.strictEqual(salaryOf('입금 1,999,999원\n급여 → 입출금통장(0000)'), false, '200만 미만');
  assert.strictEqual(salaryOf('입금 2,000,000원\n오피엠에스 → 입출금통장(0000)'), true, '딱 200만');
  assert.strictEqual(salaryOf('입금 3,100,000원\n오 피 엠 에 스 → 입출금통장(0000)'), true, '띄어쓰기');
  assert.strictEqual(salaryOf('입금 3,100,000원\n급여 → 입출금통장(0000)'), true, '급여');
  assert.strictEqual(salaryOf('입금 3,100,000원\n홍길동 → 급여통장(0000)'), false, '받는 통장 이름의 급여는 무시');
  assert.strictEqual(salaryOf('입금 2,500,000원\n오피엠에스 개인경비 → 입출금통장(0000)'), false, '경비');
  assert.strictEqual(salaryOf('입금 2,500,000원\n오피엠에스상여 → 입출금통장(0000)'), false, '상여');
});
t('연휴로 앞당긴 월급일(9/23) 기준 7일 전은 후보, 8일 전은 아님', () => {
  assert.strictEqual(salaryOf('입금 3,100,000원\n급여 → 입출금통장(0000)', '2026-09-16'), true);
  assert.strictEqual(salaryOf('입금 3,100,000원\n급여 → 입출금통장(0000)', '2026-09-15'), false);
});

console.log(`\n통과 ${ok}개`);
