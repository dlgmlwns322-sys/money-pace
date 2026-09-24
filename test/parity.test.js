// 앱(index.html)과 텔레그램 리포트(daily-report/calc.js)가 같은 데이터로 같은 숫자를 내는지.
// 실행: node test/parity.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const pick=re=>{const m=html.match(re);assert(m,'not found: '+re);return m[0];};
const appSrc=[
  /const ACCOUNTS=[^\n]*/,/const sumAcc=[^\n]*/,/const fxSigned=[^\n]*/,/const totFixed=[^\n]*/,
  /const effectiveBudget=[^\n]*/,/const unpaidFixed=[^\n]*/,/const fixedPaidInRange=[^\n]*/,/const usableBal=[^\n]*/,
  /const totBal=[^\n]*/,/function timeToMinutes\(t\)\{[\s\S]*?\n\}/,/function getDailySpent\(dateStr\)\{[\s\S]*?\n\}/,
  /function sumSpentInRange\(fromStr, toStr\)\{[\s\S]*?\n\}/,/function addMonthsKeepDay\(dateStr,n\)\{[\s\S]*?\n\}/,
  /const dayAfter=[^\n]*/,/const dayBefore=[^\n]*/,/function rollBudgetCycle\(\)\{[\s\S]*?\n\}/,/function anchorDateInMonth\(start,n,day\)\{[\s\S]*?\n\}/,
  /function getBD\(\)\{[\s\S]*?\n\}/,/const totSpent=\(\)=>\{[\s\S]*?\n\};/,/function getWeekInfo\(\)\{[\s\S]*?\n\}/,
  /function getWeeklySpent\(\)\{[\s\S]*?\n\}/,/function getTodayBudget\(\)\{[\s\S]*?\n\}/,
].map(pick).join('\n');

(async()=>{
  const calc=await import('../supabase/functions/daily-report/calc.js');
  let today;
  const app=new Function('ctx',`with(ctx){let S;${appSrc}
    return{setS:v=>{S=v},getS:()=>S,rollBudgetCycle,totSpent,effectiveBudget,getTodayBudget,getWeeklySpent,getBD};}`)({toStr:()=>today});

  const cap=(date,time,kakao,kb)=>({date,time,balances:{kakao,kb,shinhan:777}});
  const base={budget:1000000,weeklyBudget:250000,budgetStart:'2026-08-25',budgetEnd:'2026-09-24',
    balances:{kakao:420000,kb:300000},
    fixed:[{name:'통신비',amount:60000,paid:true,paidDate:'2026-09-10'},{name:'월세',amount:300000,paid:false,paidDate:''},
           {name:'용돈입금',amount:200000,type:'income',paid:true,paidDate:'2026-09-15'},{name:'적금',amount:100000,paid:true,paidDate:'2026-09-05',affectsBalance:false}],
    fixedPaidLog:[{name:'지난통신비',amount:60000,paidDate:'2026-08-26'}],
    captures:[cap('2026-08-25','오전 9:00',800000,400000),cap('2026-08-26','오후 10:00',760000,400000),
      cap('2026-09-01','오후 11:00',700000,390000),cap('2026-09-10','오후 12:30',600000,380000),
      cap('2026-09-10','오전 8:00',650000,380000),cap('2026-09-15','오후 9:00',820000,370000),
      cap('2026-09-21','오후 9:00',500000,330000),cap('2026-09-22','오후 9:00',470000,320000)],
    memos:{}};

  let n=0;
  for(const d of ['2026-09-22','2026-09-23','2026-09-24','2026-09-26','2026-10-01']){
    today=d;
    const S=JSON.parse(JSON.stringify(base));
    app.setS(S);app.rollBudgetCycle();
    const a={eff:app.effectiveBudget(),spent:app.totSpent(),todayBudget:app.getTodayBudget(),
      week:(app.getWeeklySpent()||{spent:0}).spent,bd:app.getBD()};
    const s=calc.buildNumbers(base,d);
    assert.strictEqual(s.eff,a.eff,`eff ${d}`);
    assert.strictEqual(s.spent,a.spent,`spent ${d}`);
    assert.strictEqual(s.todayBudget,a.todayBudget,`todayBudget ${d}`);
    assert.strictEqual(s.weekSpent,a.week,`week ${d}`);
    assert.deepStrictEqual({total:s.total,elapsed:s.elapsed,remaining:s.remaining},a.bd,`bd ${d}`);
    assert.strictEqual(s.S.budgetStart,app.getS().budgetStart,`cycle ${d}`);
    console.log('ok -',d,JSON.stringify({spent:a.spent,today:a.todayBudget,week:a.week}));n++;
  }
  assert.strictEqual(base.budgetStart,'2026-08-25','서버 계산은 원본을 바꾸지 않는다');
  console.log(`\n통과 ${n}개 (앱=리포트)`);
})().catch(e=>{console.error(e);process.exit(1);});
