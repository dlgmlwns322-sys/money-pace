// 매일 설정한 시간(S.alarmTime)에 지출 현황을 분석해서 텔레그램으로 보내는 함수
// pg_cron이 1분마다 호출하고, 여기서 알람 시간이 맞는지 확인 후 1회만 발송한다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ROW_ID = "my_money_data";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function won(n: number) {
  return Math.round(n || 0).toLocaleString("ko-KR") + "원";
}

// 한국 시간 기준 날짜(YYYY-MM-DD)/시(HH)/분(mm)
function kstParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  return { dateStr: `${get("year")}-${get("month")}-${get("day")}`, hh: get("hour"), mm: get("minute") };
}

function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 월요일 시작 기준 이번 주의 시작일(YYYY-MM-DD)
function weekStartOf(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일,1=월...
  const offsetToMon = dow === 0 ? 6 : dow - 1;
  const wd = new Date(Date.UTC(y, m - 1, d));
  wd.setUTCDate(wd.getUTCDate() - offsetToMon);
  return wd.toISOString().slice(0, 10);
}

// 클라이언트 index.html의 getMemos()와 동일: 그 날의 메모를 항상 카드 배열로 반환 (옛날 형식 호환)
function getMemos(S: any, dateStr: string): any[] {
  const m = (S.memos || {})[dateStr];
  if (!m) return [];
  if (Array.isArray(m)) return m;
  if (typeof m === "string") return m ? [{ id: "legacy", category: "", amt: 0, text: m }] : [];
  return (m.amt > 0 || m.text) ? [{ id: "legacy", category: "", amt: m.amt || 0, text: m.text || "" }] : [];
}

// 클라이언트 index.html의 buildCtx()와 동일한 로직을 서버에서 재현
function buildCtx(S: any, todayStr: string) {
  const fixedTot = (S.fixed || []).reduce((a: number, f: any) => a + (f.amount || 0), 0);
  const eff = Math.max(0, (S.budget || 0) - fixedTot);
  const tb = Object.values(S.balances || {}).reduce((a: number, b: any) => a + (b || 0), 0);
  const spent = tb > 0 ? Math.max(0, eff - tb) : 0;

  let total = 30, elapsed = 15, remaining = 15;
  if (S.budgetStart && S.budgetEnd) {
    total = Math.max(1, daysBetween(S.budgetStart, S.budgetEnd) + 1);
    elapsed = Math.max(0, Math.min(total, daysBetween(S.budgetStart, todayStr) + 1));
    remaining = Math.max(1, total - elapsed + 1);
  }

  const yd = new Date(`${todayStr}T00:00:00Z`);
  yd.setUTCDate(yd.getUTCDate() - 1);
  const ydStr = yd.toISOString().slice(0, 10);
  const ydSpent = getMemos(S, ydStr).reduce((a: number, c: any) => a + (c.amt || 0), 0);

  const fixedList = (S.fixed || []).map((f: any) =>
    `${f.name} ${won(f.amount)}${f.paid ? "(빠짐 " + f.paidDate + ")" : ""}`
  ).join(", ") || "없음";

  // 이번 주(월~오늘) 지출 메모 카드 전체 (카테고리+금액+내용)
  const weekStartStr = weekStartOf(todayStr);
  const weekCards = Object.entries(S.memos || {})
    .filter(([d]) => d >= weekStartStr && d <= todayStr)
    .flatMap(([d]) => getMemos(S, d).map((c: any) => ({ ...c, date: d })))
    .sort((a: any, b: any) => b.date.localeCompare(a.date));
  const memoList = weekCards.map((c: any) => {
    const amtPart = c.amt > 0 ? won(c.amt) + " " : "";
    const catPart = c.category ? "[" + c.category + "] " : "";
    return `${c.date.slice(5)} ${catPart}${amtPart}${c.text || ""}`.trim();
  }).join(" / ") || "없음";

  return `[재무 현황]
- 예산기간: ${S.budgetStart}~${S.budgetEnd}(총${total}일,경과${elapsed}일,남은${remaining}일)
- 월예산: ${won(S.budget)} / 고정지출 ${won(fixedTot)} 제외 → 사용가능 ${won(eff)}
- 이번달 지출: ${won(spent)} (소진율 ${Math.round(spent / Math.max(eff, 1) * 100)}%)
- 남은예산: ${won(eff - spent)}, 오늘 쓸 수 있는 돈: ${won(Math.floor(Math.max(0, eff - spent) / remaining))}
- 고정지출 목록: ${fixedList}
- 이번 주 지출 메모: ${memoList}
- 총잔액: ${won(tb)}, 어제지출: ${won(ydSpent)}`;
}

async function callGemini(ctx: string) {
  const sys = `당신은 따뜻하고 현실적인 개인 재무 코치예요. 아래 사용자의 재무 현황과 메모를 종합해서, 오늘을 위한 코멘트를 작성하세요.

아래 항목을 줄바꿈해서 순서대로 짚어주세요 (각 1~2문장, 너무 길게 늘이지 말 것):
1. 이번 달 소진율과 페이스 (좋은지 나쁜지, 남은 예산 포함)
2. 어제 얼마 썼는지
3. 오늘 쓸 수 있는 금액
4. 이번 주 주요 소비 (메모에 특이사항·큰 지출 있으면 구체적으로 언급, 특별한 거 없으면 이 줄은 생략)
5. 마지막 줄: 앞으로 어떻게 쓰면 좋을지 짧고 구체적인 조언 1가지

규칙:
- 마크다운 기호(*, # 등) 쓰지 말고 순수 텍스트 + 줄바꿈만 사용
- 데이터에 없는 내용은 추측해서 만들지 말 것
- 친근한 반말체 살짝, 잔소리 느낌 없이 격려 위주
- 이모지는 전체에서 2~3개 이내로 자연스럽게`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: ctx }] }],
        generationConfig: { maxOutputTokens: 1000 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini 오류 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "코멘트를 생성하지 못했어요.";
}

async function sendTelegram(text: string) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
  if (!res.ok) throw new Error(`Telegram 오류 ${res.status}: ${await res.text()}`);
}

Deno.serve(async () => {
  const { dateStr, hh, mm } = kstParts();

  const { data: row, error } = await supabase
    .from("app_data").select("data").eq("id", ROW_ID).single();
  if (error || !row) return new Response("no data", { status: 200 });

  const S = row.data;
  const alarmTime: string = S.alarmTime || "09:00";
  const [ah, am] = alarmTime.split(":");
  if (hh !== ah || mm !== am) {
    return new Response("not time yet", { status: 200 });
  }

  // 같은 분에 cron이 중복 호출돼도 하루 한 번만 발송되도록 가드 (insert 충돌 시 스킵)
  const { error: logErr } = await supabase.from("notify_log").insert({ sent_date: dateStr });
  if (logErr) return new Response("already sent today", { status: 200 });

  try {
    const ctx = buildCtx(S, dateStr);
    const comment = await callGemini(ctx);
    await sendTelegram(`💸 머니페이스 일일 리포트 (${dateStr})\n\n${comment}`);
    return new Response("sent", { status: 200 });
  } catch (e) {
    // 실패하면 같은 날 재시도할 수 있게 로그 롤백
    await supabase.from("notify_log").delete().eq("sent_date", dateStr);
    return new Response(`error: ${e}`, { status: 500 });
  }
});
