// 입출금 알림 받기 — 순수 함수(테스트는 node, 실제 실행은 index.ts가 Deno에서 감싼다).
// 휴대폰 MacroDroid가 은행 알림(카카오톡 '카카오뱅크' 알림톡, KB스타뱅킹 푸시)만 골라 보내면(기기에서 먼저 필터)
// 헤더 비밀키를 확인하고, 거래 알림이면 해석해서 저장한다. 서버도 한 번 더 걸러서 은행 알림이 아니면 버린다.

import { secretMatches } from "../_shared/auth.js";
export { secretMatches };

export const MAX_BODY = 8000; // 알림 한 건은 수백 바이트. 크게 오면 거절(남용·실수 방지)

// MacroDroid 본문은 설정에 따라 JSON이거나(줄바꿈이 이스케이프 안 될 수 있음) 폼 형식일 수 있어 둘 다 받는다.
export function parseBody(bodyText, contentType) {
  const ct = (contentType || "").toLowerCase();
  const tryJson = (t) => { try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; } };
  if (!ct.includes("x-www-form-urlencoded")) {
    const j = tryJson(bodyText) ||
      // 문자열 안의 실제 줄바꿈·탭을 이스케이프해서 한 번 더 시도
      tryJson(bodyText.replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t"));
    if (j) return j;
  }
  const params = new URLSearchParams(bodyText);
  const o = {};
  for (const [k, v] of params) o[k] = v;
  return Object.keys(o).length ? o : null;
}

// 은행 알림인지(서버 쪽 재확인). 카카오톡은 제목이 정확히 '카카오뱅크'인 것만.
export function isBankNotification(app, title) {
  const a = String(app || "").toLowerCase(), t = String(title || "").trim();
  return (a === "com.kakao.talk" && t === "카카오뱅크") || a.startsWith("com.kbstar.");
}

// req: {method, headers: {get(name)}, readBody(): Promise<string>, contentType, now}
// deps: {secret, parse(n) -> tx|null, insert(row) -> Promise<'inserted'|'duplicate'>, saveUnparsed(o) -> Promise, heartbeat() -> Promise,
//        parseHint(n) -> {at,amount,merchant,key}|null, saveHint(h) -> Promise}
export async function handleIngest(req, deps) {
  if (req.method !== "POST") return { status: 405, body: "method" };
  if (!deps.secret) return { status: 500, body: "not configured" };
  // 본문을 읽기 전에 헤더로 먼저 거른다(비밀키·길이)
  if (!(await secretMatches(req.headers.get("x-ingest-secret"), deps.secret))) return { status: 401, body: "unauthorized" };
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return { status: 413, body: "too large" };
  const bodyText = await req.readBody();
  if (bodyText.length > MAX_BODY) return { status: 413, body: "too large" };
  const data = parseBody(bodyText, req.contentType);
  if (!data) return { status: 400, body: "bad body" };

  // 생존 신호: MacroDroid가 하루 한 번 보낸다. 끊기면 일일 리포트가 경고한다(시각 한 줄만 저장)
  if (data.kind === "heartbeat") {
    if (!deps.heartbeat) return { status: 500, body: "not configured" };
    await deps.heartbeat();
    return { status: 200, body: "alive" };
  }

  const app = String(data.app || ""), title = String(data.title || "");

  // KB Pay(카드 앱) 승인 알림: 거래가 아니라 '실제 가게 이름' 힌트로만 저장(통장 출금 알림과 앱이 짝지음)
  if (app.toLowerCase().startsWith("com.kbcard.")) {
    if (!deps.parseHint || !deps.saveHint) return { status: 200, body: "skip" };
    const h = deps.parseHint({ app, title, text: String(data.text || ""), big: String(data.big || ""), postedAt: req.now });
    if (!h) return { status: 200, body: "skip" };
    await deps.saveHint(h);
    return { status: 200, body: "hint" };
  }
  if (!isBankNotification(app, title)) return { status: 200, body: "skip" }; // 은행 알림 아님 → 아무것도 저장 안 함

  // 펼친 알림 전체 글(big)이 있으면 그걸 쓴다(카카오 알림톡은 여러 줄이라 미리보기가 잘릴 수 있음)
  const text = String(data.big || data.text || "");
  const tx = deps.parse({ app, title, text, postedAt: req.now });
  if (!tx) {
    // 은행 알림인데 해석 못 함(형식 변경 등) → 원문을 따로 보관해 나중에 다시 해석
    await deps.saveUnparsed({ app, title: title.slice(0, 200), body: text.slice(0, 2000) });
    return { status: 200, body: "unparsed" };
  }

  // 서버가 받은 시각은 알림마다 달라 중복 판정에 못 쓴다. 거래 내용(계좌·잔액 포함)으로 키를 만든다.
  const key = [tx.bank, tx.account || "", tx.at, tx.type, tx.amount, tx.balance, tx.counterparty || ""].join("|");
  const row = {
    key, bank: tx.bank, type: tx.type, amount: tx.amount, balance: tx.balance ?? null,
    counterparty: tx.counterparty ?? null, account: tx.account ?? null, method: tx.method ?? null,
    at: tx.at, needs_review: !!tx.needsReview, raw: tx.raw.slice(0, 1000),
  };
  const result = await deps.insert(row);
  return { status: 200, body: result === "duplicate" ? "dup" : "ok" };
}
