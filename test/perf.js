// 성능: 100일×하루 10건(1,000건) 거래로 앱 계산 시간
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const pick=re=>html.match(re)[0];
const txBlock=html.slice(html.indexOf('// ── 입출금 알림 거래 ──'),html.indexOf('function getBD(){'));
const src=txBlock+'\n'+[/const ACCOUNTS=[^\n]*/,/const sumAcc=[^\n]*/,/const fxSigned=[^\n]*/,/const totFixed=[^\n]*/,/const effectiveBudget=[^\n]*/,/const unpaidFixed=[^\n]*/,/const fixedPaidInRange=[^\n]*/,/const usableBal=[^\n]*/,/const totBal=[^\n]*/,/function timeToMinutes\(t\)\{[\s\S]*?\n\}/,/function getDailySpent\(dateStr\)\{[\s\S]*?\n\}/,/function sumSpentInRange\(fromStr, toStr\)\{[\s\S]*?\n\}/,/const dayAfter=[^\n]*/,/const dayBefore=[^\n]*/,/function getBD\(\)\{[\s\S]*?\n\}/,/const totSpent=\(\)=>\{[\s\S]*?\n\};/,/function getWeekInfo\(\)\{[\s\S]*?\n\}/,/function getWeeklySpent\(\)\{[\s\S]*?\n\}/,/function getTodayBudget\(\)\{[\s\S]*?\n\}/].map(pick).join('\n');
const TxParse=require(path.join(process.cwd(),'txparse.js'));
let today='2026-10-24';
const app=new Function('ctx',`with(ctx){let S;${src}
 return{setS:v=>{S=v},setTX:v=>{TX=v},totSpent,getTodayBudget,getWeeklySpent};}`)({toStr:()=>today,localStorage:{getItem:()=>null,setItem:()=>{}},window:{TxParse},render:()=>{},save:()=>{},escapeHtml:x=>x,won:x=>x,document:{getElementById:()=>null}});
const rows=[];let id=0,bal={kakao:5e6,kb:5e6};
for(let d=0;d<100;d++){for(let k=0;k<10;k++){const bank=k%2?'kakao':'kb';const out=k%5!==0;const amt=1000+k*100;bal[bank]+=out?-amt:amt;
 const t=new Date(Date.UTC(2026,6,17+d,1+k)).toISOString();rows.push({id:++id,bank,type:out?'out':'in',amount:amt,balance:bal[bank],counterparty:'가게'+k,at:t});}}
app.setS({budget:1e6,budgetStart:'2026-09-25',budgetEnd:'2026-10-24',txSince:'2026-07-18',captures:[],fixed:[],balances:{},ownerNames:'홍길동'});
app.setTX({rows});
let t0=Date.now();const a=app.totSpent();const b=app.getTodayBudget();const c=app.getWeeklySpent();
console.log('1000건: totSpent',a,'todayBudget',b,'week',c&&c.spent,'→',Date.now()-t0,'ms');
