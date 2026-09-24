// 동기화 검증 (서버 흉내: 행 하나, data.rev 조건부 갱신)
// - 업로드에 로컬 전용 키 4종·캡처 사진이 없다 / 불러오기는 로컬 키·이 기기 사진을 지킨다
// - 시작할 때 버전만 보고 필요할 때만 전체를 받는다 / 다른 기기 변경을 덮어쓰지 않는다(원자적 조건부 갱신)
// - 올리는 사이 또 바뀐 변경은 사라지지 않는다 / 백업에 실패하면 아무것도 바꾸지 않는다
// 실행: node test/sync-payload.test.js
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const pick=re=>{const m=html.match(re);assert(m,'not found: '+re);return m[0];};
const src=[
  pick(/function defState\(\)\{[^\n]*/),
  pick(/const syncMeta=[^\n]*/),
  pick(/const saveSyncMeta=[^\n]*/),
  pick(/const isDirty=[^\n]*/),
  pick(/let syncTimer=null, syncing=false, syncAgain=false;/),
  pick(/function backupLocal\(tag\)\{[\s\S]*?\n\}/),
  pick(/let syncChain=[^\n]*/),
  pick(/const serialSync=[^\n]*/),
  pick(/const queueSync=[^\n]*/),
  pick(/function applyCloudData\(cloud\)\{[\s\S]*?\n\}/),
  pick(/function save\(\)\{[\s\S]*?\n\}/),
  pick(/const ROW_ID=[^\n]*/),
  pick(/const LOCAL_ONLY_KEYS=[^\n]*/),
  pick(/function cloudPayload\(s,rev\)\{[\s\S]*?\n\}/),
  pick(/const sbHeaders=[^\n]*/),
  pick(/async function fetchCloudRev\(\)\{[\s\S]*?\n\}/),
  pick(/async function syncToCloud\(\)\{[\s\S]*?\n\}/),
  pick(/async function takeCloudKeepLocalBackup\(\)\{[\s\S]*?\n\}/),
  pick(/async function syncOnStart\(\)\{[\s\S]*?\n\}/),
  pick(/async function firstSyncPickNewer\(cloudRev\)\{[\s\S]*?\n\}/),
  pick(/async function loadFromCloud\(\)\{[\s\S]*?\n\}/),
].join('\n');
const KEYS=['visionKey','claudeKey','supabaseUrl','supabaseKey'];

function makeEnv(opt={}){
  const env={calls:[],row:null,store:{},toasts:[],beforePatch:null};
  const revOf=()=>env.row&&env.row.data.rev!=null?String(env.row.data.rev):null;
  env.ctx={
    localStorage:{
      setItem:(k,v)=>{if(opt.failBackup&&k.startsWith('mp_v6_backup_'))throw new Error('quota');env.store[k]=v;},
      getItem:k=>env.store[k]??null},
    updateSyncBadge:()=>{},render:()=>{},showToast:m=>env.toasts.push(m),
    setTimeout:(f)=>{env.timers=(env.timers||0)+1;return 0;},clearTimeout:()=>{},confirm:()=>env.choice,
    fetch:async(url,o={})=>{
      env.calls.push({url,o});const method=o.method||'GET';
      const json=v=>({ok:true,status:200,text:async()=>'',json:async()=>v});
      if(method==='GET'){
        if(!env.row)return json([]);
        if(url.includes('select=rev'))return json([{rev:revOf()}]);
        return json([{data:env.row.data}]);
      }
      if(method==='POST'){if(env.row)return{ok:false,status:409,text:async()=>'dup'};const b=JSON.parse(o.body);env.row={data:b.data};return json(null);}
      if(method==='PATCH'){
        if(env.beforePatch){const f=env.beforePatch;env.beforePatch=null;f();}
        const b=JSON.parse(o.body);
        const m=url.match(/data->>rev=(eq\.(\d+)|is\.null)/);
        const cond=m[1]==='is.null'?revOf()===null:revOf()===m[2];
        if(!env.row||!cond)return json([]);
        env.row={data:b.data};return json([{id:'my_money_data'}]);
      }
    },
  };
  env.run=new Function('ctx',`with(ctx){let S;${src}
    return{setS:v=>{S=v},getS:()=>S,save,syncToCloud,loadFromCloud,syncOnStart,defState,syncMeta};}`)(env.ctx);
  return env;
}
const local=env=>({...env.run.defState(),budget:123,
  captures:[{id:'c1',date:'2026-09-20',time:'오후 9:00',thumb:'data:image/jpeg;base64,AAAA',balances:{kakao:1,kb:2}}],
  visionKey:'V',claudeKey:'C',supabaseUrl:'https://x.supabase.co',supabaseKey:'K'});
const fullDownloads=env=>env.calls.filter(c=>c.url.includes('select=data')).length;
const posts=env=>env.calls.filter(c=>['POST','PATCH'].includes(c.o.method)).length;
let n=0;const ok=m=>{n++;console.log('ok -',m);};

(async()=>{
  {const env=makeEnv();env.run.setS(local(env));
  await env.run.syncToCloud();
  const d=env.row.data;
  KEYS.forEach(k=>assert(!(k in d),'payload has '+k));
  assert.ok(d.captures.every(c=>!('thumb' in c)),'thumb not uploaded');
  assert.strictEqual(d.rev,1);assert.strictEqual(env.run.syncMeta.rev,1);
  assert.strictEqual(env.run.getS().captures[0].thumb.startsWith('data:'),true,'local thumb kept');
  ok('첫 업로드: 키·사진 제외, rev 1');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:999,alarmTime:'07:30',visionKey:'OLD',rev:4,captures:[{id:'c1',date:'2026-09-20',balances:{kakao:1,kb:2}}]}};
  assert.strictEqual(await env.run.loadFromCloud(),true);
  const S=env.run.getS();
  assert.strictEqual(S.budget,999);assert.strictEqual(S.visionKey,'V');assert.strictEqual(S.supabaseKey,'K');
  assert.ok(!('rev' in S));assert.strictEqual(S.captures[0].thumb.startsWith('data:'),true,'thumb restored by id');
  assert.strictEqual(env.run.syncMeta.rev,4);
  ok('불러오기: 로컬 키·이 기기 사진 유지, rev 기억');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:1,rev:3}};Object.assign(env.run.syncMeta,{rev:3,seq:5,sentSeq:5});
  assert.strictEqual(await env.run.syncOnStart(),false);
  assert.strictEqual(fullDownloads(env),0);assert.strictEqual(env.run.getS().budget,123);
  ok('시작: 버전이 같으면 전체를 받지 않음');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:2,rev:4}};Object.assign(env.run.syncMeta,{rev:3,seq:5,sentSeq:5});
  assert.strictEqual(await env.run.syncOnStart(),true);assert.strictEqual(env.run.getS().budget,2);
  ok('시작: 클라우드가 새로우면 받음');}

  {const env=makeEnv();env.run.setS(local(env));env.choice=false;
  env.row={data:{budget:2,captures:[{id:'9999999999999',date:'2026-09-24',balances:{}}]}};
  assert.strictEqual(await env.run.syncOnStart(),true);
  assert.strictEqual(env.run.getS().budget,2,'[취소] 클라우드를 가져옴');
  const keys=Object.keys(env.store);
  assert.ok(keys.some(k=>/^mp_v6_backup_\d/.test(k)),'이 기기 것 백업');
  assert.ok(keys.some(k=>k.startsWith('mp_v6_backup_cloud_')),'클라우드 것 백업');
  const lb=JSON.parse(env.store[keys.find(k=>/^mp_v6_backup_\d/.test(k))]);
  assert.ok(lb.captures[0].thumb.startsWith('data:'),'백업에 사진 포함');
  assert.strictEqual(env.run.syncMeta.rev,0,'예전 데이터(rev 없음)=0');
  env.run.save();await env.run.syncToCloud();
  assert.strictEqual(env.row.data.rev,1);
  ok('배포 직후 [취소]: 클라우드를 받고 양쪽 백업, 다음 저장부터 rev 1');}

  {const env=makeEnv();env.run.setS(local(env));env.choice=true;
  env.row={data:{budget:2,captures:[{id:'1000000000000',date:'2026-09-01',balances:{}}]}};
  await env.run.syncOnStart();
  assert.strictEqual(env.row.data.budget,123,'[확인] 이 기기 것을 올림(멈춘 동안 저장분 보호)');
  assert.strictEqual(env.row.data.rev,1);
  ok('배포 직후 [확인]: 이 기기 것을 올림');}

  {const env=makeEnv();env.run.setS(local(env));env.choice=false;
  env.row={data:{budget:2,captures:[]}};
  env.run.save();await env.run.syncToCloud();
  assert.strictEqual(env.row.data.budget,2,'첫 동기화 전 저장도 자동으로 덮지 않음');
  assert.strictEqual(env.run.getS().budget,2,'사용자 선택([취소])대로 클라우드 적용');
  assert.strictEqual(fullDownloads(env),1,'선택 후 다시 받지 않음');
  ok('첫 동기화 전에 저장해도 사용자에게 묻는 경로로 감');}

  {const env=makeEnv({failBackup:true});env.run.setS(local(env));env.choice=true;
  env.row={data:{budget:2}};
  await env.run.syncOnStart();
  assert.strictEqual(env.row.data.budget,2,'백업 실패면 올리지 않음');
  assert.strictEqual(env.run.getS().budget,123,'백업 실패면 바꾸지 않음');
  ok('배포 직후: 백업 실패하면 멈춤');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:1,rev:3}};Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  const realFetch=env.ctx.fetch;env.ctx.fetch=async(u,o={})=>{if((o.method||'GET')!=='GET')return{ok:false,status:402,text:async()=>'quota'};return realFetch(u,o);};
  env.timers=0;await env.run.syncToCloud();
  assert.strictEqual(env.timers,0,'오류 때 자동 재시도 예약 없음');
  ok('오류(예: 402 한도 초과) 때 자동 재시도하지 않음');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row=null;Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  await env.run.syncToCloud();
  assert.strictEqual(env.row.data.budget,123,'지워진 행 다시 만듦');
  ok('클라우드 행이 지워졌으면 다시 만듦');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:2,rev:4}};Object.assign(env.run.syncMeta,{rev:3,seq:5,sentSeq:5});
  const realFetch=env.ctx.fetch;env.ctx.fetch=async(u,o={})=>{const r=await realFetch(u,o);if(u.includes('select=data')){env.run.getS().budget=777;env.run.save();}return r;};
  assert.strictEqual(await env.run.loadFromCloud(),false);
  assert.strictEqual(env.run.getS().budget,777,'받는 사이 바뀐 것은 덮지 않음');
  ok('불러오는 사이 이 기기에서 바뀌면 덮지 않음');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:1,rev:3}};Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  await env.run.syncOnStart();
  assert.strictEqual(env.row.data.budget,123);assert.strictEqual(env.row.data.rev,4);assert.strictEqual(fullDownloads(env),0);
  ok('시작: 이 기기 변경만 있으면 올림');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:9,rev:7}};Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  await env.run.syncToCloud();
  assert.strictEqual(env.row.data.budget,9,'must not overwrite');
  assert.strictEqual(env.run.getS().budget,9);
  const backup=Object.keys(env.store).find(k=>k.startsWith('mp_v6_backup_'));
  assert.strictEqual(JSON.parse(env.store[backup]).budget,123);
  assert.ok(!('visionKey' in JSON.parse(env.store[backup])));
  ok('저장: 다른 기기가 먼저 저장했으면 덮어쓰지 않고 백업 후 불러옴');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:1,rev:3}};Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  env.beforePatch=()=>{env.row={data:{budget:8,rev:4}};};
  await env.run.syncToCloud();
  assert.strictEqual(env.row.data.budget,8,'확인과 저장 사이에 끼어든 저장도 안 덮음');
  ok('저장: 동시 저장 경합에서도 원자적으로 막힘');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:1,rev:3}};Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  env.beforePatch=()=>{env.run.getS().budget=555;env.run.save();};
  await env.run.syncToCloud();
  assert.strictEqual(env.run.syncMeta.sentSeq,6);assert.notStrictEqual(env.run.syncMeta.seq,env.run.syncMeta.sentSeq,'still dirty');
  ok('저장: 올리는 사이 바뀐 변경은 못 올린 것으로 남음');}

  {const env=makeEnv({failBackup:true});env.run.setS(local(env));
  env.row={data:{budget:9,rev:7}};Object.assign(env.run.syncMeta,{rev:3,seq:6,sentSeq:5});
  await env.run.syncToCloud();
  assert.strictEqual(env.run.getS().budget,123,'백업 실패 시 교체 안 함');
  assert.strictEqual(env.row.data.budget,9);
  ok('백업 실패: 아무것도 안 바꾸고 알림');}

  {const env=makeEnv();env.run.setS(local(env));
  env.row={data:{budget:9,rev:2}};
  await env.run.syncToCloud();
  assert.strictEqual(posts(env),0,'올리지 않음');assert.strictEqual(env.row.data.budget,9,'처음 맞추는 기기는 기존 클라우드를 덮지 않음');
  assert.strictEqual(env.run.getS().budget,9,'클라우드를 받고 이 기기 것은 백업');
  ok('처음 맞추는 기기: 클라우드가 있으면 덮지 않음');}

  console.log(`\nOK sync-payload (${n})`);
})().catch(e=>{console.error(e);process.exit(1);});
