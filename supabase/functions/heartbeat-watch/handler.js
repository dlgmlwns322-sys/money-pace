// 생존 신호 감시(2026-09-29) — 순수 함수(테스트는 node, 실행은 index.ts가 Deno에서 감싼다).
// 크론이 1시간마다 부른다. 폰(MacroDroid)의 하루 한 번 생존 신호가 30시간 넘게 없으면 텔레그램으로 알리고,
// 계속 끊겨 있으면 12시간마다 다시, 다시 들어오면 '다시 연결됐어요'를 한 번 보낸다.
// 상태는 ingest_heartbeat.alert_at(마지막 경고 시각, 정상이면 null) 하나.
// 순서: 먼저 보내고, 보낸 뒤에 기록한다(최소 한 번). 기록이 실패하면 다음 실행에 한 번 더 갈 수 있지만 알림이 사라지지는 않는다.
import { secretMatches } from "../_shared/auth.js";

export const STALE_MS = 30 * 3600e3;
export const REPEAT_MS = 12 * 3600e3;

// hb: {at, alert_at} 또는 null → {action: 'none' | 'alert' | 'recovered', hours?}
export function decide(nowMs, hb) {
  if (!hb || !hb.at) return { action: "none" }; // 생존 신호를 한 번도 받은 적 없음(설정 전)
  const at = Date.parse(hb.at);
  if (!Number.isFinite(at)) return { action: "none" };
  const alertAt = hb.alert_at ? Date.parse(hb.alert_at) : null;
  const age = nowMs - at;
  if (age > STALE_MS) {
    // 이번 끊김에 처음이거나(경고가 없거나 마지막 신호보다 이전), 마지막 경고 뒤 12시간이 지났으면
    if (alertAt == null || alertAt < at || nowMs - alertAt >= REPEAT_MS) return { action: "alert", hours: Math.floor(age / 3600e3) };
    return { action: "none" };
  }
  // 정상인데 경고 기록이 남아 있으면 → 경고 뒤 다시 들어온 것
  if (alertAt != null) return { action: "recovered" };
  return { action: "none" };
}

const kst = (iso) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export function messageFor(action, hb, hours) {
  if (action === "alert") {
    return `⚠️ 머니페이스 입출금 자동화 확인 필요\n폰의 생존 신호가 ${hours}시간째 안 와요(마지막 ${kst(hb.at)}).\n` +
      `MacroDroid 무료 기간 연장·배터리 최적화·알림 접근 권한을 확인해 주세요.\n그사이 빠진 지출은 다시 연결되면 '누락?'으로 잡혀요.`;
  }
  return `✅ 머니페이스 입출금 자동화가 다시 연결됐어요(마지막 신호 ${kst(hb.at)}).`;
}

// req: {method, headers: {get}, now}
// deps: {secret, load() -> Promise<{at, alert_at}|null>,
//        record(at, alertAt) -> Promise<boolean>  // 생존 신호 시각이 at 그대로일 때만 alert_at을 바꾼다. 바뀌었으면 true
//        send(text) -> Promise<boolean>}
export async function handleWatch(req, deps) {
  if (req.method !== "POST") return { status: 405, body: "method" };
  if (!deps.secret) return { status: 500, body: "not configured" };
  if (!(await secretMatches(req.headers.get("x-watch-secret"), deps.secret))) return { status: 401, body: "unauthorized" };
  const hb = await deps.load();
  const d = decide(Date.parse(req.now), hb);
  if (d.action === "none") return { status: 200, body: "ok" };
  // 1) 먼저 보낸다. 실패하면 아무것도 기록하지 않아 다음 실행(1시간 뒤)에 다시 보낸다.
  if (!(await deps.send(messageFor(d.action, hb, d.hours)))) return { status: 502, body: "send failed" };
  // 2) 보낸 뒤 기록. 확인하는 사이 생존 신호가 새로 들어왔으면(at이 바뀜) 경고가 틀린 것이므로 바로 정정한다.
  const recorded = await deps.record(hb.at, d.action === "alert" ? req.now : null).catch(() => null);
  if (recorded === null) return { status: 500, body: `${d.action} sent, record failed` }; // 다음 실행에 한 번 더 갈 수 있음
  if (!recorded && d.action === "alert") {
    const fresh = await deps.load().catch(() => null);
    if (fresh && fresh.at) await deps.send(messageFor("recovered", fresh));
    return { status: 200, body: "alert corrected" };
  }
  return { status: 200, body: d.action };
}
