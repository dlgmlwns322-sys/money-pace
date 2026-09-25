// 월급날·예산 주기 자동 계산(2026-09-26). 앱(index.html)과 테스트(node)가 함께 쓴다.
// - 예상 월급일: 매달 월급날(기본 25일)이 주말·공휴일이면 그 전 영업일(예: 2026-09-25 추석 → 9/23).
// - 월급 판정: 입금 + 보낸 곳에 회사 이름 포함 + 기준 금액 이상 + 예상 월급일 ±7일. 같은 달 후보가 둘 이상이면 자동으로 정하지 않는다.
// 공휴일: @hyunbinseo/holidays-kr 5.2027.2(대체공휴일 포함)에서 옮김. 이 표에 없는 해는 주말만 반영(추정).
(function (root) {
  const HOLIDAYS = new Set(('2026-01-01 2026-02-16 2026-02-17 2026-02-18 2026-03-01 2026-03-02 2026-05-01 2026-05-05 2026-05-24 2026-05-25 ' +
    '2026-06-03 2026-06-06 2026-07-17 2026-08-15 2026-08-17 2026-09-24 2026-09-25 2026-09-26 2026-10-03 2026-10-05 2026-10-09 2026-12-25 ' +
    '2027-01-01 2027-02-06 2027-02-07 2027-02-08 2027-02-09 2027-03-01 2027-05-01 2027-05-03 2027-05-05 2027-05-13 2027-06-06 2027-07-17 ' +
    '2027-07-19 2027-08-15 2027-08-16 2027-09-14 2027-09-15 2027-09-16 2027-10-03 2027-10-04 2027-10-09 2027-10-11 2027-12-25 2027-12-27').split(' '));
  const HOLIDAY_YEARS = [2026, 2027];

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(y, m, d + n); };
  const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400e3);
  const isBusinessDay = (s) => dow(s) !== 0 && dow(s) !== 6 && !HOLIDAYS.has(s);
  const holidayKnown = (s) => HOLIDAY_YEARS.includes(Number(s.slice(0, 4)));

  // y년 m월의 예상 월급일(월급날이 그 달에 없으면 말일)
  function expectedPayday(y, m, payDay = 25) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let s = ymd(y, m, Math.min(payDay, last));
    while (!isBusinessDay(s)) s = addDays(s, -1);
    return s;
  }
  const monthOf = (s) => s.slice(0, 7);
  const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
  const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };
  const paydayOfMonth = (ym, payDay) => { const [y, m] = ym.split('-').map(Number); return expectedPayday(y, m, payDay); };

  // 월급이 속한 달(급여 귀속 달): 그 날짜와 가장 가까운 예상 월급일의 달(늦게 들어와도 한 달을 건너뛰지 않게)
  function payMonthOf(date, payDay = 25) {
    const cands = [prevMonth(monthOf(date)), monthOf(date), nextMonth(monthOf(date))];
    let best = null, bestGap = Infinity;
    for (const ym of cands) { const g = Math.abs(dayDiff(date, paydayOfMonth(ym, payDay))); if (g < bestGap) { bestGap = g; best = ym; } }
    return { month: best, gap: bestGap };
  }
  // 이 주기(귀속 달)의 예상 종료일 = 다음 달 예상 월급일 전날
  const cycleEndFor = (payMonth, payDay = 25) => addDays(paydayOfMonth(nextMonth(payMonth), payDay), -1);

  // 월급 후보 찾기. rows: [{id, type, amount, counterparty, method, date(가계부 날짜)}]
  // opt: {payer(회사명 또는 [이름들]), min, payDay, window, rejected:Set(id)}
  // 보낸 곳이나 입금 방식에 이름이 들어 있으면 후보. 요즘 월급은 회사명 대신 '급여'로 찍혀서(2026-09-26 사용자) 앱이 '급여'도 같이 넘긴다.
  // 돌려줌: 귀속 달별 {month, picks:[row...]} (picks가 1개면 확정, 2개 이상이면 사용자 확인 필요)
  function findSalaries(rows, opt) {
    const names = [].concat(opt.payer || []).map((x) => String(x || '').replace(/\s/g, '')).filter(Boolean);
    if (!names.length) return [];
    const min = opt.min ?? 2000000, payDay = opt.payDay || 25, win = opt.window ?? 7, rejected = opt.rejected || new Set();
    const byMonth = new Map();
    for (const r of rows) {
      if (r.type !== 'in' || rejected.has(r.id) || (r.amount || 0) < min) continue;
      const text = (String(r.counterparty || '') + ' ' + String(r.method || '')).replace(/\s/g, '');
      if (!names.some((nm) => text.includes(nm))) continue;
      if (/경비|정산|상여|보너스|성과/.test(text)) continue; // 같은 회사라도 경비·상여 등은 월급 아님(200만 넘어도)
      const { month, gap } = payMonthOf(r.date, payDay);
      if (gap > win) continue;
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(r);
    }
    return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, picks]) => ({ month, picks }));
  }

  const api = { HOLIDAYS, isBusinessDay, holidayKnown, expectedPayday, payMonthOf, cycleEndFor, findSalaries, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Payday = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
