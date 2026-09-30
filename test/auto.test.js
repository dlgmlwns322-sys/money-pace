// 완전 자동화(2026-09-26) 검증: 월급으로 주기 시작·연휴 반영 종료일·이월, 월급 오판 방지, 저축 분류, 고정지출 자동 체크.
// 실행: node test/auto.test.js  (이름은 가짜 '홍길동')
const assert = require('assert');
const makeApp = require('./app');
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok -', n); };
const at = (d, hm) => `${d}T${hm}:00+09:00`;
let id = 0;
const tx = (bank, type, amount, balance, cp, d, hm = '12:00', extra = {}) => ({ id: ++id, bank, type, amount, balance, counterparty: cp, at: at(d, hm), needs_review: false, ...extra });
const seedRows = () => [tx('kb', 'out', 1, 1000000, '가게', '2026-09-20'), tx('kakao', 'out', 1, 500000, '가게', '2026-09-20')];
const baseS = (extra = {}) => ({ budget: 1000000, budgetStart: '2026-09-23', budgetEnd: '2026-10-22', txSince: '2026-09-21', ownerNames: '홍길동', payer: '오피엠에스', payDay: 25, fixed: [], ...extra });

t('월급(오피엠에스·200만 이상·예상일 근처) 들어오면 새 주기: 종료일은 다음 예상 월급일 전날, 남은 돈 이월', () => {
  const app = makeApp({ now: '2026-10-23T12:00:00+09:00' });
  const rows = [...seedRows(), tx('kb', 'out', 100000, 900000, '마트', '2026-10-01'),
    tx('kakao', 'in', 850000, 1350000, '오피엠에스', '2026-10-22', '10:00'), // 개인경비(200만 미만) → 월급 아님
    tx('kakao', 'in', 3100000, 4450000, '오피엠에스', '2026-10-23', '09:00')];
  app.set({ S: baseS(), TX: { rows } });
  app.fn.applyTxToState(null);
  const S = app.S;
  assert.strictEqual(S.budgetStart, '2026-10-23'); assert.strictEqual(S.budgetEnd, '2026-11-24', '11/25 수요일 → 전날 11/24');
  assert.strictEqual(S.salaryAmount, 3100000);
  assert.strictEqual(S.cycles.length, 1); assert.strictEqual(S.cycles[0].spent, 100000);
  assert.strictEqual(S.carry, 1750000, '지난 주기 100만 − 10만 + 개인경비 입금 85만(월급 아닌 입금은 쓸 수 있는 돈에 더함) = 175만 이월');
  assert.strictEqual(S.budget, 4850000, '월급 310만 + 이월 175만');
  // 같은 월급이 다시 들어와도(재수신) 주기를 또 시작하지 않음
  app.fn.applyTxToState(null); assert.strictEqual(app.S.cycles.length, 1);
});

