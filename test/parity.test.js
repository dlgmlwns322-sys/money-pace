// 앱(index.html)과 텔레그램 리포트(daily-report/calc.js)가 같은 데이터로 같은 숫자를 내는지.
// 실행: node test/parity.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const pick=re=>{const m=html.match(re);assert(m,'not found: '+re);return m[0];};
const txBlock=(()=>{const a=html.indexOf('// ── 입출금 알림 거래 ──'),b=html.indexOf('function getBD(){');assert(a>0&&b>a,'tx block');return html.slice(a,b);})();
const appSrc=txBlock+'\n'+[
  /const ACCOUNTS=[^\n]*/,/const sumAcc=[^\n]*/,/const fxSigned=[^\n]*/,/const totFixed=[^\n]*/,
  /const effectiveBudget=[^\n]*/,/const unpaidFixed=[^\n]*/,/const fixedPaidInRange=[^\n]*/,/const usableBal=[^\n]*/,
  /const totBal=[^\n]*/,/function timeToMinutes\(t\)\{[\s\S]*?\n\}/,/function getDailySpent\(dateStr\)\{[\s\S]*?\n\}/,
  /function sumSpentInRange\(fromStr, toStr\)\{[\s\S]*?\n\}/,/function addMonthsKeepDay\(dateStr,n\)\{[\s\S]*?\n\}/,
  /const dayAfter=[^\n]*/,/const dayBefore=[^\n]*/,/function rollBudgetCycle\(\)\{[\s\S]*?\n\}/,/function anchorDateInMonth\(start,n,day\)\{[\s\S]*?\n\}/,
  /function getBD\(\)\{[\s\S]*?\n\}/,/const totSpent=\(\)=>\{[\s\S]*?\n\};/,/function getWeekInfo\(\)\{[\s\S]*?\n\}/,
  /function getWeeklySpent\(\)\{[\s\S]*?\n\}/,/function getTodayBudget\(\)\{[\s\S]*?\n\}/,
].map(pick).join('\n');

