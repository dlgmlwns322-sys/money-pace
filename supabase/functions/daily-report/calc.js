// 텔레그램 리포트용 계산 — 앱(index.html)과 같은 식을 쓴다.
// 두 쪽이 어긋나지 않게 test/parity.test.js가 같은 데이터로 앱과 이 파일의 결과를 비교한다.
// 서버는 데이터를 고치지 않는다: 예산 주기가 끝났으면 복사본에서 앱과 똑같이 다음 주기로 넘겨 계산만 한다.

// 실제로 쓰는 계좌(카카오뱅크·국민은행). 예전 기록의 신한 값은 빠진다.
const ACCOUNT_IDS = ["kakao", "kb"];
export const sumAcc = (b) => ACCOUNT_IDS.reduce((a, id) => a + ((b && b[id]) || 0), 0);

const fxSigned = (f) => (f.type === "income" ? -1 : 1) * (f.amount || 0);
const totFixed = (S) => (S.fixed || []).reduce((a, f) => a + fxSigned(f), 0);
export const effectiveBudget = (S) => Math.max(0, (S.budget || 0) - totFixed(S));
export const unpaidFixed = (S) => (S.fixed || []).filter((f) => !f.paid).reduce((a, f) => a + fxSigned(f), 0);
const fixedPaidInRange = (S, from, to) =>
  [...(S.fixed || []).filter((f) => f.paid), ...(S.fixedPaidLog || [])]
    .filter((f) => f.paidDate && f.paidDate >= from && f.paidDate <= to && f.affectsBalance !== false)
    .reduce((a, f) => a + fxSigned(f), 0);

export function timeToMinutes(t) {
  const m = /^(오전|오후)\s*(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return 0;
  let h = parseInt(m[2], 10);
  const isPM = m[1] === "오후";
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  return h * 60 + parseInt(m[3], 10);
}

// 앱 getDailySpent와 같음: 그날 마지막 캡처와 직전 캡처의 잔액 차이(그날 빠져나간 고정지출 제외)
export function getDailySpent(S, dateStr) {
  if (!S.captures || S.captures.length < 1) return null;
  const byDate = {};
  for (const c of S.captures) {
    const x = { date: c.date, minutes: timeToMinutes(c.time), total: sumAcc(c.balances) };
    if (!byDate[x.date] || x.minutes > byDate[x.date].minutes) byDate[x.date] = x;
  }
  const prevDate = Object.keys(byDate).filter((d) => d < dateStr).sort((a, b) => b.localeCompare(a))[0];
  if (!prevDate) return null;
  const prevTotal = byDate[prevDate].total;
  const todayCap = byDate[dateStr];
  if (!todayCap) return { spent: 0, todayDate: dateStr, prevDate, todayTotal: null, prevTotal, noCaptureToday: true };
  const spent = prevTotal - todayCap.total - fixedPaidInRange(S, dateStr, dateStr);
  return { spent, todayDate: dateStr, prevDate, todayTotal: todayCap.total, prevTotal };
}

// 앱 sumSpentInRange와 같음: 기간 안 캡처일의 하루 지출 중 양수만 합산
export function sumSpentInRange(S, fromStr, toStr) {
  if (!S.captures || S.captures.length < 1) return 0;
  const dates = [...new Set(S.captures.map((c) => c.date))].filter((d) => d >= fromStr && d <= toStr).sort();
  let sum = 0;
  for (const d of dates) {
    const ds = getDailySpent(S, d);
    if (ds && !ds.noCaptureToday && ds.spent > 0) sum += ds.spent;
  }
  return sum;
}

// 앱 rollBudgetCycle과 같은 규칙(서버는 복사본에만 적용)
function addMonthsKeepDay(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
const dayAfter = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); };
const dayBefore = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd - 1)).toISOString().slice(0, 10); };
export function rollBudgetCycle(S, today) {
  if (!S.budgetStart || !S.budgetEnd) return false;
  if (!S.budgetAnchorDay) S.budgetAnchorDay = Number(S.budgetStart.slice(8, 10));
  let rolled = false, guard = 0;
  while (today > S.budgetEnd && guard++ < 240) {
    const start = S.budgetStart, end = S.budgetEnd;
    const paid = (S.fixed || []).filter((f) => f.paid && f.paidDate && f.paidDate <= end);
    S.cycles = [...(S.cycles || []), { start, end, budget: S.budget, effective: effectiveBudget(S), spent: sumSpentInRange(S, start, end), closedAt: today }].slice(-24);
    S.fixedPaidLog = [...(S.fixedPaidLog || []), ...paid.map((f) => ({ name: f.name, amount: f.amount, type: f.type || "expense", paidDate: f.paidDate, affectsBalance: f.affectsBalance }))]
      .filter((f) => f.paidDate >= addMonthsKeepDay(today, -3));
    paid.forEach((f) => { f.paid = false; f.paidDate = ""; });
    S.budgetStart = dayAfter(end);
    S.budgetEnd = dayBefore(anchorDateInMonth(S.budgetStart, 1, S.budgetAnchorDay));
    rolled = true;
  }
  return rolled;
}
function anchorDateInMonth(start, n, day) {
  const [y, m] = start.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}

function getBD(S, today) {
  if (!S.budgetStart || !S.budgetEnd) return { total: 30, elapsed: 15, remaining: 15 };
  const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const total = Math.max(1, Math.round((utc(S.budgetEnd) - utc(S.budgetStart)) / 86400000) + 1);
  const elapsed = Math.max(0, Math.min(total, Math.round((utc(today) - utc(S.budgetStart)) / 86400000) + 1));
  return { total, elapsed, remaining: Math.max(1, total - elapsed + 1) };
}

function totSpent(S, today) {
  if (S.budgetStart && S.budgetEnd && S.captures && S.captures.length) {
    return sumSpentInRange(S, S.budgetStart, today < S.budgetEnd ? today : S.budgetEnd);
  }
  const tb = sumAcc(S.balances);
  if (tb <= 0) return 0;
  return Math.max(0, effectiveBudget(S) - Math.max(0, tb - unpaidFixed(S)));
}

function weekStartOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const now = new Date(Date.UTC(y, m - 1, d));
  const dow = now.getUTCDay();
  now.setUTCDate(now.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return now.toISOString().slice(0, 10);
}

// 리포트에 쓰는 숫자 전부. 앱의 같은 이름 함수들과 결과가 같아야 한다.
export function buildNumbers(input, today) {
  const S = structuredClone(input);
  rollBudgetCycle(S, today);
  const eff = effectiveBudget(S);
  const spent = totSpent(S, today);
  const { total, elapsed, remaining } = getBD(S, today);
  const ds = getDailySpent(S, today);
  const remainAtDayStart = (ds && ds.prevTotal != null)
    ? Math.min(eff, Math.max(0, ds.prevTotal - unpaidFixed(S)))
    : (eff - spent);
  const baseline = remaining > 0 ? Math.floor(Math.max(0, remainAtDayStart) / remaining) : 0;
  const todayBudget = baseline - ((ds && !ds.noCaptureToday && ds.spent > 0) ? ds.spent : 0);
  const weekStart = weekStartOf(today);
  const hasWeekCap = (S.captures || []).some((c) => c.date >= weekStart && c.date <= today);
  const weekSpent = hasWeekCap ? sumSpentInRange(S, weekStart, today) : 0;
  const yd = dayBefore(today);
  const ydDaily = getDailySpent(S, yd);
  return { S, eff, spent, remain: eff - spent, total, elapsed, remaining, todayBudget, weekStart, weekSpent, yd, ydDaily };
}
