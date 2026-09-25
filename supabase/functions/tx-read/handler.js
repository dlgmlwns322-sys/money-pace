// 앱이 거래를 읽는 창구 — 순수 함수(테스트는 node, 실행은 index.ts가 Deno에서 감싼다).
// anon 키로는 tx 테이블을 못 읽게 막고, 읽기 비밀키(쓰기 비밀키와 다름)를 가진 앱만 여기서 읽는다.
// 알림 원문·계좌번호는 보내지 않는다(앱에 필요 없음, 전송량·노출 줄이기).
import { secretMatches } from "../_shared/auth.js";

export const ALLOWED_ORIGINS = new Set(["https://dlgmlwns322-sys.github.io", "http://127.0.0.1:8799", "http://localhost:8799"]);
export const COLUMNS = "id,bank,type,amount,balance,counterparty,method,at,needs_review";
export const PAGE = 500;

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://dlgmlwns322-sys.github.io",
    "Access-Control-Allow-Headers": "x-read-secret, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "x-since-applied",
    "Vary": "Origin",
  };
}

// 읽는 방식 두 가지
//  after=<id>: 그 id 뒤의 새 거래(평소, 겹쳐 읽기는 앱이 함)
//  since=<ISO 시각>: 그 시각 이후 저장된 거래 전체(하루 한 번 최근 7일로 빈 곳 채우기, 캐시가 비면 예산 주기 시작부터 — 최대 45일)
//  status=1: 알림센터용 수집 상태(생존 신호 시각·최근 45일 미해석 건수·은행별 마지막 거래 시각). 응답 수백 바이트.
// req: {method, headers: {get}, url, now}
// deps: {secret, select({afterId,sinceIso}, limit) -> Promise<rows>, status(sinceIso) -> Promise<{heartbeatAt, unparsed:{count,newest}, lastTx:{kakao,kb}}>}
export async function handleRead(req, deps) {
  const cors = corsHeaders(req.headers.get("origin") || "");
  if (req.method === "OPTIONS") return { status: 204, headers: cors, body: "" };
  if (req.method !== "GET") return { status: 405, headers: cors, body: "method" };
  if (!deps.secret) return { status: 500, headers: cors, body: "not configured" };
  if (!(await secretMatches(req.headers.get("x-read-secret"), deps.secret))) return { status: 401, headers: cors, body: "unauthorized" };
  const u = new URL(req.url);
  // hints=1: KB Pay 가게 이름 힌트(최근 45일, after=id 뒤로 500건씩). 행당 수십 바이트.
  if (u.searchParams.get("hints") === "1") {
    if (!deps.hints) return { status: 500, headers: cors, body: "not configured" };
    const floorIso = new Date(Date.parse(req.now || new Date().toISOString()) - 45 * 86400000).toISOString();
    const afterId = Math.max(0, Math.floor(Number(u.searchParams.get("after") || 0)) || 0);
    return { status: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(await deps.hints(afterId, floorIso, PAGE)) };
  }
  if (u.searchParams.get("status") === "1") {
    if (!deps.status) return { status: 500, headers: cors, body: "not configured" };
    const floorIso = new Date(Date.parse(req.now || new Date().toISOString()) - 45 * 86400000).toISOString();
    return { status: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(await deps.status(floorIso)) };
  }
  const sinceRaw = u.searchParams.get("since");
  let sinceIso = null;
  if (sinceRaw) {
    const ms = Date.parse(sinceRaw);
    if (!Number.isFinite(ms)) return { status: 400, headers: cors, body: "bad since" };
    const floor = Date.parse(req.now || new Date().toISOString()) - 45 * 86400000; // 최대 45일(전송량 상한: 한 주기+여유)
    sinceIso = new Date(Math.max(ms, floor)).toISOString();
  }
  // after는 since와 함께 써서 500건이 넘으면 다음 쪽을 이어 읽는다(앱이 끝까지 반복)
  const afterId = Math.max(0, Math.floor(Number(u.searchParams.get("after") || 0)) || 0);
  const rows = await deps.select({ afterId, sinceIso }, PAGE);
  // 실제로 적용한 시작점(45일로 잘린 값)을 알려 준다 → 앱은 이 값으로 '빠짐없이 받은 범위'를 판정
  const extra = sinceIso ? { "x-since-applied": sinceIso } : {};
  return { status: 200, headers: { ...cors, ...extra, "Content-Type": "application/json" }, body: JSON.stringify(rows) };
}
