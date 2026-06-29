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
  const ydSpent = (S.expenses || []).filter((e: any) => e.date === ydStr)
    .reduce((a: number, e: any) => a + (e.amount || 0), 0);

  const fixedList = (S.fixed || []).map((f: any) =>
    `${f.name} ${won(f.amount)}${f.paid ? "(빠짐 " + f.paidDate + ")" : ""}`
  ).join(", ") || "없음";

  const memoList = Object.entries(S.memos || {})
    .sort((a: any, b: any) => b[0].localeCompare(a[0])).slice(0, 7)
    .map(([d, m]: any) => {
      const mm = typeof m === "string" ? { amt: 0, text: m } : m;
      const amtPart = mm.amt > 0 ? won(mm.amt) + " " : "";
      return `${d}: ${amtPart}${mm.text || ""}`.trim();
    }).join(" / ") || "없음";

  return `[재무 현황]
- 예산기간: ${S.budgetStart}~${S.budgetEnd}(총${total}일,경과${elapsed}일,남은${remaining}일)
- 월예산: ${won(S.budget)} / 고정지출 ${won(fixedTot)} 제외 → 사용가능 ${won(eff)}
- 이번달 지출: ${won(spent)} (소진율 ${Math.round(spent / Math.max(eff, 1) * 100)}%)
- 남은예산: ${won(eff - spent)}, 오늘 쓸 수 있는 돈: ${won(Math.floor(Math.max(0, eff - spent) / remaining))}
- 고정지출 목록: ${fixedList}
- 최근 메모: ${memoList}
- 총잔액: ${won(tb)}, 어제지출: ${won(ydSpent)}`;
}

async function callGemini(ctx: string) {
  const sys = `당신은 따뜻하고 현실적인 개인 재무 코치예요. 아래 사용자의 오늘 재무 현황과 메모를 종합해서, 오늘 하루에 대한 짧은 코멘트를 작성하세요.
규칙:
- 3~4문장으로 짧게
- 현재 소진율/페이스가 좋은지 나쁜지 먼저 짚기
- 메모에 특이사항(큰 지출 등)이 있으면 언급
- 마지막에 앞으로 어떻게 하면 좋을지 구체적 조언 1가지
- 친근한 반말체 살짝, 잔소리 느낌 없이 격려 위주
- 이모지 1~2개 자연스럽게`;

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
