// 앱이 거래를 읽는 Edge Function(읽기 비밀키 헤더로 확인).
// 배포: supabase functions deploy tx-read --project-ref <REF> --no-verify-jwt
// 비밀키: supabase secrets set TX_READ_SECRET=<긴 무작위 문자열, 쓰기 키와 다르게> --project-ref <REF>
import { handleRead, COLUMNS } from "./handler.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("TX_READ_SECRET") || "";

async function select(q: { afterId: number; sinceIso: string | null }, limit: number) {
  const filter = q.sinceIso ? `created_at=gte.${encodeURIComponent(q.sinceIso)}` : `id=gt.${q.afterId}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tx?select=${COLUMNS}&${filter}&order=id.asc&limit=${limit}`, {
    headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`select ${res.status}`);
  return await res.json();
}

Deno.serve(async (req) => {
  try {
    const out = await handleRead({ method: req.method, headers: req.headers, url: req.url, now: new Date().toISOString() }, { secret: SECRET, select });
    return new Response(out.body, { status: out.status, headers: out.headers });
  } catch (e) {
    console.error("tx-read", e instanceof Error ? e.message : "error");
    return new Response("error", { status: 500 });
  }
});
