// 월급이 들어온 가계부 첫날: 전날 잔액을 기준으로 계산해도 새 월급을 빠뜨리지 않는다.
const assert = require('assert');
const makeApp = require('./app');
const app = makeApp({now:'2026-10-23T14:00:00+09:00'});
const at = (date, time) => `${date}T${time}:00+09:00`;
const tx = (id, bank, type, amount, balance, counterparty, date, time) =>
  ({id, bank, type, amount, balance, counterparty, at:at(date,time)});
const rows = [
  tx(1,'kakao','out',1,90000,'가게','2026-10-22','20:00'),
  tx(2,'kb','out',1,10000,'가게','2026-10-22','20:01'),
  tx(3,'kakao','in',2400000,2490000,'급여','2026-10-23','09:00'),
  tx(4,'kakao','out',1000000,1490000,'토스 홍길동','2026-10-23','10:00'),
  tx(5,'kakao','out',400000,1090000,'관리','2026-10-23','10:10'),
  tx(6,'kakao','out',200000,890000,'학원','2026-10-23','10:20'),
  tx(7,'kakao','out',45000,845000,'식당','2026-10-23','12:00'),
  tx(8,'kakao','out',5000,840000,'카페','2026-10-23','13:00'),
];
const S = {budget:2300000,budgetStart:'2026-10-23',budgetEnd:'2026-11-24',txSince:'2026-09-29',
  ownerNames:'홍길동',salaryTxId:3,salaryAmount:2400000,salaryMonth:'2026-10',
  balances:{kakao:840000,kb:10000},balanceTxId:{kakao:8,kb:2},
  balanceAt:{kakao:rows[7].at,kb:rows[1].at},captures:[],memos:{},fixed:[
    {id:'a',amount:1000000,paid:true,paidDate:'2026-10-23'},
    {id:'b',amount:400000,paid:true,paidDate:'2026-10-23'},
    {id:'c',amount:200000,paid:true,paidDate:'2026-10-23'},
    {id:'d',amount:100000,paid:false},
  ]};
app.set({S,TX:{rows}});
assert.strictEqual(app.fn.getDailySpent().spent,50000);
assert.strictEqual(app.fn.getTodayBudget(),-25758,
  '전날 잔액 100,000 + 월급 2,400,000 − 고정지출 1,700,000 = 800,000; 33일 몫 24,242 − 50,000');

// 이튿날에는 월급을 또 더하지 않는다.
app.setNow('2026-10-24T14:00:00+09:00');
assert.notStrictEqual(app.fn.getTodayBudget(),-25758);
console.log('통과: 월급 입금 첫날만 월급 포함, 다음 날 중복 없음');
