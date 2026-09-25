# 머니페이스 테스트

| 종류 | 실행 |
|---|---|
| 단위 | `node test/<이름>.test.js` (auto, payday, budget, daystart, audit-cases, txparse, ingest, sync-payload) — 앱 코드는 `test/app.js`가 index.html을 통째로 불러 쓴다(함수 조각 추출 없음). 옛 서버 계산 자리는 `test/calc-shim.js` |
| 성능(거래 1,000건) | `node test/perf.js` (저장소 루트에서) |
| Edge Function 실제 실행(Deno 흉내) | `node test/edge/run.mjs <supabase/functions 경로> <임시 폴더>` |
| 끝에서 끝까지(실제 형식 알림 → 저장 → 읽기 → 월급 주기·저축·고정지출) | `node test/edge/e2e.mjs <supabase/functions 경로> <임시 폴더>` |
| 무작위 대량(알림→저장→읽기→계산) | `node test/edge/fuzz.mjs <supabase/functions 경로> <임시 폴더> <seed>` |
| 저장 가드 SQL(실제 Postgres = PGlite) | `npm i @electric-sql/pglite`가 된 폴더에 `test/sql/guard.mjs`를 두고 `node guard.mjs <supabase/guard.sql 경로>` |
| 브라우저(Edge, Playwright) | `python test/browser/<이름>.py` — app_scenarios · tx_scenarios · save_failure · bell_scenarios(알림 벨) · daystart_scenarios(새벽 6시 기준) · recompute_scenarios(마감 결산 재계산·경합) · cat_scenarios(지출 원형 그래프·카테고리·KB Pay 가게 이름) (볼트 루트를 127.0.0.1:8799로 띄움) |

- 가계부 하루는 새벽 6시 시작(`DAY_START_HOUR`). 날짜 계산을 바꾸면 daystart 단위·브라우저 테스트와 parity(앱=리포트)를 같이 돌린다.
- 테스트 데이터는 가짜 이름(홍길동)과 가짜 계좌(0000, 123456-**-***789)만 쓴다. 실제 값을 넣지 말 것(공개 저장소).
- `supabase/functions/_shared/txparse.js`는 `txparse.js`와 같아야 한다(ingest 테스트가 검사).
