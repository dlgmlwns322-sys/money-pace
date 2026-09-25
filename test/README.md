# 머니페이스 테스트

| 종류 | 실행 |
|---|---|
| 단위 | `node test/<이름>.test.js` (sync-payload, cycle, parity, txparse, ingest, audit-cases) |
| 성능(거래 1,000건) | `node test/perf.js` (저장소 루트에서) |
| Edge Function 실제 실행(Deno 흉내) | `node test/edge/run.mjs <supabase/functions 경로> <임시 폴더>` |
| 무작위 대량(알림→저장→읽기→계산) | `node test/edge/fuzz.mjs <supabase/functions 경로> <임시 폴더> <seed>` |
| 브라우저(Edge, Playwright) | `python test/browser/app_scenarios.py` · `tx_scenarios.py` · `save_failure.py` (볼트 루트를 127.0.0.1:8799로 띄움) |

- 테스트 데이터는 가짜 이름(홍길동)과 가짜 계좌(0000, 123456-**-***789)만 쓴다. 실제 값을 넣지 말 것(공개 저장소).
- `supabase/functions/_shared/txparse.js`는 `txparse.js`와 같아야 한다(ingest 테스트가 검사).
