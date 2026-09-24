// 매일 설정한 시간(S.alarmTime)에 지출 현황을 분석해서 텔레그램으로 보내는 함수
// pg_cron이 1분마다 호출하고, 여기서 알람 시간이 맞는지 확인 후 1회만 발송한다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildNumbers } from "./calc.js";

const ROW_ID = "my_money_data";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

// 클라이언트 index.html의 getMemos()와 동일: 그 날의 메모를 항상 카드 배열로 반환 (옛날 형식 호환)
function getMemos(S: any, dateStr: string): any[] {
  const m = (S.memos || {})[dateStr];
  if (!m) return [];
  if (Array.isArray(m)) return m;
  if (typeof m === "string") return m ? [{ id: "legacy", category: "", amt: 0, text: m }] : [];
  return (m.amt > 0 || m.text) ? [{ id: "legacy", category: "", amt: m.amt || 0, text: m.text || "" }] : [];
}

// 핵심 5줄만 남긴 심플 리포트 (AI 코멘트가 너무 길다는 피드백 반영 — 잔액 내역·일별추이·메모·페이스 라벨 등은 전부 제거)
function buildSimpleSummary(input: any, todayStr: string) {
  // 숫자는 전부 calc.js(앱과 같은 식)에서 가져온다. 예산 주기가 끝났으면 앱처럼 다음 주기로 넘긴 복사본 기준.
  const n = buildNumbers(input, todayStr);
  const S = n.S;
  const { eff, spent, remain, total, elapsed, remaining, todayBudget } = n;
  const realPct = Math.round(spent / Math.max(eff, 1) * 100);

  // 어제 지출: 캡처가 있으면 잔액 감소분, 없으면 직접 적은 메모 합계
  const ydMemoSum = getMemos(S, n.yd).filter((c: any) => c.type !== "income").reduce((a: number, c: any) => a + (c.amt || 0), 0);
  const ydSpentVal = (n.ydDaily && !n.ydDaily.noCaptureToday) ? n.ydDaily.spent : ydMemoSum;

  const wBudget = S.weeklyBudget || 0;
  const wSpentVal = n.weekSpent;
  const wPct = Math.round(wSpentVal / Math.max(wBudget, 1) * 100);

  const unpaidList = (S.fixed || []).filter((f: any) => !f.paid).map((f: any) => `${f.name} ${f.type === "income" ? "(입금 예정) " : ""}${won(f.amount)}`);
  const recommendedDaily = remain > 0 ? Math.round(remain / remaining) : 0;
  const recommendedWeekly = recommendedDaily * 7;

  // 말투 톤: 쓴 비율(realPct) - 시간 경과 비율. +면 과소비(빠름), -면 여유. 상황에 맞게 코멘트 뉘앙스 변경.
  const timePct = Math.round(elapsed / Math.max(total, 1) * 100);
  const paceDelta = realPct - timePct;
  const pace = paceDelta >= 15 ? "over" : paceDelta >= 6 ? "fast" : paceDelta <= -10 ? "relaxed" : "ok";
  const tbTxt = todayBudget < 0 ? "-" + won(Math.abs(todayBudget)) : won(todayBudget);
  const ydHead = ydSpentVal > 0 ? `어제 ${won(ydSpentVal)} 썼` : `어제 지출 없었`;
  const ydLine = (pace === "over" || pace === "fast")
    ? `${ydHead}어요. 페이스가 빠르니 오늘은 ${tbTxt} 안에서 막아보세요`
    : pace === "relaxed"
    ? `${ydHead}어요. 여유 있으니 오늘은 ${tbTxt}까지 편하게 써도 돼요`
    : `${ydHead}으니 오늘은 ${tbTxt} 써도 괜찮아요`;
  const rw = won(recommendedWeekly), rd = won(recommendedDaily);
  const lastLine = remain <= 0
    ? `이미 이번 달 예산을 초과했어요. 남은 기간은 꼭 필요한 데만 쓰는 게 좋아요`
    : pace === "over" ? `지출 페이스가 많이 빨라요. 이번 주는 주 ${rw}·일 ${rd} 안으로 바짝 조여야 해요`
    : pace === "fast" ? `조금 빠른 페이스예요. 주 ${rw}·일 ${rd} 정도로 맞춰가면 좋아요`
    : pace === "relaxed" ? `페이스에 여유가 있어요. 주 ${rw}·일 ${rd}까지 써도 되니 너무 아끼지 않아도 돼요`
    : `페이스 적당해요. 이대로 주 ${rw}·일 ${rd} 유지하면 딱이에요`;

  const lines: string[] = [];
  lines.push(`월예산 ${won(eff)} 중 ${won(spent)} 사용 (${realPct}%)`);
  lines.push(wBudget > 0 ? `주예산 ${won(wBudget)} 중 ${won(wSpentVal)} 사용 (${wPct}%)` : `주예산 미설정`);
  lines.push(unpaidList.length ? `미납된 고정비는 ${unpaidList.join(", ")}이 있어요` : `미납된 고정비 없음`);
  lines.push(ydLine);
  lines.push(lastLine);

  return lines.join("\n");
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

  // 매분 호출되므로 알람 시각만 먼저 조회 (data 전체는 캡처 썸네일 때문에 커서 egress 폭증)
  const { data: alarmRow, error: alarmErr } = await supabase
    .from("app_data").select("alarm:data->>alarmTime").eq("id", ROW_ID).single();
  if (alarmErr || !alarmRow) return new Response("no data", { status: 200 });

  const alarmTime: string = (alarmRow as { alarm: string | null }).alarm || "09:00";
  const [ah, am] = alarmTime.split(":");
  if (hh !== ah || mm !== am) {
    return new Response("not time yet", { status: 200 });
  }

  // 발송 시각일 때만 data 전체 조회
  const { data: row, error } = await supabase
    .from("app_data").select("data").eq("id", ROW_ID).single();
  if (error || !row) return new Response("no data", { status: 200 });

  const S = row.data;

  // 같은 분에 cron이 중복 호출돼도 하루 한 번만 발송되도록 가드 (insert 충돌 시 스킵)
  const { error: logErr } = await supabase.from("notify_log").insert({ sent_date: dateStr });
  if (logErr) return new Response("already sent today", { status: 200 });

  try {
    const summary = buildSimpleSummary(S, dateStr);
    await sendTelegram(`💸 머니페이스 일일 리포트 (${dateStr})\n\n${summary}`);
    return new Response("sent", { status: 200 });
  } catch (e) {
    // 실패하면 같은 날 재시도할 수 있게 로그 롤백
    await supabase.from("notify_log").delete().eq("sent_date", dateStr);
    return new Response(`error: ${e}`, { status: 500 });
  }
});