t('같은 기간 200만 이상 입금이 둘(상여)이면 자동으로 정하지 않고 벨에서 고름 → 고른 걸로 시작', () => {
  const app = makeApp({ now: '2026-10-24T12:00:00+09:00' });
  const rows = [...seedRows(), tx('kakao', 'in', 3100000, 3600000, '오피엠에스', '2026-10-23', '09:00'), tx('kakao', 'in', 2500000, 6100000, '오피엠에스', '2026-10-23', '15:00')];
  app.set({ S: baseS(), TX: { rows } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-09-23', '확정 안 함');
  const n = app.fn.computeNotices().find((x) => x.id.startsWith('salpick-'));
  assert.ok(n && n.acts.length === 2, '두 후보 버튼');
  app.fn.pickSalary('2026-10', rows[2].id);
  assert.strictEqual(app.S.budgetStart, '2026-10-23'); assert.strictEqual(app.S.salaryAmount, 3100000);
});

t('"월급 아님"으로 되돌리면 이전 주기로 복구되고 그 입금은 다시 월급으로 보지 않음', () => {
  const app = makeApp({ now: '2026-10-23T12:00:00+09:00' });
  const rows = [...seedRows(), tx('kakao', 'in', 2300000, 2800000, '오피엠에스', '2026-10-23', '09:00')];
  app.set({ S: baseS(), TX: { rows } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-10-23');
  assert.ok(app.fn.computeNotices().some((x) => x.id.startsWith('salnew-') && x.acts[0].t === '월급 아님'));
  app.fn.undoSalary();
  assert.strictEqual(app.S.budgetStart, '2026-09-23'); assert.strictEqual(app.S.cycles.length, 0);
  app.fn.applyTxToState(null); assert.strictEqual(app.S.budgetStart, '2026-09-23', '다시 월급으로 안 봄');
});

t('월급이 예상일보다 늦으면 주기가 이어지고 벨로 안내(남은 날 1일)', () => {
  const app = makeApp({ now: '2026-10-24T12:00:00+09:00' });
  app.set({ S: baseS(), TX: { rows: seedRows() } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-09-23');
  assert.ok(app.fn.computeNotices().some((x) => x.id.startsWith('sallate-')));
  assert.strictEqual(app.fn.getBD().remaining, 1);
});

t('저축: 본인 이름으로 나갔는데 국민·카카오로 짝이 없으면 저축(지출 아님, 쓸 수 있는 돈에서만 뺌). 국민→카카오 이동은 둘 다 아님', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kakao', 'out', 300000, 200000, '홍길동', '2026-09-24', '10:00'), // 토스증권(짝 없음) → 저축
    tx('kb', 'out', 50000, 950000, '홍길동', '2026-09-25', '10:00'), tx('kakao', 'in', 50000, 250000, '홍길동', '2026-09-25', '10:01'), // 내 계좌끼리
    tx('kb', 'out', 12000, 938000, '식당', '2026-09-25', '12:00')];
  app.set({ S: baseS(), TX: { rows } });
  const f = app.fn.txWithFlags();
  assert.strictEqual(f.find((r) => r.amount === 300000).savings, true);
  assert.ok(f.filter((r) => r.amount === 50000).every((r) => r.isTransfer && !r.savings));
  assert.strictEqual(app.fn.sumSpentInRange('2026-09-23', '2026-09-26'), 12000, '저축·이동은 지출 아님');
  assert.strictEqual(app.fn.cycleSavings(), 300000);
  assert.strictEqual(app.fn.effectiveBudget(), 700000, '100만 − 저축 30만');
});

t('카카오뱅크 저금통으로 옮긴 잔돈은 저축(지출 아님). 국민 쪽 같은 이름·직접 지정·저금통에서 꺼낸 입금은 해당 없음', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kakao', 'out', 200, 499800, '저금통', '2026-09-24', '11:15'),
    tx('kakao', 'out', 300, 499500, '저금통', '2026-09-25', '11:15'),   // 사용자가 '이동 아님'으로 지정 → 지출
    tx('kakao', 'in', 5000, 504500, '저금통', '2026-09-25', '12:00'),   // 저금통 깨기(입금)
    tx('kb', 'out', 400, 999600, '저금통', '2026-09-25', '13:00'),      // 카카오 알림이 아닌 건 그대로 지출
    tx('kakao', 'out', 12000, 492500, '식당', '2026-09-25', '14:00')];
  app.set({ S: baseS({ txOverrides: { [rows[3].id]: { transfer: false } } }), TX: { rows } });
  const f = app.fn.txWithFlags();
  assert.strictEqual(f.find((r) => r.amount === 200).savings, true);
  assert.strictEqual(f.find((r) => r.amount === 300).savings, false, '직접 지정하면 그 값');
  assert.ok(!f.find((r) => r.amount === 5000).savings && !f.find((r) => r.amount === 400).savings);
  assert.strictEqual(app.fn.sumSpentInRange('2026-09-23', '2026-09-26'), 300 + 400 + 12000, '저금통 200은 지출 아님');
  assert.strictEqual(app.fn.cycleSavings(), 200);
  assert.strictEqual(app.fn.effectiveBudget(), 1000000 - 200);
});

t('고정지출 자동 체크: 알림 이름이 들어간 출금(±20%)이면 체크·연결, 실제액과 예정액 차이만 지출. 신한 2만(본인 이름)은 저축으로 한 번 더 안 셈', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kb', 'out', 54000, 946000, '케이티모바일', '2026-09-24', '09:00'),
    tx('kakao', 'out', 20000, 480000, '홍길동', '2026-09-25', '09:00'),   // 신한 저축(고정지출로 등록)
    tx('kakao', 'out', 100000, 380000, '홍길동', '2026-09-25', '11:00'), // 토스증권(저축)
    tx('kb', 'out', 30000, 916000, '넷플릭스', '2026-09-25', '12:00')];   // 금액 범위 밖(예정 13,500) → 연결 안 함
  const fixed = [{ id: 'm', name: '통신', kw: '모바일', amount: 55000, paid: false, paidDate: '' },
    { id: 's', name: '신한 저축', kw: '홍길동', amount: 20000, paid: false, paidDate: '' },
    { id: 'n', name: '넷플릭스', kw: '넷플릭스', amount: 13500, paid: false, paidDate: '' }];
  app.set({ S: baseS({ fixed }), TX: { rows } });
  app.fn.applyTxToState(null);
  const F = Object.fromEntries(app.S.fixed.map((x) => [x.id, x]));
  assert.ok(F.m.paid && F.m.txId === rows[2].id && F.m.actual === 54000 && F.m.paidDate === '2026-09-24');
  assert.ok(F.s.paid && F.s.txId === rows[3].id, '2만 원은 신한 저축으로 연결(10만은 범위 밖)');
  assert.ok(!F.n.paid, '금액이 크게 다르면 자동 체크 안 함');
  assert.strictEqual(app.fn.getDailySpent('2026-09-24').spent, -1000, '통신: 실제 5.4만 − 예정 5.5만');
  assert.strictEqual(app.fn.sumSpentInRange('2026-09-25', '2026-09-25'), 30000, '넷플릭스 3만은 일반 지출, 신한·토스는 지출 아님');
  assert.strictEqual(app.fn.cycleSavings(), 100000, '신한 2만은 고정지출로만, 토스 10만만 저축');
});

