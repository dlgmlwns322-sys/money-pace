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

function totalBalance(bal: any) {
  return (bal.kakao || 0) + (bal.kb || 0) + (bal.shinhan || 0);
}

// 캡처 기록을 날짜별 '그날 가장 최근' 총잔액으로 압축
function capturesByDate(S: any): Record<string, { date: string; time: string; total: number }> {
  const withTotal = (S.captures || []).map((c: any) => ({
    date: c.date, time: c.time || "00:00", total: totalBalance(c.balances || {}),
  }));
  const byDate: Record<string, any> = {};
  for (const c of withTotal) {
    if (!byDate[c.date] || c.time > byDate[c.date].time) byDate[c.date] = c;
  }
  return byDate;
}

// 클라이언트 getDailySpent()와 동일: 최근 두 캡처 날짜의 잔액 차이
function getDailySpent(S: any) {
  const days = Object.values(capturesByDate(S)).sort((a: any, b: any) => b.date.localeCompare(a.date));
  if (days.length < 2) return null;
  const today: any = days[0], prev: any = days[1];
  return { spent: prev.total - today.total, todayDate: today.date, prevDate: prev.date };
}

// 클라이언트 getWeeklySpent()와 동일: 주 시작 시점 잔액 - 현재 잔액
function getWeeklySpent(S: any, weekStartStr: string) {
  const days = Object.values(capturesByDate(S)).sort((a: any, b: any) => a.date.localeCompare(b.date));
  if (days.length < 1) return null;
  let startBal: number | null = null, curBal: number | null = null;
  for (const d of days as any[]) {
    if (d.date <= weekStartStr) startBal = d.total;
    curBal = d.total;
  }
  if (startBal === null) {
    const inWeek = (days as any[]).filter((d) => d.date >= weekStartStr);
    if (inWeek.length < 1) return null;
    startBal = inWeek[0].total;
    curBal = inWeek[inWeek.length - 1].total;
  }
  return { spent: Math.max(0, (startBal as number) - (curBal as number)) };
}

// 클라이언트 SURPLUS/DEFICIT 페이스 테이블과 동일
const SURPLUS = [
  { max: 5, txt: "순항 중", em: "😊" },
  { max: 10, txt: "알뜰하게 쓰는 중", em: "🙂" },
  { max: 20, txt: "절약 잘 되고 있어요", em: "😄" },
  { max: 35, txt: "완전 절약 모드", em: "🥳" },
  { max: 999, txt: "거의 안 쓰고 있어요", em: "🤩" },
];
const DEFICIT = [
  { max: 5, txt: "살짝 과했어요", em: "😅" },
  { max: 10, txt: "조금 줄여볼까요", em: "😬" },
  { max: 20, txt: "지출이 빠른 편이에요", em: "😰" },
  { max: 35, txt: "이러다 바닥나요", em: "😱" },
  { max: 999, txt: "지금 당장 줄여야 해요", em: "🚨" },
];
function calcPace(budget: number, spent: number, elapsed: number, total: number) {
  const expected = budget * (elapsed / total);
  const diff = spent - expected;
  const pct = Math.abs(diff) / Math.max(budget, 1) * 100;
  const isSurplus = diff <= 0;
  const tbl = isSurplus ? SURPLUS : DEFICIT;
  let item = tbl[tbl.length - 1];
  for (const row of tbl) { if (pct <= row.max) { item = row; break; } }
  return { item, expected, spent };
}

