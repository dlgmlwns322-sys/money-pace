// 입출금 알림 받기 Edge Function. 휴대폰 MacroDroid가 호출한다(로그인 토큰 없이, 비밀키 헤더로 확인).
// 배포: supabase functions deploy tx-ingest --project-ref <REF> --no-verify-jwt
// 비밀키: supabase secrets set TX_INGEST_SECRET=<긴 무작위 문자열> --project-ref <REF>
import "../_shared/txparse.js";
import { handleIngest } from "./handler.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("TX_INGEST_SECRET") || "";
// deno-lint-ignore no-explicit-any
const TxParse = (globalThis as any).TxParse;
const rest = (path: string, init: RequestInit) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", ...(init.headers || {}) },
});

// 같은 key가 이미 있으면 무시(중복 알림). 응답은 새로 들어간 행의 id만(수십 바이트): 비어 있으면 중복.
async function insert(row: Record<string, unknown>): Promise<"inserted" | "duplicate"> {
  const res = await rest("tx?on_conflict=key&select=id", {
    method: "POST", headers: { "Prefer": "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${res.status}`); // 오류 본문엔 거래 내용이 섞일 수 있어 기록하지 않음
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? "inserted" : "duplicate";
}

async function saveUnparsed(o: Record<string, unknown>) {
  const res = await rest("tx_unparsed", { method: "POST", headers: { "Prefer": "return=minimal" }, body: JSON.stringify(o) });
  if (!res.ok) throw new Error(`unparsed ${res.status}`);
}

Deno.serve(async (req) => {
  try {
    const out = await handleIngest(
      { method: req.method, headers: req.headers, readBody: () => req.text(), contentType: req.headers.get("content-type") || "", now: new Date().toISOString() },
      { secret: SECRET, parse: TxParse.parseNotification, insert, saveUnparsed },
    );
    return new Response(out.body, { status: out.status });
  } catch (e) {
    console.error("tx-ingest", e instanceof Error ? e.message : "error");
    return new Response("error", { status: 500 });
  }
});
