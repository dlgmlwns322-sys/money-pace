// 테스트용: index.html의 메인 스크립트를 통째로 불러와(화면은 가짜) 앱 함수를 그대로 쓴다.
// 정규식으로 함수를 골라 붙이던 방식 대신 — 앱 코드를 고쳐도 테스트를 따라 고칠 일이 적다.
// confirm: opt.confirm(메시지) → true/false (없으면 늘 확인)
// 사용: const app = require('./app')({ now: '2026-09-26T12:00:00+09:00' }); app.set({S, TX}); app.fn.sumSpentInRange(...)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts.sort((a, b) => b.length - a.length)[0]; // 가장 긴 인라인 스크립트가 앱 본체

const EXPORTS = ['gaugeHtml', 'sumSpentInRange', 'getDailySpent', 'txGaps', 'txWithFlags', 'applyTxToState', 'getTodayBudget', 'getBD', 'effectiveBudget',
  'totSpent', 'getWeeklySpent', 'cycleSavings', 'syncSalaryCycle', 'salaryCandidates', 'undoSalary', 'pickSalary', 'linkFixedTx', 'fixedCandidates',
  'confirmFixed', 'toggleFixed', 'computeNotices', 'toStr', 'txDate', 'capMs', 'timeToMinutes', 'weeklyShare', 'recomputeClosedCycles', 'balanceBefore', 'cycleCategoryTotals', 'txCategory', 'cycleIncome', 'cycleIncomeRows', 'startSalaryCycle', 'pendingOwnIncomeRows', 'resolveOwnIncome'];

module.exports = function makeApp(opt = {}) {
  let nowMs = Date.parse(opt.now || '2026-09-26T12:00:00+09:00');
  const RealDate = Date;
  const now = () => (opt.nowFn ? opt.nowFn() : nowMs); // nowFn: 테스트가 시각을 바꿔 가며 쓸 때
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } }
  const store = new Map();
  const el = () => new Proxy({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {},
    value: '', textContent: '', innerHTML: '', appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
  { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { t[k] = v; return true; } });
  const document = { getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], createElement: () => el(), addEventListener() {}, body: el(), hidden: false, activeElement: null };
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: () => null, get length() { return 0; } };
  const window = { TxParse: require(path.join(root, 'txparse.js')), Payday: require(path.join(root, 'payday.js')), Category: require(path.join(root, 'category.js')), addEventListener() {}, confirm: (m) => (opt.confirm ? opt.confirm(m) : true), location: { href: '' } };
  const ctx = { Date: FakeDate, document, localStorage, window, Payday: window.Payday, TxParse: window.TxParse, Category: window.Category, navigator: {}, Notification: undefined, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} },
    fetch: async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '', headers: { get: () => null } }), alert() {}, confirm: (m) => (opt.confirm ? opt.confirm(m) : true), console, Object };
  const body = `with(ctx){${main}\n;return{get S(){return S},set S(v){S=v},get TX(){return TX},set TX(v){TX=v},fn:{${EXPORTS.map((n) => `${n}:typeof ${n}==='function'?${n}:undefined`).join(',')}}};}`;
  const api = new Function('ctx', body)(ctx);
  return {
    fn: api.fn,
    get S() { return api.S; },
    // 넘긴 객체를 그대로 쓴다(테스트가 같은 객체로 결과를 확인할 수 있게). 빠진 기본값만 채운다.
    set(o) { if (o.S) { for (const [k, v] of Object.entries({ balances: {}, balanceAt: {}, balanceTxId: {}, captures: [], fixed: [], memos: {}, cycles: [] })) if (o.S[k] == null) o.S[k] = v; api.S = o.S; } if (o.TX) { if (!o.TX.rows) o.TX.rows = []; api.TX = o.TX; } },
    setNow(iso) { nowMs = Date.parse(iso); },
  };
};
