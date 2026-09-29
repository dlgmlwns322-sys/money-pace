// 생존 신호 감시 Edge Function. pg_cron이 1시간마다 부른다(supabase/heartbeat_watch.sql).
// 배포: supabase functions deploy heartbeat-watch --project-ref <REF> --no-verify-jwt
// 비밀키: supabase secrets set HEARTBEAT_WATCH_SECRET=<긴 무작위 문자열> --project-ref <REF> (크론 호출 헤더와 같게)
// 텔레그램: 예전 일일 리포트 봇 시크릿 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID를 그대로 쓴다.
import { handleWatch } from "./handler.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("HEARTBEAT_WATCH_SECRET") || "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") || "";
const rest = (path: string, init: RequestInit) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", ...(init.headers || {}) },
});

async function load() {
  const res = await rest("ingest_heartbeat?id=eq.1&select=at,alert_at", { method: "GET" });
  if (!res.ok) throw new Error(`load ${res.status}`);
  return (await res.json())[0] ?? null;
}

// 생존 신호 시각(at)이 읽은 값 그대로일 때만 alert_at을 바꾼다(그 사이 새 신호가 오면 0행). 바뀌었으면 true.
async function record(at: string | null, alertAt: string | null): Promise<boolean> {
  const cond = at === null ? "" : `&at=eq.${encodeURIComponent(at)}`; // null이면 조건 없이(정정 실패 표시용)
  const res = await rest(`ingest_heartbeat?id=eq.1${cond}&select=id`, {
    method: "PATCH", headers: { "Prefer": "return=representation" }, body: JSON.stringify({ alert_at: alertAt }),
  });
  if (!res.ok) throw new Error(`record ${res.status}`);
  return (await res.json()).length === 1;
}

async function send(text: string): Promise<boolean> {
  if (!TG_TOKEN || !TG_CHAT) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: TG_CHAT, text }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.ok === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const out = await handleWatch({ method: req.method, headers: req.headers, now: new Date().toISOString() }, { secret: SECRET, load, record, send });
    return new Response(out.body, { status: out.status });
  } catch (e) {
    console.error("heartbeat-watch", e instanceof Error ? e.message : "error");
    return new Response("error", { status: 500 });
  }
});
