// 매일 설정한 시간(S.alarmTime)에 지출 현황을 분석해서 텔레그램으로 보내는 함수
// pg_cron이 1분마다 호출하고, 여기서 알람 시간이 맞는지 확인 후 1회만 발송한다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// "오전/오후 h:mm" 문자열을 자정 기준 분(0~1439)으로 변환. 문자열 그대로 비교하면
// "오후 12:32"가 "오후 11:00"보다 커져서(문자 '2'>'1') 실제로는 더 이른 정오가 늦은 11시로 오인되는 버그가 있어
// 같은 날 캡처 중 진짜 최신을 고르려면 반드시 이 숫자로 비교해야 한다.
function timeToMinutes(t: string): number {
  const m = /^(오전|오후)\s*(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return 0;
  let h = parseInt(m[2], 10);
  const isPM = m[1] === "오후";
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  return h * 60 + parseInt(m[3], 10);
}

// 캡처 기록을 날짜별 '그날 가장 최근' 총잔액으로 압축
function capturesByDate(S: any): Record<string, { date: string; minutes: number; total: number }> {
  const withTotal = (S.captures || []).map((c: any) => ({
    date: c.date, minutes: timeToMinutes(c.time), total: totalBalance(c.balances || {}),
  }));
  const byDate: Record<string, any> = {};
  for (const c of withTotal) {
    if (!byDate[c.date] || c.minutes > byDate[c.date].minutes) byDate[c.date] = c;
  }
  return byDate;
}

// 기간(from~to, 포함) 중 실제로 빠져나간(paid) 고정지출 합계.
// 고정지출은 unpaidFixed로 이미 예산에서 선차감돼 있으므로, 실제 빠져나간 날의 잔액 감소분에서
// 이 금액을 다시 빼줘야 일별/주간 "쓴 돈"에 이중으로 잡히지 않는다.
// affectsBalance:false인 항목(예: 추적 안 하는 별도 저축통장으로 빠지는 저축)은 애초에 카카오/국민/신한
// 잔액 diff에 안 잡히므로 여기서도 빼면 안 됨 — 명시적으로 false가 아닌 한(기본값 true) 포함.
function fixedPaidInRange(S: any, from: string, to: string) {
  return (S.fixed || []).filter((f: any) => f.paid && f.paidDate && f.paidDate >= from && f.paidDate <= to && f.affectsBalance !== false)
    .reduce((a: number, f: any) => a + (f.amount || 0), 0);
}

// 클라이언트 getDailySpent()와 동일: '오늘'(todayStr, 실제 달력 기준)과 오늘 이전 가장 최근 날짜의 잔액 차이.
// 오늘 캡처가 없으면 지출 0원으로 처리(전날 이전 캡처와 비교해 stale하게 보여주지 않음).
function getDailySpent(S: any, todayStr: string) {
  const byDate = capturesByDate(S);
  const prevDate = Object.keys(byDate).filter((d) => d < todayStr).sort((a, b) => b.localeCompare(a))[0];
  if (!prevDate) return null; // 오늘 이전 캡처가 아예 없으면 비교 불가
  const prevTotal = byDate[prevDate].total;
  const todayCap = byDate[todayStr];
  if (!todayCap) return { spent: 0, todayDate: todayStr, prevDate, prevTotal, noCaptureToday: true };
  const spent = prevTotal - todayCap.total - fixedPaidInRange(S, todayStr, todayStr);
  return { spent, todayDate: todayStr, prevDate, prevTotal, todayTotal: todayCap.total };
}

// 클라이언트 getTodayBudget()과 동일: 오늘 하루치 배정액(어제 마감 잔액 기준)에서 오늘 실제 지출을 바로 차감
function getTodayBudget(S: any, todayStr: string, eff: number, unpaidFixed: number, remaining: number, totSpentNow: number) {
  const ds = getDailySpent(S, todayStr);
  const remainAtDayStart = (ds && ds.prevTotal != null)
    ? Math.min(eff, Math.max(0, ds.prevTotal - unpaidFixed))
    : (eff - totSpentNow);
  const baseline = remaining > 0 ? Math.floor(Math.max(0, remainAtDayStart) / remaining) : 0;
  const spentToday = (ds && !ds.noCaptureToday && ds.spent > 0) ? ds.spent : 0;
  return { todayBudget: baseline - spentToday, ds };
}

// 클라이언트 getWeeklySpent()와 동일: 주 시작 시점 잔액 - 현재 잔액
function getWeeklySpent(S: any, weekStartStr: string, todayStr: string) {
  const days = Object.values(capturesByDate(S)).sort((a: any, b: any) => a.date.localeCompare(b.date));
  if (days.length < 1) return null;
  let startBal: number | null = null, curBal: number | null = null;
  for (const d of days as any[]) {
    if (d.date < weekStartStr) startBal = d.total;
    curBal = d.total;
  }
  if (startBal === null) {
    const inWeek = (days as any[]).filter((d) => d.date >= weekStartStr);
    if (inWeek.length < 1) return null;
    startBal = inWeek[0].total;
    curBal = inWeek[inWeek.length - 1].total;
  }
  // 이번 주 안에 실제로 빠져나간(=affectsBalance:false가 아닌) 고정지출은 잔액 감소분에서 제외.
  // "오늘 체크한 것만" 빼면 다음날부터 그 금액이 다시 이번주 지출로 새는 버그가 있어 전체 주 범위로 뺀다.
  const fixedThisWeek = fixedPaidInRange(S, weekStartStr, todayStr);
  return { spent: Math.max(0, (startBal as number) - (curBal as number) - fixedThisWeek) };
}

// 핵심 5줄만 남긴 심플 리포트 (AI 코멘트가 너무 길다는 피드백 반영 — 잔액 내역·일별추이·메모·페이스 라벨 등은 전부 제거)
function buildSimpleSummary(S: any, todayStr: string) {
  const fixedTot = (S.fixed || []).reduce((a: number, f: any) => a + (f.amount || 0), 0);
  const unpaidFixed = (S.fixed || []).filter((f: any) => !f.paid).reduce((a: number, f: any) => a + (f.amount || 0), 0);
  const eff = Math.max(0, (S.budget || 0) - fixedTot);
  const tb = totalBalance(S.balances || {});
  const usable = Math.max(0, tb - unpaidFixed);
  const spent = tb > 0 ? Math.max(0, eff - usable) : 0;
  const remain = eff - spent;
  const realPct = Math.round(spent / Math.max(eff, 1) * 100);

  let total = 30, elapsed = 15, remaining = 15;
  if (S.budgetStart && S.budgetEnd) {
    total = Math.max(1, daysBetween(S.budgetStart, S.budgetEnd) + 1);
    elapsed = Math.max(0, Math.min(total, daysBetween(S.budgetStart, todayStr) + 1));
    remaining = Math.max(1, total - elapsed + 1);
  }
  const { todayBudget } = getTodayBudget(S, todayStr, eff, unpaidFixed, remaining, spent);

  const yd = new Date(`${todayStr}T00:00:00Z`);
  yd.setUTCDate(yd.getUTCDate() - 1);
  const ydStr = yd.toISOString().slice(0, 10);
  const ydSpentVal = getMemos(S, ydStr).reduce((a: number, c: any) => a + (c.amt || 0), 0);

  const weekStartStr = weekStartOf(todayStr);
  const wBudget = S.weeklyBudget || 0;
  const ws = getWeeklySpent(S, weekStartStr, todayStr);
  const wSpentVal = ws ? ws.spent : 0;
  const wPct = Math.round(wSpentVal / Math.max(wBudget, 1) * 100);

  const unpaidList = (S.fixed || []).filter((f: any) => !f.paid).map((f: any) => `${f.name} ${won(f.amount)}`);
  const recommendedDaily = remain > 0 ? Math.round(remain / remaining) : 0;
  const recommendedWeekly = recommendedDaily * 7;

  const lines: string[] = [];
  lines.push(`월예산 ${won(eff)} 중 ${won(spent)} 사용 (${realPct}%)`);
  lines.push(wBudget > 0 ? `주예산 ${won(wBudget)} 중 ${won(wSpentVal)} 사용 (${wPct}%)` : `주예산 미설정`);
  lines.push(unpaidList.length ? `미납된 고정비는 ${unpaidList.join(", ")}이 있어요` : `미납된 고정비 없음`);
  lines.push(`어제 ${won(ydSpentVal)} 썼으니 오늘은 ${todayBudget < 0 ? "-" + won(Math.abs(todayBudget)) : won(todayBudget)} 써도 괜찮아요`);
  lines.push(remain > 0
    ? `이 페이스면 주에 ${won(recommendedWeekly)} 일에 ${won(recommendedDaily)} 써야될 것 같아요`
    : `이미 이번 달 예산을 초과해서 지출을 최대한 줄이는 게 좋아요`);

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
    const summary = buildSimpleSummary(S, dateStr);
    await sendTelegram(`💸 머니페이스 일일 리포트 (${dateStr})\n\n${summary}`);
    return new Response("sent", { status: 200 });
  } catch (e) {
    // 실패하면 같은 날 재시도할 수 있게 로그 롤백
    await supabase.from("notify_log").delete().eq("sent_date", dateStr);
    return new Response(`error: ${e}`, { status: 500 });
  }
});