// 홈 대시보드와 동일한 수치를 라벨:값 형태로 정리한 리포트 (AI 가공 없이 결정적으로 계산)
function buildReport(S: any, todayStr: string) {
  const fixedTot = (S.fixed || []).reduce((a: number, f: any) => a + (f.amount || 0), 0);
  // 미납(아직 안 빠져나간) 고정지출 = 잔액엔 남아있지만 곧 나갈 돈
  const unpaidFixed = (S.fixed || []).filter((f: any) => !f.paid).reduce((a: number, f: any) => a + (f.amount || 0), 0);
  const eff = Math.max(0, (S.budget || 0) - fixedTot);
  const tb = totalBalance(S.balances || {});
  const usable = Math.max(0, tb - unpaidFixed); // 실제 쓸 수 있는 잔액 = 총잔액 - 미납 고정지출
  const spent = tb > 0 ? Math.max(0, eff - usable) : 0;
  const remain = eff - spent;
  const isOver = remain < 0;

  let total = 30, elapsed = 15, remaining = 15;
  if (S.budgetStart && S.budgetEnd) {
    total = Math.max(1, daysBetween(S.budgetStart, S.budgetEnd) + 1);
    elapsed = Math.max(0, Math.min(total, daysBetween(S.budgetStart, todayStr) + 1));
    remaining = Math.max(1, total - elapsed + 1);
  }
  const daily = remaining > 0 ? Math.floor(Math.max(0, remain) / remaining) : 0;
  const realPct = Math.round(spent / Math.max(eff, 1) * 100);
  const pace = calcPace(eff, spent, elapsed, total);
  const ds = getDailySpent(S);

  const yd = new Date(`${todayStr}T00:00:00Z`);
  yd.setUTCDate(yd.getUTCDate() - 1);
  const ydStr = yd.toISOString().slice(0, 10);
  const ydSpentVal = getMemos(S, ydStr).reduce((a: number, c: any) => a + (c.amt || 0), 0);

  const weekStartStr = weekStartOf(todayStr);
  const todayDow = new Date(`${todayStr}T00:00:00Z`).getUTCDay();
  const wElapsed = todayDow === 0 ? 7 : todayDow;
  const wRemaining = 7 - wElapsed + 1;

  const wBudget = S.weeklyBudget || 0;
  const ws = getWeeklySpent(S, weekStartStr);
  const wSpentVal = ws ? ws.spent : 0;
  const wRemain = wBudget - wSpentVal;
  const wOver = wRemain < 0;
  const wPct = Math.round(wSpentVal / Math.max(wBudget, 1) * 100);
  const wPace = (wBudget > 0 && ws) ? calcPace(wBudget, wSpentVal, wElapsed, 7) : null;

  const balNames: Record<string, string> = { kakao: "카카오뱅크", kb: "국민은행", shinhan: "신한은행" };
  const balLines = Object.keys(balNames).map((k) =>
    (S.balances || {})[k] > 0 ? `${balNames[k]} ${won(S.balances[k])}` : null
  ).filter(Boolean).join(" · ") || "없음";

  const weekCards = Object.entries(S.memos || {})
    .filter(([d]) => d >= weekStartStr && d <= todayStr)
    .flatMap(([d]) => getMemos(S, d).map((c: any) => ({ ...c, date: d })))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  const memoLines = weekCards.length ? weekCards.map((c: any) => {
    const amtPart = c.amt > 0 ? won(c.amt) + " " : "";
    const catPart = c.category ? "[" + c.category + "] " : "";
    return `${c.date.slice(5)} ${catPart}${amtPart}${c.text || ""}`.trim();
  }).join("\n") : "없음";

  const fixedLines = (S.fixed || []).map((f: any) =>
    `${f.name} ${won(f.amount)}${f.paid ? " (빠짐 " + f.paidDate + ")" : " (미납)"}`
  ).join("\n") || "없음";

  const lines: string[] = [];
  lines.push("[잔액]");
  lines.push(`총잔액: ${won(tb)}`);
  lines.push(balLines);
  lines.push("");
  lines.push("[오늘]");
  lines.push(`오늘 쓸 수 있는 돈: ${isOver ? "예산 초과" : won(daily)}`);
  if (ds) {
    lines.push(
      `어제 대비 오늘 쓴 돈: ${ds.spent >= 0 ? won(ds.spent) : "+" + won(Math.abs(ds.spent)) + " (입금/충전)"} (${ds.prevDate.slice(5)}→${ds.todayDate.slice(5)})`,
    );
  }
  lines.push(`어제 지출(메모 기준): ${won(ydSpentVal)}`);
  lines.push("");
  lines.push(`[월간 소진 현황] (${elapsed}/${total}일 경과)`);
  lines.push(`월예산: ${won(S.budget)}`);
  lines.push(`고정지출: -${won(fixedTot)}`);
  lines.push(`사용가능: ${won(eff)}`);
  lines.push(`사용: ${won(spent)} (${realPct}%)`);
  lines.push(`남은예산: ${isOver ? won(Math.abs(remain)) + " 초과" : won(remain)}`);
  lines.push(`월간 페이스: ${pace.item.em} ${pace.item.txt} (예상 ${won(Math.round(pace.expected))} / 실제 ${won(pace.spent)})`);
  lines.push("");
  lines.push(`[주간 소진 현황] (${wElapsed}/7일 경과)`);
  lines.push(`주간예산: ${wBudget > 0 ? won(wBudget) : "미설정"}`);
  lines.push(`사용: ${ws ? won(wSpentVal) + " (" + wPct + "%)" : "—"}`);
  lines.push(`남은예산: ${wBudget > 0 ? (wOver ? won(Math.abs(wRemain)) + " 초과" : won(wRemain)) : "—"}`);
  lines.push(`남은일수: ${wRemaining}일`);
  if (wPace) lines.push(`주간 페이스: ${wPace.item.em} ${wPace.item.txt} (예상 ${won(Math.round(wPace.expected))} / 실제 ${won(wPace.spent)})`);
  lines.push("");
  lines.push("[고정지출]");
  lines.push(fixedLines);
  lines.push("");
  lines.push("[이번 주 지출 메모]");
  lines.push(memoLines);

  return lines.join("\n");
}

async function callGemini(report: string) {
  const sys = `당신은 따뜻하고 현실적인 개인 재무 코치예요. 아래는 사용자의 오늘자 재무 리포트입니다 (이미 정리된 수치라 다시 나열할 필요 없음).

이 리포트 끝에 덧붙일 짧은 코멘트만 작성하세요.
규칙:
- 숫자나 항목을 다시 나열하지 말 것
- 전체 페이스가 좋은지 나쁜지, 메모에 특이사항(큰 지출 등)이 있으면 짚어주기
- 마지막은 앞으로 어떻게 쓰면 좋을지 짧고 구체적인 조언 1가지로 마무리
- 2~3문장으로 짧게
- 마크다운 기호(*, # 등) 쓰지 말 것
- 친근한 반말체 살짝, 잔소리 느낌 없이 격려 위주
- 이모지 1~2개만`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: report }] }],
        generationConfig: { maxOutputTokens: 500 },
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
    const report = buildReport(S, dateStr);
    const aiComment = await callGemini(report);
    await sendTelegram(`💸 머니페이스 일일 리포트 (${dateStr})\n\n${report}\n\n💬 ${aiComment}`);
    return new Response("sent", { status: 200 });
  } catch (e) {
    // 실패하면 같은 날 재시도할 수 있게 로그 롤백
    await supabase.from("notify_log").delete().eq("sent_date", dateStr);
    return new Response(`error: ${e}`, { status: 500 });
  }
});