t('이름이 없는 고정지출은 금액이 같으면 벨에서 "맞아요?" → 맞아요면 연결, 아니에요면 다시 안 물음', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  const rows = [...seedRows(), tx('kb', 'out', 32000, 968000, '이니시스(', '2026-09-24')];
  const mk = () => ({ S: baseS({ fixed: [{ id: 'b', name: '보험', amount: 32000, paid: false, paidDate: '' }] }), TX: { rows } });
  app.set(mk());
  let n = app.fn.computeNotices().find((x) => x.id.startsWith('fxc-'));
  assert.ok(n && n.acts.map((a) => a.t).join() === '맞아요,아니에요');
  app.fn.confirmFixed('b', rows[2].id, true);
  assert.ok(app.S.fixed[0].paid && app.S.fixed[0].txId === rows[2].id);
  app.set(mk()); app.fn.confirmFixed('b', rows[2].id, false);
  assert.ok(!app.fn.computeNotices().some((x) => x.id.startsWith('fxc-')), '아니에요 → 다시 안 물음');
});

t('주간 몫 = 쓸 수 있는 돈 × 7 ÷ 주기 일수(주간 예산 입력 없음)', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  app.set({ S: baseS(), TX: { rows: seedRows() } });
  assert.strictEqual(app.fn.weeklyShare(), Math.round(1000000 * 7 / 30));
});

