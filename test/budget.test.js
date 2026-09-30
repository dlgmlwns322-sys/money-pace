// 예산·지출 계산 기대값 검증(예전 parity: 앱=서버 리포트 비교였는데 서버 계산은 2026-09-26 폐기). 실행: node test/budget.test.js
const assert=require('assert');
let nowMs=Date.parse('2026-09-26T12:00:00+09:00');
const A=require('./app')({nowFn:()=>nowMs});
const calc=require('./calc-shim');
let today;
const setToday=d=>{today=d;nowMs=Date.parse(d+'T12:00:00+09:00');};
const app={setS:v=>A.set({S:v}),getS:()=>A.S,setTX:v=>A.set({TX:v}),...A.fn};
(async()=>{
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
  // 9/21: 식당 12,000만 지출(월급 입금이 지출을 지우지 않음, 내 계좌 이동 300,000 제외)
  setToday('2026-09-21');{const S=JSON.parse(JSON.stringify(txBase));app.setS(S);app.setTX({rows:JSON.parse(JSON.stringify(txRows))});
    const dsum=calc.sumSpentInRange(txBase,'2026-09-21','2026-09-21',txRows);assert.strictEqual(dsum,12000,'9/21 지출');}
  // 9/22: 스타벅스 4,500 + 통신사 60,000 − 고정지출 60,000 = 4,500. 홍길동 100,000(짝 없는 본인 이름)은 2026-09-26부터 '저축'(지출 아님)
  assert.strictEqual(calc.sumSpentInRange(txBase,'2026-09-22','2026-09-22',txRows),4500,'9/22 지출');
  assert.strictEqual(calc.buildNumbers(txBase,'2026-09-23',txRows).eff<calc.buildNumbers({...txBase,ownerNames:''},'2026-09-23',txRows).eff,true,'저축은 쓸 수 있는 돈에서 빠짐');
  // 9/23: 사용자가 이동으로 지정한 7,000 제외 → 0
  assert.strictEqual(calc.sumSpentInRange(txBase,'2026-09-23','2026-09-23',txRows),0,'9/23 지출');
  console.log('ok - 알림 지출 규칙(월급일·내 계좌 이동·추정·사용자 지정·고정지출)');n++;

  // 오늘 권장 지출(2026-09-26 수정): 잔액이 예산보다 많아도 '어제까지 쓴 돈'을 빼고 남은 날로 나눈다. 예산을 다 쓰면 하루 몫 0.
  {
    const T=[
      {id:1,bank:'kb',type:'out',amount:1,balance:5000000,counterparty:'가',at:'2026-09-20T12:00:00+09:00'},
      {id:2,bank:'kakao',type:'out',amount:1,balance:1000000,counterparty:'가',at:'2026-09-20T12:10:00+09:00'},
      {id:3,bank:'kb',type:'out',amount:400000,balance:4600000,counterparty:'가게',at:'2026-09-22T12:00:00+09:00'},
      {id:4,bank:'kb',type:'out',amount:10000,balance:4590000,counterparty:'가게',at:'2026-09-26T12:00:00+09:00'},
    ];
    const S0={budget:1000000,budgetStart:'2026-09-21',budgetEnd:'2026-10-20',txSince:'2026-09-21',captures:[],balances:{},fixed:[]};
    setToday('2026-09-26');
    app.setS(JSON.parse(JSON.stringify(S0)));app.setTX({rows:JSON.parse(JSON.stringify(T))});
    const want=Math.floor(600000/25)-10000; // 9/26~10/20 = 25일, 어제까지 400,000 사용
    assert.strictEqual(app.getTodayBudget(),want,'앱 오늘 권장 지출');
    assert.strictEqual(calc.buildNumbers(S0,today,T).todayBudget,want,'리포트 오늘 권장 지출');
    const S1={...S0,budget:300000};
    app.setS(JSON.parse(JSON.stringify(S1)));app.setTX({rows:JSON.parse(JSON.stringify(T))});
    // 2026-09-29 사용자: 모자라면 0으로 자르지 않고 음수 그대로. 초과 10만 원 ÷ 25일 = 하루 −4,000, 거기서 오늘 쓴 1만 원
    assert.strictEqual(app.getTodayBudget(),-14000,'예산을 넘겼으면 하루 몫도 음수 − 오늘 쓴 돈');
    assert.strictEqual(calc.buildNumbers(S1,today,T).todayBudget,-14000);
    console.log('ok - 오늘 권장 지출: 잔액이 커도 쓴 돈 반영, 초과면 음수 그대로');n++;
  }
  // 2026-09-29: 주기 시작 전의 옛 캡처 잔액(캡처 폐지 뒤 남은 기록)을 오늘 시작 잔액으로 쓰지 않는다 → 지금 잔액(알림 기준)
  {
    const S2={budget:2280000,budgetStart:'2026-09-23',budgetEnd:'2026-10-22',txSince:'2026-09-30',
      captures:[{id:'1',date:'2026-08-04',time:'오후 1:00',balances:{kakao:58000,kb:121150}}],
      balances:{kakao:129200,kb:346815},balanceAt:{kakao:'2026-09-29T08:32:00Z',kb:'2026-09-29T08:32:00Z'},balanceTxId:{kakao:2,kb:1},
      fixed:[{id:'a',name:'저축',amount:1000000,type:'expense',paid:true,paidDate:'2026-09-29'},
             {id:'b',name:'관리비',amount:300000,type:'expense',paid:true,paidDate:'2026-09-29'},
             {id:'c',name:'테니스',amount:180000,type:'expense',paid:false,paidDate:''},
             {id:'d',name:'복싱',amount:100000,type:'expense',paid:true,paidDate:'2026-09-29'}]};
    setToday('2026-09-29');
    app.setS(JSON.parse(JSON.stringify(S2)));app.setTX({rows:[]});
    // 9/29~10/22 = 24일, (476,015 − 미납 180,000) ÷ 24
    assert.strictEqual(app.getTodayBudget(),Math.floor((476015-180000)/24),'옛 캡처 대신 지금 잔액');
    // 잔액이 미납 고정비보다 적으면 음수 그대로
    app.setS({...JSON.parse(JSON.stringify(S2)),balances:{kakao:10000,kb:20000}});
    assert.strictEqual(app.getTodayBudget(),Math.floor((30000-180000)/24),'잔액 부족이면 음수');
    // (Codex) 지금 잔액을 알림으로 받은 적이 없으면 0원으로 치지 않고 예산 기준
    app.setS({...JSON.parse(JSON.stringify(S2)),budget:1000000,budgetEnd:'2026-10-08',fixed:[],balances:{},balanceAt:{},balanceTxId:{}});
    assert.strictEqual(app.getTodayBudget(),100000,'잔액 모름 → 예산 기준(옛 캡처도 안 씀)');
    console.log('ok - 오늘 권장 지출: 주기 시작 전 옛 캡처 무시, 부족하면 음수');n++;
  }
  // (Codex) 캡처만 쓰는 경우(txSince 없음) 주기 첫날의 전날 캡처는 정상 기준 — 오늘 지출을 두 번 빼지 않는다
  {
    const S3={budget:1000000,budgetStart:'2026-09-29',budgetEnd:'2026-10-08',txSince:'',fixed:[],balances:{kakao:90000,kb:0},
      captures:[{id:'1',date:'2026-09-28',time:'오후 1:00',balances:{kakao:100000,kb:0}},{id:'2',date:'2026-09-29',time:'오후 1:00',balances:{kakao:90000,kb:0}}]};
    setToday('2026-09-29');app.setS(JSON.parse(JSON.stringify(S3)));app.setTX({rows:[]});
    assert.strictEqual(app.getTodayBudget(),100000/10-10000,'캡처 사용자 주기 첫날');
    // (Codex 2차) 알림 전환 당일: txSince=내일, 오늘 캡처(1만 지출)도 있고 두 계좌 알림 잔액 합 9만 → 0원(오늘 지출 이중 차감 없음)
    const S4={...S3,budgetStart:'2026-09-29',txSince:'2026-09-30',captures:[{id:'1',date:'2026-09-20',time:'오후 1:00',balances:{kakao:100000,kb:0}},{id:'2',date:'2026-09-29',time:'오후 1:00',balances:{kakao:90000,kb:0}}],
      balanceAt:{kakao:'2026-09-29T05:00:00Z',kb:'2026-09-29T05:00:00Z'},balanceTxId:{kakao:1,kb:2}};
    app.setS(JSON.parse(JSON.stringify(S4)));
    assert.strictEqual(app.getTodayBudget(),0,'알림 전환 당일 오늘 지출 이중 차감 없음');
    console.log('ok - 오늘 권장 지출: 캡처만 쓰는 주기 첫날은 예전 계산 그대로, 알림 전환 당일도 이중 차감 없음');n++;
  }
  // (Codex) 음수 하루 몫이면 막대 오른쪽 예산도 − 부호
  {
    const h=app.gaugeHtml('오늘',0,-6250,null,'');
    assert.ok(h.includes('−6,250원'),'음수 예산 표시');
    console.log('ok - 막대: 음수 하루 몫 − 표시');n++;
  }
  // 2026-09-29: 알림 연결 전 지출을 조정 지출(기타) 한 건으로 — 이번 달·결산에는 들어가고, 주기 시작일 날짜라 이번 주 막대엔 안 들어감
  {
    const S5={budget:2280000,budgetStart:'2026-09-23',budgetEnd:'2026-10-22',txSince:'2026-09-30',captures:[],
      balances:{kakao:129200,kb:346815},balanceAt:{kakao:'2026-09-29T08:32:00Z',kb:'2026-09-29T08:32:00Z'},balanceTxId:{kakao:2,kb:1},
      fixed:[{id:'c',name:'테니스',amount:180000,type:'expense',paid:false,paidDate:''},{id:'a',name:'저축',amount:1400000,type:'expense',paid:true,paidDate:'2026-09-29'}],
      spentAdjust:{date:'2026-09-23',amount:403985,note:'알림 연결 전 지출(9/23~9/29)'}};
    setToday('2026-10-01');app.setS(JSON.parse(JSON.stringify(S5)));app.setTX({rows:[]});
    assert.strictEqual(app.totSpent(),403985,'이번 달 사용에 조정 지출 포함');
    assert.strictEqual(app.sumSpentInRange('2026-09-28','2026-10-01'),0,'이번 주(9/28~)에는 안 들어감');
    // 10/1 권장: 예산 70만 − 어제까지 403,985 = 296,015 ÷ 22일(10/1~10/22)
    assert.strictEqual(app.getTodayBudget(),Math.floor(296015/22),'권장 지출도 조정 반영');
    // 다음 주기(시작일이 바뀜)에는 들어가지 않음
    assert.strictEqual(app.sumSpentInRange('2026-10-23','2026-11-22'),0,'다음 주기 영향 없음');
    for(const bad of [-5000,'Infinity',null,'abc']){app.setS({...JSON.parse(JSON.stringify(S5)),spentAdjust:{date:'2026-09-23',amount:bad}});assert.strictEqual(app.totSpent(),0,'잘못된 조정액 무시 '+bad);}
    console.log('ok - 조정 지출(기타): 이번 달·권장 지출 반영, 이번 주·다음 주기 제외, 잘못된 값 무시');n++;
  }
  // (Codex 8차 재현) 앱=리포트로 같은 값인지와 기대값을 함께 본다
  const both=(S,T,d)=>{setToday(d);app.setS(JSON.parse(JSON.stringify(S)));app.setTX({rows:JSON.parse(JSON.stringify(T))});
    const a=app.getTodayBudget(),c=calc.buildNumbers(S,d,T).todayBudget;assert.strictEqual(a,c,`앱 ${a} ≠ 리포트 ${c}`);return a;};
  {
    // ② 마감일, 사용예산 10만(월 15만 − 고정 5만), 시작 잔액 6만, 미납 고정 5만 → 하루 몫 1만. 오늘 5만 자동이체 후 납부 체크해도 1만 그대로
    const S0={budget:150000,budgetStart:'2026-09-01',budgetEnd:'2026-09-26',txSince:'2026-09-01',captures:[],balances:{},
      fixed:[{name:'보험',amount:50000,paid:false,paidDate:''}]};
    const T0=[{id:1,bank:'kb',type:'out',amount:1,balance:60000,counterparty:'가',at:'2026-08-31T12:00:00+09:00'},
      {id:2,bank:'kakao',type:'out',amount:1,balance:0,counterparty:'가',at:'2026-08-31T12:10:00+09:00'}];
    assert.strictEqual(both(S0,T0,'2026-09-26'),10000,'납부 전');
    const S1={...S0,fixed:[{name:'보험',amount:50000,paid:true,paidDate:'2026-09-26'}]};
    const T1=[...T0,{id:3,bank:'kb',type:'out',amount:50000,balance:10000,counterparty:'보험사',at:'2026-09-26T09:00:00+09:00'}];
    assert.strictEqual(both(S1,T1,'2026-09-26'),10000,'납부 체크해도 하루 몫이 커지지 않음');
    // ③ 잔액 없는 알림: 확인 잔액 1만 → 어제 8천 출금(잔액 없음) → 오늘 시작 잔액은 추정 2천(1만으로 쓰지 않음)
    const S2={budget:1000000,budgetStart:'2026-09-01',budgetEnd:'2026-09-30',txSince:'2026-09-01',captures:[],balances:{},fixed:[]};
    const T2=[{id:1,bank:'kb',type:'out',amount:1,balance:10000,counterparty:'가',at:'2026-08-31T12:00:00+09:00'},
      {id:2,bank:'kakao',type:'out',amount:1,balance:0,counterparty:'가',at:'2026-08-31T12:10:00+09:00'},
      {id:3,bank:'kb',type:'out',amount:8000,balance:null,counterparty:'가게',at:'2026-09-25T12:00:00+09:00'}];
    assert.strictEqual(both(S2,T2,'2026-09-26'),Math.floor(2000/5),'추정 잔액 2천 ÷ 남은 5일');
    // ③-2 잔액을 한 번도 모르는 계좌가 있으면 잔액으로 누르지 않고 예산 기준(모르는 잔액을 0원으로 치지 않음)
    const T3=[{id:1,bank:'kb',type:'out',amount:5000,balance:null,counterparty:'가게',at:'2026-09-25T12:00:00+09:00'}];
    assert.strictEqual(both(S2,T3,'2026-09-26'),Math.floor((1000000-5000)/5),'잔액 모름 → 예산 기준');
    // ⑤ 오늘 환불(순지출 −1만)이면 권장 지출이 그만큼 늘어난다
    const T4=[...T2.slice(0,2),{id:4,bank:'kb',type:'out',amount:10000,balance:0,counterparty:'가게',at:'2026-09-20T12:00:00+09:00'},
      {id:5,bank:'kb',type:'in',amount:10000,balance:10000,counterparty:'가게',method:'취소',at:'2026-09-26T12:00:00+09:00'}];
    const share=Math.floor(Math.min(1000000-10000,0)/5); // 어제까지 잔액 0 → 하루 몫 0
    assert.strictEqual(both(S2,T4,'2026-09-26'),share+10000,'환불이 오늘 권장 지출에 반영');
    // (Codex 9차) 새벽 3시 고정비 5만(납부일 26일) → 26일 06시 시작 잔액엔 이미 빠져 있으니 다시 빼지 않음: 마감일, 잔액 6만 → 6만
    const S5={budget:1050000,budgetStart:'2026-09-01',budgetEnd:'2026-09-26',txSince:'2026-09-01',captures:[],balances:{},
      fixed:[{name:'보험',amount:50000,paid:true,paidDate:'2026-09-26'}]};
    const T5=[{id:1,bank:'kb',type:'out',amount:1,balance:110000,counterparty:'가',at:'2026-08-31T12:00:00+09:00'},
      {id:2,bank:'kakao',type:'out',amount:1,balance:0,counterparty:'가',at:'2026-08-31T12:10:00+09:00'},
      {id:3,bank:'kb',type:'out',amount:50000,balance:60000,counterparty:'보험사',at:'2026-09-26T03:00:00+09:00'}];
    assert.strictEqual(both(S5,T5,'2026-09-26'),60000,'새벽에 이미 빠진 고정비를 또 빼지 않음');
    // (2026-10-01) 알림 연결 전에 이미 빠져나간 저축을 오늘 체크: 오늘 그 금액 출금이 없으면 시작 잔액에 없는 돈이라 다시 빼지 않음
    //   사용예산 70만(100만 − 저축 30만), 시작 잔액 40만, 남은 5일(9/6~9/10), 오늘 지출 1만 → 40만÷5 − 1만
    const S6={budget:1000000,budgetStart:'2026-09-01',budgetEnd:'2026-09-10',txSince:'2026-09-01',captures:[],balances:{},ownerNames:'홍길동',
      fixed:[{name:'저축',amount:300000,paid:true,paidDate:'2026-09-06'}]};
    const T6=[{id:1,bank:'kb',type:'out',amount:1,balance:400000,counterparty:'가',at:'2026-08-31T12:00:00+09:00'},
      {id:2,bank:'kakao',type:'out',amount:1,balance:0,counterparty:'가',at:'2026-08-31T12:10:00+09:00'},
      {id:3,bank:'kb',type:'out',amount:10000,balance:390000,counterparty:'가게',at:'2026-09-06T12:00:00+09:00'}];
    assert.strictEqual(both(S6,T6,'2026-09-06'),400000/5-10000,'출금 없이 오늘 체크한 고정비는 다시 빼지 않음');
    // 오늘 같은 금액이 실제로 나갔으면(내 이름 계좌로 옮긴 저축 포함) 시작 잔액에 있던 돈이라 뺀다 → 10만÷5 − 1만
    const T7=[...T6,{id:4,bank:'kb',type:'out',amount:300000,balance:90000,counterparty:'토스 홍길동',at:'2026-09-06T13:00:00+09:00'}];
    assert.strictEqual(both(S6,T7,'2026-09-06'),100000/5-10000,'오늘 실제로 나간 고정비는 뺌');
    console.log('ok - 하루 시작 시점 미납 고정비·추정 잔액·잔액 모름·환불·새벽 고정비·출금 없이 오늘 체크(앱=리포트)');n++;
  }

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
    setToday('2026-09-25');app.setS(JSON.parse(JSON.stringify(S0)));app.setTX({rows:JSON.parse(JSON.stringify(T))});
    assert.strictEqual(app.totSpent(),calc.buildNumbers(S0,'2026-09-25',T).spent,'앱=리포트(환불·누락·고정입금)');
    assert.strictEqual(app.totSpent(),20000);
    console.log('ok - 고정입금·환불·누락 감지 규칙(앱=리포트)');n++;
  }
  console.log(`
통과 ${n}개`);
})().catch(e=>{console.error(e);process.exit(1);});
