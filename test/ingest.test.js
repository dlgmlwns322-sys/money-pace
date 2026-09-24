// tx-ingest·tx-read 처리 검증. 실행: node test/ingest.test.js
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { parseNotification } = require('../txparse.js');
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('ok -', n); };

(async () => {
  const { handleIngest, parseBody, isBankNotification } = await import('../supabase/functions/tx-ingest/handler.js');
  const { handleRead } = await import('../supabase/functions/tx-read/handler.js');
  const SECRET = 's3cret-long-random', READ = 'read-secret-different';
  const now = '2026-09-24T17:08:30Z';
  const hdr = (h = {}) => ({ get: (k) => h[k.toLowerCase()] ?? null });
  const mk = () => {
    const rows = [], unparsed = [];
    return { rows, unparsed, deps: { secret: SECRET, parse: parseNotification,
      insert: async (r) => { if (rows.some((x) => x.key === r.key)) return 'duplicate'; rows.push({ id: rows.length + 1, ...r }); return 'inserted'; },
      saveUnparsed: async (o) => { unparsed.push(o); } } };
  };
  const req = (body, h = {}, ct = 'application/json') => ({ method: 'POST', headers: hdr({ 'x-ingest-secret': SECRET, ...h }), readBody: async () => body, contentType: ct, now });
  const kakaoBody = { app: 'com.kakao.talk', title: '카카오뱅크', text: '09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원' };

  await t('비밀키 없거나 틀리면 401(본문 읽기 전), 본문 secret은 인정 안 함', async () => {
    const { rows, deps } = mk(); let read = 0;
    const r1 = await handleIngest({ method: 'POST', headers: hdr(), readBody: async () => { read++; return JSON.stringify({ ...kakaoBody, secret: SECRET }); }, now }, deps);
    const r2 = await handleIngest({ ...req(JSON.stringify(kakaoBody)), headers: hdr({ 'x-ingest-secret': 'wrong' }) }, deps);
    assert.strictEqual(r1.status, 401); assert.strictEqual(r2.status, 401); assert.strictEqual(read, 0); assert.strictEqual(rows.length, 0);
  });

  await t('정상 JSON: 저장, 같은 알림 다시 오면 dup', async () => {
    const { rows, deps } = mk();
    assert.strictEqual((await handleIngest(req(JSON.stringify(kakaoBody)), deps)).body, 'ok');
    assert.strictEqual((await handleIngest({ ...req(JSON.stringify(kakaoBody)), now: '2026-09-24T17:08:31.500Z' }, deps)).body, 'dup');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].amount, 100); assert.strictEqual(rows[0].balance, 235300); assert.ok(rows[0].key.includes('입출금통장(0000)'));
  });

  await t('줄바꿈이 이스케이프 안 된 JSON도 받음', async () => {
    const { rows, deps } = mk();
    const raw = `{"app":"com.kakao.talk","title":"카카오뱅크","text":"09/25 12:30\n출금 4,500원\n입출금통장(0000) → 스타벅스\n잔액 230,800원"}`;
    assert.strictEqual((await handleIngest(req(raw), deps)).body, 'ok'); assert.strictEqual(rows[0].counterparty, '스타벅스');
  });

  await t('폼 형식 + 펼친 글(big) 우선', async () => {
    const { rows, deps } = mk();
    const body = new URLSearchParams({ app: 'com.kbstar.kbbank', title: '출금 100원', text: '잘린 미리보기…',
      big: '홍*동님 09/25 02:08 123456-**-***789 토스홍길동 오픈뱅킹출금 100 잔액376,715' }).toString();
    assert.strictEqual((await handleIngest(req(body, {}, 'application/x-www-form-urlencoded'), deps)).body, 'ok');
    assert.strictEqual(rows[0].bank, 'kb'); assert.strictEqual(rows[0].balance, 376715);
  });

  await t('은행 알림 아니면 아무것도 저장 안 함(일반 카톡·제목이 비슷한 방)', async () => {
    const { rows, unparsed, deps } = mk();
    for (const b of [{ app: 'com.kakao.talk', title: '친구', text: '입금 100원 해줘' }, { app: 'com.kakao.talk', title: '카카오뱅크 동호회', text: '09/25 02:08\n입금 100원' }]) {
      assert.strictEqual((await handleIngest(req(JSON.stringify(b)), deps)).body, 'skip');
    }
    assert.strictEqual(rows.length + unparsed.length, 0);
  });

  await t('은행 알림인데 해석 못 하면 unparsed로 보관', async () => {
    const { rows, unparsed, deps } = mk();
    const r = await handleIngest(req(JSON.stringify({ app: 'com.kbstar.kbbank', title: 'KB 이벤트', text: '포인트 받으세요' })), deps);
    assert.strictEqual(r.body, 'unparsed'); assert.strictEqual(rows.length, 0); assert.strictEqual(unparsed.length, 1);
  });

  await t('큰 본문(헤더 길이·실제 길이)·GET 거절, 비밀키 미설정이면 500', async () => {
    const { deps } = mk();
    assert.strictEqual((await handleIngest(req('x', { 'content-length': '99999' }), deps)).status, 413);
    assert.strictEqual((await handleIngest(req('x'.repeat(9000)), deps)).status, 413);
    assert.strictEqual((await handleIngest({ method: 'GET', headers: hdr(), readBody: async () => '', now }, deps)).status, 405);
    assert.strictEqual((await handleIngest(req('{}'), { ...deps, secret: '' })).status, 500);
  });

  await t('parseBody·은행 판별', async () => {
    assert.strictEqual(parseBody('', 'application/json'), null);
    assert.ok(isBankNotification('com.kbstar.kbbank', '출금 100원'));
    assert.ok(!isBankNotification('com.kakao.talk', '카카오뱅크 동호회'));
  });

  await t('읽기: 읽기 비밀키 필요(쓰기 키로는 안 됨), 원문·계좌 없이 after 이후만', async () => {
    let asked = null;
    const deps = { secret: READ, select: async (q, limit) => { asked = { ...q, limit }; return [{ id: 7, bank: 'kb', type: 'out', amount: 100 }]; } };
    const r0 = await handleRead({ method: 'GET', headers: hdr({ 'x-read-secret': SECRET }), url: 'https://x/tx-read?after=5' }, deps);
    assert.strictEqual(r0.status, 401);
    const r = await handleRead({ method: 'GET', headers: hdr({ 'x-read-secret': READ, origin: 'https://dlgmlwns322-sys.github.io' }), url: 'https://x/tx-read?after=5' }, deps);
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(asked, { afterId: 5, sinceIso: null, limit: 500 });
    const rs = await handleRead({ method: 'GET', headers: hdr({ 'x-read-secret': READ }), url: 'https://x/tx-read?since=2020-01-01T00:00:00Z', now: '2026-09-25T00:00:00Z' }, deps);
    assert.strictEqual(rs.status, 200); assert.strictEqual(asked.sinceIso, '2026-09-18T00:00:00.000Z', 'since는 최대 7일로 제한');
    assert.strictEqual((await handleRead({ method: 'GET', headers: hdr({ 'x-read-secret': READ }), url: 'https://x/tx-read?since=abc' }, deps)).status, 400);
    assert.strictEqual(r.headers['Access-Control-Allow-Origin'], 'https://dlgmlwns322-sys.github.io');
    const { COLUMNS } = await import('../supabase/functions/tx-read/handler.js');
    assert.ok(!/raw|account|key/.test(COLUMNS), '원문·계좌·키는 안 보냄');
    const pre = await handleRead({ method: 'OPTIONS', headers: hdr({ origin: 'https://evil.example' }), url: 'https://x/tx-read' }, deps);
    assert.strictEqual(pre.headers['Access-Control-Allow-Origin'], 'https://dlgmlwns322-sys.github.io');
  });

  await t('서버용 해석기 사본이 원본과 같음', async () => {
    const a = fs.readFileSync(path.join(__dirname, '..', 'txparse.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'txparse.js'), 'utf8');
    assert.strictEqual(a, b, 'supabase/functions/_shared/txparse.js를 txparse.js와 같게 맞추세요');
  });

  console.log(`\n통과 ${ok}개`);
})().catch((e) => { console.error(e); process.exit(1); });