// ── Codex 1회차 지적 재현 ──
t('(1·2) 마감: 새 주기 저축은 지난 주기에서 안 빼고, 적자는 0으로 자르지 않고 이월', () => {
  const app = makeApp({ now: '2026-10-23T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kakao', 'out', 1300000, 200000, '홍길동', '2026-10-01', '10:00'),              // 지난 주기 저축 130만
    tx('kakao', 'in', 3100000, 3300000, '오피엠에스', '2026-10-23', '09:00'),
    tx('kakao', 'out', 300000, 3000000, '홍길동', '2026-10-23', '10:00')];            // 새 주기 저축 30만
  app.set({ S: baseS({ fixed: [{ id: 'x', name: '월세', amount: 500000, paid: false, paidDate: '' }] }), TX: { rows } });
  app.fn.applyTxToState(null);
  const c = app.S.cycles[0];
  assert.strictEqual(c.savings, 1300000, '지난 주기 저축만');
  assert.strictEqual(c.effective, 1000000 - 500000 - 1300000, '−80만(적자)');
  assert.strictEqual(app.S.carry, -800000, '적자 그대로 이월');
  assert.strictEqual(app.S.budget, 3100000 - 800000);
});
t('(3) 직접 정한 주기보다 이른 월급 기록은 과거 것이라 무시(시작일이 과거로 안 덮임)', () => {
  const app = makeApp({ now: '2026-09-26T12:00:00+09:00' });
  const rows = [...seedRows(), tx('kakao', 'in', 3100000, 3600000, '오피엠에스', '2026-08-25', '09:00')];
  app.set({ S: baseS(), TX: { rows } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-09-23'); assert.strictEqual(app.S.cycles.length, 0);
});
t('(5) 지난 주기 신한 저축(고정지출)과 새 월급을 같이 받아도 고정지출로 먼저 연결 → 저축으로 이중 차감 없음', () => {
  const app = makeApp({ now: '2026-10-23T20:00:00+09:00' });
  const rows = [...seedRows(), tx('kakao', 'out', 20000, 480000, '홍길동', '2026-10-20', '09:00'), tx('kakao', 'in', 3100000, 3580000, '오피엠에스', '2026-10-23', '09:00')];
  app.set({ S: baseS({ fixed: [{ id: 's', name: '신한 저축', kw: '홍길동', amount: 20000, paid: false, paidDate: '' }] }), TX: { rows } });
  app.fn.applyTxToState(null);
  const c = app.S.cycles[0];
  assert.strictEqual(c.savings, 0, '저축으로 안 셈'); assert.strictEqual(c.effective, 1000000 - 20000);
  assert.ok(app.S.fixedPaidLog.some((f) => f.txId === rows[2].id), '지난 주기 납부로 기록');
});
t('(6) "월급 아님": 전환 뒤 추가·수정한 고정지출은 그대로, 전환이 바꾼 체크만 되돌림', () => {
  const app = makeApp({ now: '2026-10-23T20:00:00+09:00' });
  const rows = [...seedRows(), tx('kakao', 'in', 2300000, 2800000, '오피엠에스', '2026-10-23', '09:00')];
  app.set({ S: baseS({ fixed: [{ id: 'a', name: '통신', amount: 55000, paid: true, paidDate: '2026-10-01' }] }), TX: { rows } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.fixed[0].paid, false, '새 주기라 체크 해제');
  app.S.fixed.push({ id: 'new', name: '보험', amount: 30000, paid: false, paidDate: '' }); app.S.fixed[0].amount = 60000;
  app.fn.undoSalary();
  assert.strictEqual(app.S.fixed.length, 2, '추가한 항목 유지'); assert.strictEqual(app.S.fixed[0].amount, 60000, '수정한 금액 유지');
  assert.ok(app.S.fixed[0].paid && app.S.fixed[0].paidDate === '2026-10-01', '체크는 되돌림');
});
t('(7) 이미 시작한 달에 두 번째 후보가 늦게 오면 다시 묻고, 다른 걸 고르면 그걸로 다시 시작', () => {
  const app = makeApp({ now: '2026-10-24T20:00:00+09:00' });
  const r1 = tx('kakao', 'in', 2500000, 3000000, '오피엠에스', '2026-10-22', '09:00');
  const S = baseS();
  app.set({ S, TX: { rows: [...seedRows(), r1] } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.salaryTxId, r1.id);
  const r2 = tx('kakao', 'in', 3100000, 6100000, '오피엠에스', '2026-10-23', '09:00');
  app.set({ TX: { rows: [...seedRows(), r1, r2] } });
  const n = app.fn.computeNotices().find((x) => x.id === 'salpick-2026-10');
  assert.ok(n && n.acts.length === 2, '다시 물음');
  app.fn.pickSalary('2026-10', r2.id);
  assert.strictEqual(app.S.salaryTxId, r2.id); assert.strictEqual(app.S.budgetStart, '2026-10-23'); assert.strictEqual(app.S.cycles.length, 1, '주기는 한 번만 마감');
});
t('(8) 국민은행으로 들어온 같은 회사 200만 이상 입금은 월급 아님(월급 계좌 = 카카오)', () => {
  const app = makeApp({ now: '2026-10-23T20:00:00+09:00' });
  app.set({ S: baseS(), TX: { rows: [...seedRows(), tx('kb', 'in', 3100000, 4100000, '오피엠에스', '2026-10-23', '09:00')] } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-09-23');
});

t('(2회차 3) 이미 지난 달의 월급 후보는 바꿀 수 없음', () => {
  const app = makeApp({ now: '2026-10-24T20:00:00+09:00' });
  app.set({ S: baseS({ salaryMonth: '2026-10', salaryTxId: 999 }), TX: { rows: seedRows() } });
  const before = JSON.stringify(app.S);
  app.fn.pickSalary('2026-09', 1);
  assert.strictEqual(JSON.stringify(app.S), before);
});

t('카테고리 지출(월급 주기): 규칙 분류, 저축·이동·고정지출 제외, 환불 차감, 합계 = 이번 달 지출, 사용자가 정한 가게는 기억', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kb', 'out', 4500, 995500, '메가MGC커피', '2026-09-23', '08:00'),
    tx('kb', 'out', 12000, 983500, '김밥천국', '2026-09-23', '12:00'),
    tx('kakao', 'out', 18900, 481100, '배달의민족', '2026-09-24', '19:00'),
    tx('kakao', 'out', 5000, 476100, '쿤자PC방', '2026-09-24', '21:00'),
    tx('kb', 'out', 30000, 898500, '이니시스(', '2026-09-25', '10:00'),              // 규칙으론 기타
    tx('kb', 'in', 12000, 910500, '김밥천국', '2026-09-25', '11:00', { method: '취소' }), // 환불
    tx('kakao', 'out', 100000, 376100, '홍길동', '2026-09-25', '12:00'),             // 저축
    tx('kb', 'out', 55000, 928500, '케이티모바일', '2026-09-25', '09:00')];           // 고정지출(연결)
  app.set({ S: baseS({ fixed: [{ id: 'm', name: '통신', kw: '모바일', amount: 55000, paid: false, paidDate: '' }] }), TX: { rows } });
  app.fn.applyTxToState(null);
  let { out, total } = app.fn.cycleCategoryTotals();
  assert.deepStrictEqual({ 카페: out.카페, 식비: out.식비, 배달: out.배달, 피시방: out.피시방, 기타: out.기타 }, { 카페: 4500, 식비: 0, 배달: 18900, 피시방: 5000, 기타: 30000 });
  assert.strictEqual(total, app.fn.totSpent(), '합계 = 이번 달 지출');
  // 사용자가 '이니시스(' 가게를 쇼핑으로 정하면 기억
  app.S.catMap = { '이니시스(': '쇼핑' }; // 기억 키는 괄호 유지
  ({ out } = app.fn.cycleCategoryTotals());
  assert.strictEqual(out.쇼핑, 30000); assert.strictEqual(out.기타, 0);
  // 이 거래만 바꾸기
  app.S.txCat = { [rows[6].id]: '편의점' }; // 이니시스 거래
  ({ out } = app.fn.cycleCategoryTotals());
  assert.strictEqual(out.편의점, 30000); assert.strictEqual(out.쇼핑, 0);
});

t('(카테고리 Codex) 환불이 더 커도 합계 = 이번 달 막대, 환불은 원래 구매 카테고리, 이상한 가게 이름 안전', () => {
  const app = makeApp({ now: '2026-09-26T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kb', 'out', 30000, 970000, '올리브영', '2026-09-21', '12:00'),                              // 지난 주기 구매(쇼핑)
    tx('kb', 'out', 100000, 870000, '김밥천국', '2026-09-24', '12:00'),
    tx('kb', 'in', 30000, 900000, '올리브영', '2026-09-24', '15:00', { method: '취소' }),            // 이번 주기 환불
    tx('kakao', 'out', 7000, 493000, 'constructor', '2026-09-25', '12:00')];
  app.set({ S: baseS({ txSince: '2026-09-21' }), TX: { rows } });
  const { out, total } = app.fn.cycleCategoryTotals();
  assert.strictEqual(total, app.fn.totSpent(), '합계 = 막대');
  assert.strictEqual(out.쇼핑, 0, '음수는 0으로 보임');
  assert.strictEqual(app.fn.txCategory(rows[5]), '기타', "'constructor' 가게가 상속 속성으로 오인되지 않음");
  // 구매를 이 거래만 병원으로 바꾸면 그 환불도 병원
  app.S.txCat = { [rows[2].id]: '병원' }; // 올리브영 구매
  assert.strictEqual(app.fn.txCategory(rows[4]), '병원', '그 환불도 병원');
});

t('월급 아닌 입금은 쓸 수 있는 돈에 더함. 이동·본인 이름·저금통·환불·월급·고정 입금 같은 금액·직접 뺀 것은 제외', () => {
  const app = makeApp({ now: '2026-09-30T20:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kakao', 'in', 177200, 677200, '(주)오피엠에스', '2026-09-30', '12:22'),          // 경비정산 → 더함
    tx('kakao', 'in', 15000, 692200, '김철수', '2026-09-30', '13:00'),                  // 더치페이 → 더함
    tx('kakao', 'in', 30000, 722200, '홍길동', '2026-09-30', '13:10'),                  // 본인 이름(추정 이동) → 제외
    tx('kakao', 'in', 5000, 727200, '저금통', '2026-09-30', '13:20'),                   // 저금통 깨기 → 제외
    tx('kb', 'in', 8000, 1008000, '쿠팡', '2026-09-30', '13:30', { method: '취소' }),   // 환불 → 지출에서 차감
    tx('kakao', 'in', 50000, 777200, '엄마', '2026-09-30', '14:00'),                     // 고정 입금(5만)과 같은 금액 → 제외
    tx('kakao', 'in', 20000, 797200, '이벤트', '2026-09-30', '15:00'),                   // 사용자가 뺌
    tx('kakao', 'in', 2500000, 3297200, '오피엠에스', '2026-09-25', '10:00')];         // 월급 후보 → 제외
  app.set({ S: baseS({ txSince: '2026-09-21', fixed: [{ id: 1, name: '용돈', type: 'income', amount: 50000 }], txIncomeOff: { [rows[8].id]: true } }), TX: { rows } });
  assert.deepStrictEqual(app.fn.cycleIncomeRows().map((r) => r.counterparty), ['(주)오피엠에스', '김철수']);
  assert.strictEqual(app.fn.cycleIncome(), 192200);
  assert.strictEqual(app.fn.effectiveBudget(), 1000000 + 50000 + 192200, '예산 + 고정 입금 5만 + 입금');
  app.S.txSince = '2026-10-01'; // 알림 기록 시작 전 입금은 세지 않음
  assert.strictEqual(app.fn.cycleIncome(), 0);
});

t('입금: 같은 달 월급 후보가 둘(아직 안 고름)이면 둘 다 입금으로 안 셈 / 고정 입금 5만에 4.9만이 와도 이중 계산 안 함(검토 반영)', () => {
  const app = makeApp({ now: '2026-10-24T12:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kakao', 'in', 3100000, 3600000, '오피엠에스', '2026-10-23', '09:00'),
    tx('kakao', 'in', 2500000, 6100000, '오피엠에스', '2026-10-23', '15:00')];
  app.set({ S: baseS(), TX: { rows } });
  app.fn.applyTxToState(null);
  assert.strictEqual(app.S.budgetStart, '2026-09-23', '후보 둘이면 자동으로 주기를 시작하지 않음');
  assert.strictEqual(app.fn.cycleIncome(), 0);
  const app2 = makeApp({ now: '2026-09-30T20:00:00+09:00' });
  app2.set({ S: baseS({ fixed: [{ id: 1, name: '용돈', type: 'income', amount: 50000 }] }), TX: { rows: [...seedRows(), tx('kakao', 'in', 49000, 549000, '엄마', '2026-09-30')] } });
  assert.strictEqual(app2.fn.cycleIncome(), 0);
});

t('주기 마감: 지난 주기 입금은 이월에 더하고 기록에 남긴다', () => {
  const app = makeApp({ now: '2026-10-24T12:00:00+09:00' });
  const rows = [...seedRows(),
    tx('kakao', 'in', 100000, 600000, '(주)오피엠에스', '2026-10-01', '12:00'),
    tx('kakao', 'out', 400000, 200000, '가게', '2026-10-02', '12:00')];
  app.set({ S: baseS({ budgetStart: '2026-09-23', txSince: '2026-09-21' }), TX: { rows } });
  app.fn.startSalaryCycle({ id: 999, amount: 2500000, date: '2026-10-23' }, '2026-10');
  const c = app.S.cycles[app.S.cycles.length - 1];
  assert.strictEqual(c.income, 100000);
  assert.strictEqual(c.effective, 1000000 + 100000);
  assert.strictEqual(app.S.carry, c.effective - c.spent);
});

console.log(`\n통과 ${ok}개`);
