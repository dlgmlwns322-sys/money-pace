// 앱이 거래를 읽는 Edge Function(읽기 비밀키 헤더로 확인).
// 배포: supabase functions deploy tx-read --project-ref <REF> --no-verify-jwt
// 비밀키: supabase secrets set TX_READ_SECRET=<긴 무작위 문자열, 쓰기 키와 다르게> --project-ref <REF>
import { handleRead, COLUMNS } from "./handler.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("TX_READ_SECRET") || "";

async function select(q: { afterId: number; sinceIso: string | null }, limit: number) {
  const filter = (q.sinceIso ? `created_at=gte.${encodeURIComponent(q.sinceIso)}&` : "") + `id=gt.${q.afterId}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tx?select=${COLUMNS}&${filter}&order=id.asc&limit=${limit}`, {
    headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`select ${res.status}`);
  return await res.json();
}

const get = (path: string, extra: Record<string, string> = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}`, ...extra },
});
async function one(path: string, field: string): Promise<string | null> {
  const res = await get(path);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const rows = await res.json();
  return rows[0]?.[field] ?? null;
}
// 알림센터용 상태: 행 몇 개의 시각과 개수만(수백 바이트)
async function status(sinceIso: string) {
  const since = encodeURIComponent(sinceIso);
  const u = await get(`tx_unparsed?select=created_at&created_at=gte.${since}&order=created_at.desc&limit=1`, { "Prefer": "count=exact" });
  if (!u.ok) throw new Error(`unparsed ${u.status}`);
  const newest = (await u.json())[0]?.created_at ?? null;
  const count = Number((u.headers.get("content-range") || "").split("/")[1]) || 0;
  return {
    heartbeatAt: await one("ingest_heartbeat?select=at&id=eq.1", "at"),
    unparsed: { count, newest },
    lastTx: {
      kakao: await one("tx?select=at&bank=eq.kakao&order=at.desc&limit=1", "at"),
      kb: await one("tx?select=at&bank=eq.kb&order=at.desc&limit=1", "at"),
    },
  };
}

async function hints(afterId: number, floorIso: string, limit: number) {
  const res = await get(`card_hint?select=id,at,amount,merchant&id=gt.${afterId}&created_at=gte.${encodeURIComponent(floorIso)}&order=id.asc&limit=${limit}`);
  if (!res.ok) throw new Error(`hints ${res.status}`);
  return await res.json();
}

Deno.serve(async (req) => {
  try {
    const out = await handleRead({ method: req.method, headers: req.headers, url: req.url, now: new Date().toISOString() }, { secret: SECRET, select, status, hints });
    // 204(사전 요청 응답)는 본문이 있으면 Response 생성이 실패한다 → 본문 없이
    return new Response(out.status === 204 ? null : out.body, { status: out.status, headers: out.headers });
  } catch (e) {
    console.error("tx-read", e instanceof Error ? e.message : "error");
    return new Response("error", { status: 500 });
  }
});
