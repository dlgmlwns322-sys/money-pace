// heartbeat-watch(생존 신호 감시) 검증. 실행: node test/heartbeat.test.js
const assert = require('assert');
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('ok -', n); };

(async () => {
  const { decide, handleWatch, STALE_MS, REPEAT_MS } = await import('../supabase/functions/heartbeat-watch/handler.js');
  const SECRET = 'watch-secret-long-random';
  const hdr = (h = {}) => ({ get: (k) => h[k.toLowerCase()] ?? null });
  const H = 3600e3;
  const iso = (ms) => new Date(ms).toISOString();
  const base = Date.parse('2026-10-01T03:00:00Z'); // 12:00 KST 생존 신호

  // DB 한 행 흉내: record는 at이 읽은 값 그대로일 때만 alert_at을 바꾼다(실제 PostgREST 조건부 PATCH와 같게)
  const mkDb = (row, { sendOk = true, recordFail = false } = {}) => {
    const sent = [];
    const db = {
      row, sent, sendOk, recordFail,
      deps: {
        secret: SECRET,
        load: async () => (db.row ? { ...db.row } : null),
        record: async (at, alertAt) => {
          if (db.recordFail) throw new Error('db down');
          if (Date.parse(db.row.at) !== Date.parse(at)) return false;
          db.row.alert_at = alertAt; return true;
        },
        send: async (text) => { if (!db.sendOk) return false; sent.push(text); return true; },
      },
    };
    return db;
  };
  const run = (db, nowMs, headers = { 'x-watch-secret': SECRET }) => handleWatch({ method: 'POST', headers: hdr(headers), now: iso(nowMs) }, db.deps);

  await t('정상(30시간 이내)이면 아무것도 안 보냄', async () => {
    const db = mkDb({ at: iso(base), alert_at: null });
    const r = await run(db, base + 25 * H);
    assert.deepStrictEqual([r.status, r.body, db.sent.length], [200, 'ok', 0]);
  });

  await t('30시간 넘게 끊기면 경고 한 번, 1시간 뒤 다시 돌아도 중복 없음', async () => {
    const db = mkDb({ at: iso(base), alert_at: null });
    const r = await run(db, base + 31 * H);
    assert.deepStrictEqual([r.status, r.body, db.sent.length], [200, 'alert', 1]);
    assert.match(db.sent[0], /31시간째/);
    assert.match(db.sent[0], /10\. 1\./); // 마지막 신호 KST 날짜
    const r2 = await run(db, base + 32 * H);
    assert.deepStrictEqual([r2.body, db.sent.length], ['ok', 1]);
  });

  await t('계속 끊겨 있으면 12시간마다 다시 알림', async () => {
    const db = mkDb({ at: iso(base), alert_at: null });
    await run(db, base + 31 * H);
    assert.strictEqual((await run(db, base + 42 * H)).body, 'ok');
    assert.strictEqual((await run(db, base + 43 * H)).body, 'alert');
    assert.strictEqual(db.sent.length, 2);
  });

  await t('경고 뒤 신호가 다시 오면 복구 알림 한 번, 그 뒤 조용', async () => {
    const db = mkDb({ at: iso(base), alert_at: null });
    await run(db, base + 31 * H);
    db.row.at = iso(base + 33 * H); // 폰이 다시 살아남
    const r = await run(db, base + 34 * H);
    assert.deepStrictEqual([r.body, db.row.alert_at, db.sent.length], ['recovered', null, 2]);
    assert.match(db.sent[1], /다시 연결됐어요/);
    assert.strictEqual((await run(db, base + 35 * H)).body, 'ok');
  });

  await t('복구 알림 전 다시 끊기면 새 끊김으로 바로 경고(12시간 대기 안 함)', async () => {
    const db = mkDb({ at: iso(base + 10 * H), alert_at: iso(base) });
    assert.strictEqual((await run(db, base + 41 * H)).body, 'alert');
  });

  await t('텔레그램 전송 실패면 아무것도 기록 안 해 다음 실행에 다시 보냄', async () => {
    const db = mkDb({ at: iso(base), alert_at: null }, { sendOk: false });
    const r = await run(db, base + 31 * H);
    assert.deepStrictEqual([r.status, r.body, db.row.alert_at], [502, 'send failed', null]);
    db.sendOk = true;
    assert.strictEqual((await run(db, base + 32 * H)).body, 'alert');
    assert.strictEqual(db.sent.length, 1);
  });

  await t('(Codex) 보낸 뒤 기록이 실패해도 알림은 사라지지 않음 — 다음 실행에 한 번 더(최소 한 번)', async () => {
    const db = mkDb({ at: iso(base), alert_at: null }, { recordFail: true });
    const r = await run(db, base + 31 * H);
    assert.deepStrictEqual([r.status, db.sent.length], [500, 1]);
    db.recordFail = false;
    assert.strictEqual((await run(db, base + 32 * H)).body, 'alert');
    assert.strictEqual(db.sent.length, 2);
    // 복구 알림도 같은 방식: 기록 실패하면 다음에 다시
    db.row.at = iso(base + 33 * H); db.recordFail = true;
    assert.strictEqual((await run(db, base + 34 * H)).status, 500);
    db.recordFail = false;
    assert.strictEqual((await run(db, base + 35 * H)).body, 'recovered');
    assert.strictEqual(db.sent.filter((s) => /다시 연결됐어요/.test(s)).length, 2);
  });

  await t('(Codex) 읽은 뒤 기록 전에 생존 신호가 새로 오면 경고를 바로 정정', async () => {
    const db = mkDb({ at: iso(base), alert_at: null });
    const send0 = db.deps.send;
    db.deps.send = async (text) => { const r = await send0(text); db.row.at = iso(base + 31 * H); return r; }; // 보내는 사이 신호 도착
    const r = await run(db, base + 31 * H);
    assert.deepStrictEqual([r.body, db.row.alert_at], ['alert corrected', null]);
    assert.match(db.sent[0], /확인 필요/);
    assert.match(db.sent[1], /다시 연결됐어요/);
  });

  await t('비밀키 없거나 틀리면 거부, GET 거부, 생존 신호 기록이 없으면 조용', async () => {
    const db = mkDb({ at: iso(base), alert_at: null });
    assert.strictEqual((await run(db, base + 31 * H, {})).status, 401);
    assert.strictEqual((await run(db, base + 31 * H, { 'x-watch-secret': 'wrong' })).status, 401);
    assert.strictEqual((await handleWatch({ method: 'GET', headers: hdr({ 'x-watch-secret': SECRET }), now: iso(base) }, db.deps)).status, 405);
    assert.strictEqual((await handleWatch({ method: 'POST', headers: hdr({ 'x-watch-secret': SECRET }), now: iso(base) }, { ...db.deps, secret: '' })).status, 500);
    assert.strictEqual((await run(mkDb(null), base)).body, 'ok');
    assert.strictEqual(db.sent.length, 0);
  });

  await t('decide 경계: 정확히 30시간은 정상, 잘못된 시각은 무시', async () => {
    assert.strictEqual(decide(base + STALE_MS, { at: iso(base), alert_at: null }).action, 'none');
    assert.strictEqual(decide(base + STALE_MS + 1, { at: iso(base), alert_at: null }).action, 'alert');
    assert.strictEqual(decide(base, { at: 'garbage', alert_at: null }).action, 'none');
    assert.strictEqual(REPEAT_MS, 12 * H);
  });

  console.log(`\n통과 ${ok}개`);
})().catch((e) => { console.error(e); process.exit(1); });
