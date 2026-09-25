// 예전 서버 리포트 계산(calc.js, 텔레그램용 — 2026-09-26 폐기) 자리에 쓰는 호환 모듈.
// 같은 이름의 함수를 앱 코드(test/app.js)로 계산해 준다 → 기존 테스트가 기대값을 그대로 확인할 수 있다.
const makeApp = require('./app');
const run = (S, tx, today, f) => {
  const app = makeApp({ now: (today || '2026-09-26') + 'T12:00:00+09:00' });
  app.set({ S: JSON.parse(JSON.stringify(S)), TX: { rows: JSON.parse(JSON.stringify(tx || [])) } });
  return f(app);
};
module.exports = {
  txDate: (at) => makeApp().fn.txDate(at),
  sumSpentInRange: (S, from, to, tx = []) => run(S, tx, to, (a) => a.fn.sumSpentInRange(from, to)),
  getDailySpent: (S, d, tx = []) => run(S, tx, d, (a) => a.fn.getDailySpent(d)),
  txGaps: (tx, S = {}) => run(S, tx, null, (a) => a.fn.txGaps()),
  buildNumbers: (S, today, tx = []) => run(S, tx, today, (a) => ({ todayBudget: a.fn.getTodayBudget(), eff: a.fn.effectiveBudget(), spent: a.fn.totSpent() })),
};