(async()=>{
  const TxParse=require('../txparse.js');globalThis.TxParse=TxParse;
  const calc=await import('../supabase/functions/daily-report/calc.js');
  let today;
  const app=new Function('ctx',`with(ctx){let S;${appSrc}
    return{setS:v=>{S=v},getS:()=>S,setTX:v=>{TX=v},rollBudgetCycle,totSpent,effectiveBudget,getTodayBudget,getWeeklySpent,getBD};}`)({toStr:()=>today,
    localStorage:{getItem:()=>null,setItem:()=>{}},window:{TxParse},render:()=>{},save:()=>{},escapeHtml:x=>x,won:x=>x,document:{getElementById:()=>null}});

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

  // 알림 거래 시나리오: 9/20부터 알림(txSince 9/21), 월급 입금일 지출·내 계좌 이동·본인 이름 이동 추정·사용자 지정 포함
  const txRows=[
    {id:1,bank:'kb',type:'out',amount:5000,balance:295000,counterparty:'편의점',at:'2026-09-20T10:00:00+09:00'},
    {id:2,bank:'kb',type:'in',amount:2500000,balance:2795000,counterparty:'회사',at:'2026-09-21T09:00:00+09:00'},
    {id:3,bank:'kb',type:'out',amount:12000,balance:2783000,counterparty:'식당',at:'2026-09-21T12:30:00+09:00'},
    {id:4,bank:'kb',type:'out',amount:300000,balance:2483000,counterparty:'토스홍길동',at:'2026-09-21T13:00:00+09:00'},
    {id:5,bank:'kakao',type:'in',amount:300000,balance:600000,counterparty:'홍길동',at:'2026-09-21T13:03:00+09:00'},
    {id:6,bank:'kakao',type:'out',amount:4500,balance:595500,counterparty:'스타벅스',at:'2026-09-22T08:10:00+09:00'},
    {id:7,bank:'kakao',type:'out',amount:100000,balance:495500,counterparty:'홍길동',at:'2026-09-22T20:00:00+09:00'},
    {id:8,bank:'kb',type:'out',amount:60000,balance:2423000,counterparty:'통신사',at:'2026-09-22T09:00:00+09:00'},
    {id:9,bank:'kb',type:'out',amount:7000,balance:2416000,counterparty:'모르는가게',at:'2026-09-23T19:00:00+09:00'},
  ];
  const txBase={...JSON.parse(JSON.stringify(base)),txSince:'2026-09-21',ownerNames:'홍길동',txOverrides:{9:{transfer:true}},
    fixed:[...base.fixed,{name:'통신비2',amount:60000,paid:true,paidDate:'2026-09-22'}]};
  let n=0;
  for(const d of ['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-26']){
    today=d;
    const S=JSON.parse(JSON.stringify(txBase));
    app.setS(S);app.setTX({rows:JSON.parse(JSON.stringify(txRows))});app.rollBudgetCycle();
    const a={eff:app.effectiveBudget(),spent:app.totSpent(),todayBudget:app.getTodayBudget(),week:(app.getWeeklySpent()||{spent:0}).spent,bd:app.getBD()};
    const s=calc.buildNumbers(txBase,d,txRows);
    assert.strictEqual(s.eff,a.eff,`tx eff ${d}`);assert.strictEqual(s.spent,a.spent,`tx spent ${d}`);
    assert.strictEqual(s.todayBudget,a.todayBudget,`tx todayBudget ${d}`);assert.strictEqual(s.weekSpent,a.week,`tx week ${d}`);
    console.log('ok - 알림',d,JSON.stringify({spent:a.spent,today:a.todayBudget,week:a.week}));n++;
  }
  // 9/21: 식당 12,000만 지출(월급 입금이 지출을 지우지 않음, 내 계좌 이동 300,000 제외)
  today='2026-09-21';{const S=JSON.parse(JSON.stringify(txBase));app.setS(S);app.setTX({rows:JSON.parse(JSON.stringify(txRows))});
    const dsum=calc.sumSpentInRange(txBase,'2026-09-21','2026-09-21',txRows);assert.strictEqual(dsum,12000,'9/21 지출');}
  // 9/22: 스타벅스 4,500 + 홍길동 100,000(짝 없는 본인 이름=이동 추정이지만 지출로 셈) + 통신사 60,000 − 고정지출 60,000 = 104,500
  assert.strictEqual(calc.sumSpentInRange(txBase,'2026-09-22','2026-09-22',txRows),104500,'9/22 지출');
  // 9/23: 사용자가 이동으로 지정한 7,000 제외 → 0
  assert.strictEqual(calc.sumSpentInRange(txBase,'2026-09-23','2026-09-23',txRows),0,'9/23 지출');
  console.log('ok - 알림 지출 규칙(월급일·내 계좌 이동·추정·사용자 지정·고정지출)');n++;

  // 감사 반영 규칙: 고정'입금' 체크가 지출을 늘리지 않음 / 환불은 지출에서 뺌 / 잔액이 안 맞으면 누락분을 지출로
  {
    const T=[
      {id:1,bank:'kakao',type:'out',amount:10000,balance:90000,counterparty:'가게A',at:'2026-09-22T10:00:00+09:00'},
      {id:2,bank:'kakao',type:'in',amount:10000,balance:100000,counterparty:'가게A',method:'취소',at:'2026-09-23T10:00:00+09:00'},
      {id:3,bank:'kakao',type:'out',amount:5000,balance:80000,counterparty:'가게B',at:'2026-09-24T10:00:00+09:00'}, // 앞 잔액 100,000−5,000=95,000인데 80,000 → 15,000 누락
    ];
    const S0={budget:1000000,budgetStart:'2026-09-21',budgetEnd:'2026-10-20',txSince:'2026-09-21',captures:[],balances:{},
      fixed:[{name:'월급',amount:3000000,type:'income',paid:true,paidDate:'2026-09-22'}]};
    assert.strictEqual(calc.sumSpentInRange(S0,'2026-09-22','2026-09-22',T),10000,'고정입금 체크가 지출을 늘리면 안 됨');
    assert.strictEqual(calc.sumSpentInRange(S0,'2026-09-22','2026-09-23',T),0,'환불로 되돌림');
    assert.strictEqual(calc.sumSpentInRange(S0,'2026-09-24','2026-09-24',T),20000,'가게B 5,000 + 누락 15,000');
    assert.deepStrictEqual(calc.txGaps(T).map(g=>[g.afterId,g.amount]),[[3,15000]]);
    // 앱도 같은 값
    today='2026-09-25';app.setS(JSON.parse(JSON.stringify(S0)));app.setTX({rows:JSON.parse(JSON.stringify(T))});
    assert.strictEqual(app.totSpent(),calc.buildNumbers(S0,'2026-09-25',T).spent,'앱=리포트(환불·누락·고정입금)');
    assert.strictEqual(app.totSpent(),20000);
    console.log('ok - 고정입금·환불·누락 감지 규칙(앱=리포트)');n++;
  }

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
