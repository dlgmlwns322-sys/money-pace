// 예산 주기 자동 전환·지출 계산 검증. 실행: node test/cycle.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const pick=re=>{const m=html.match(re);assert(m,'not found: '+re);return m[0];};
const txBlock=(()=>{const a=html.indexOf('// ── 입출금 알림 거래 ──'),b=html.indexOf('function getBD(){');assert(a>0&&b>a,'tx block');return html.slice(a,b);})();
const src=[txBlock,
  pick(/const ACCOUNTS=[^\n]*/),
  pick(/const sumAcc=[^\n]*/),
  pick(/const fxSigned=[^\n]*/),
  pick(/const totFixed=[^\n]*/),
  pick(/const effectiveBudget=[^\n]*/),
  pick(/const fixedPaidInRange=[^\n]*/),
  pick(/function timeToMinutes\(t\)\{[\s\S]*?\n\}/),
  pick(/function getDailySpent\(dateStr\)\{[\s\S]*?\n\}/),
  pick(/function sumSpentInRange\(fromStr, toStr\)\{[\s\S]*?\n\}/),
  pick(/function addMonthsKeepDay\(dateStr,n\)\{[\s\S]*?\n\}/),
  pick(/const dayAfter=[^\n]*/),
  pick(/const dayBefore=[^\n]*/),
  pick(/function rollBudgetCycle\(\)\{[\s\S]*?\n\}/),
  pick(/function anchorDateInMonth\(start,n,day\)\{[\s\S]*?\n\}/),
].join('\n');
let today='2026-09-20';
const run=new Function('ctx',`with(ctx){let S;${src}
  return{setS:v=>{S=v},getS:()=>S,rollBudgetCycle,sumSpentInRange,addMonthsKeepDay};}`)({toStr:()=>today,localStorage:{getItem:()=>null,setItem:()=>{}},window:{},render:()=>{},save:()=>{},escapeHtml:x=>x,won:x=>x,document:{getElementById:()=>null}});
let ok=0;const t=(n,f)=>{f();ok++;console.log('ok -',n);};
const cap=(date,kakao,kb)=>({date,time:'오후 9:00',balances:{kakao,kb,shinhan:999999}});

t('신한 값은 계산에서 빠진다', () => {
  run.setS({captures:[cap('2026-09-01',100000,100000),cap('2026-09-02',90000,100000)],fixed:[]});
  assert.strictEqual(run.sumSpentInRange('2026-09-01','2026-09-02'),10000);
});

t('월말 날짜 보정', () => {
  assert.strictEqual(run.addMonthsKeepDay('2026-01-31',1),'2026-02-28');
  assert.strictEqual(run.addMonthsKeepDay('2026-09-25',1),'2026-10-25');
});

t('종료일이 지나면 다음 주기로 넘어가고 결산이 남는다', () => {
  today='2026-09-26';
  run.setS({budget:700000,budgetStart:'2026-08-25',budgetEnd:'2026-09-24',
    captures:[cap('2026-08-25',500000,200000),cap('2026-09-01',450000,200000)],
    fixed:[{name:'통신비',amount:50000,paid:true,paidDate:'2026-09-10'},{name:'월급',amount:2000000,type:'income',paid:true,paidDate:'2026-08-25'}]});
  assert.strictEqual(run.rollBudgetCycle(),true);
  const S=run.getS();
  assert.strictEqual(S.budgetStart,'2026-09-25');
  assert.strictEqual(S.budgetEnd,'2026-10-24');
  assert.strictEqual(S.cycles.length,1);
  assert.strictEqual(S.cycles[0].start,'2026-08-25');
  assert.strictEqual(S.cycles[0].spent,50000);
  assert.ok(S.fixed.every(f=>!f.paid&&!f.paidDate),'체크 해제');
  assert.strictEqual(S.fixedPaidLog.length,2,'납부 기록 보관');
});

t('주기가 넘어가도 지난 기간 지출 보정은 그대로', () => {
  // 9/10에 고정지출 5만원이 빠져나간 날: 잔액 감소 6만원 중 1만원만 지출
  const S0={budget:700000,budgetStart:'2026-08-25',budgetEnd:'2026-09-24',
    captures:[cap('2026-09-09',300000,0),cap('2026-09-10',240000,0)],
    fixed:[{name:'통신비',amount:50000,paid:true,paidDate:'2026-09-10'}]};
  today='2026-09-20';run.setS(JSON.parse(JSON.stringify(S0)));
  const before=run.sumSpentInRange('2026-09-10','2026-09-10');
  today='2026-09-26';run.rollBudgetCycle();
  const after=run.sumSpentInRange('2026-09-10','2026-09-10');
  assert.strictEqual(before,10000);
  assert.strictEqual(after,10000);
});

t('여러 달 안 열었으면 여러 주기를 넘긴다', () => {
  today='2026-12-01';
  run.setS({budget:1,budgetStart:'2026-08-25',budgetEnd:'2026-09-24',captures:[],fixed:[]});
  run.rollBudgetCycle();
  const S=run.getS();
  assert.strictEqual(S.budgetStart,'2026-11-25');
  assert.strictEqual(S.budgetEnd,'2026-12-24');
  assert.strictEqual(S.cycles.length,3);
});

t('기간 안이면 아무것도 안 한다', () => {
  today='2026-09-20';
  run.setS({budget:1,budgetStart:'2026-08-25',budgetEnd:'2026-09-24',captures:[],fixed:[]});
  assert.strictEqual(run.rollBudgetCycle(),false);
});

t('31일 기준일은 짧은 달을 지나도 돌아온다', () => {
  today='2026-04-01';
  run.setS({budget:1,budgetStart:'2026-01-31',budgetEnd:'2026-02-27',captures:[],fixed:[]});
  run.rollBudgetCycle();
  const S=run.getS();
  assert.strictEqual(S.budgetStart,'2026-03-31');
  assert.strictEqual(S.budgetEnd,'2026-04-29');
});

t('새 주기에 이미 낸 고정지출은 체크 유지', () => {
  today='2026-09-27';
  run.setS({budget:1,budgetStart:'2026-08-25',budgetEnd:'2026-09-24',captures:[],
    fixed:[{name:'월세',amount:1,paid:true,paidDate:'2026-09-25'},{name:'통신',amount:1,paid:true,paidDate:'2026-09-10'}]});
  run.rollBudgetCycle();
  const S=run.getS();
  assert.strictEqual(S.fixed[0].paid,true);
  assert.strictEqual(S.fixed[1].paid,false);
  assert.strictEqual(S.fixedPaidLog.length,1);
});

console.log(`\n통과 ${ok}개`);
