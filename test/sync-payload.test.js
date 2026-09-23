// M2 검증: syncToCloud 업로드 data에 로컬 전용 키 4종이 없는지, loadFromCloud가 로컬 키를 보존하는지
// 실행: node test/sync-payload.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const pick=re=>{const m=html.match(re);assert(m,'not found: '+re);return m[0];};
const src=[
  pick(/function defState\(\)\{[^\n]*/),
  pick(/const ROW_ID=[^\n]*/),
  pick(/const LOCAL_ONLY_KEYS=[^\n]*/),
  pick(/function cloudPayload\([^\n]*/),
  pick(/async function syncToCloud\(\)\{[\s\S]*?\n\}/),
  pick(/async function loadFromCloud\(\)\{[\s\S]*?\n\}/),
].join('\n');
const KEYS=['visionKey','claudeKey','supabaseUrl','supabaseKey'];
const calls=[];let cloudRow=null;
const store={};
const ctx={
  localStorage:{setItem:(k,v)=>{store[k]=v;}},
  updateSyncBadge:()=>{},
  fetch:async(url,opt={})=>{calls.push({url,opt});
    return{ok:true,text:async()=>'',json:async()=>cloudRow?[{data:cloudRow}]:[]};},
};
const run=new Function('ctx',`with(ctx){let S;${src}
  return{setS:v=>{S=v},getS:()=>S,syncToCloud,loadFromCloud,defState};}`)(ctx);
(async()=>{
  // 1) 업로드 페이로드
  const local={...run.defState(),budget:123,expenses:[{a:1}],
    visionKey:'V',claudeKey:'C',supabaseUrl:'https://x.supabase.co',supabaseKey:'K'};
  run.setS(local);
  await run.syncToCloud();
  const body=JSON.parse(calls[0].opt.body);
  KEYS.forEach(k=>assert(!(k in body.data),'payload has '+k));
  assert.strictEqual(body.data.budget,123);
  assert.deepStrictEqual(body.data.expenses,[{a:1}]);
  assert.strictEqual(body.id,'my_money_data');
  assert.strictEqual(run.getS().visionKey,'V','local S must not be mutated');
  // 2) 불러오기: 로컬 키 보존 (클라우드에 옛 키가 남아있어도 로컬 우선)
  cloudRow={budget:999,alarmTime:'07:30',visionKey:'OLD',claudeKey:'OLD'};
  assert.strictEqual(await run.loadFromCloud(),true);
  const S=run.getS();
  assert.strictEqual(S.budget,999);assert.strictEqual(S.alarmTime,'07:30');
  assert.strictEqual(S.visionKey,'V');assert.strictEqual(S.claudeKey,'C');
  assert.strictEqual(S.supabaseUrl,'https://x.supabase.co');assert.strictEqual(S.supabaseKey,'K');
  assert.deepStrictEqual(S.captures,[],'defState fill kept');
  console.log('OK sync-payload');
})().catch(e=>{console.error(e);process.exit(1);});
