// 은행 입출금 알림 해석기 — 브라우저(머니페이스)와 Supabase Edge Function(Deno)이 같이 쓴다.
// 입력: {app, title, text, postedAt} (MacroDroid가 보낸 알림 한 건)
// 출력: {bank, type:'in'|'out', amount, balance, counterparty, account, method, at, raw, key} 또는 null(거래 알림 아님)
(function (root) {
  const num = (s) => (s == null ? null : parseInt(String(s).replace(/[^0-9]/g, ''), 10));

  // 알림에는 연도가 없다(MM/DD HH:MM). 알림이 온 시각(KST)의 연도를 쓰되,
  // 1월 초에 12월 거래 알림을 받는 경우처럼 거래 월이 알림 월보다 크면 전년도로 본다.
  function toIso(mmdd, hhmm, postedAt) {
    const base = postedAt ? new Date(postedAt) : new Date();
    const kst = new Date(base.getTime() + 9 * 3600e3);
    let y = kst.getUTCFullYear();
    const [mo, d] = mmdd.split('/').map(Number);
    if (mo > kst.getUTCMonth() + 1) y -= 1;
    const p = (n) => String(n).padStart(2, '0');
    return `${y}-${p(mo)}-${p(d)}T${hhmm}:00+09:00`;
  }

  // 카카오뱅크 — 카카오톡 알림톡. 제목 "카카오뱅크", 본문 예:
  //   09/25 02:08 / 입금 100원 / 보낸사람 → 입출금통장(0000) / 잔액 235,300원
  function parseKakao(n) {
    const t = n.text || '';
    const dt = t.match(/(\d{2}\/\d{2})\s+(\d{2}:\d{2})/);
    const kind = t.match(/(입금|출금|결제|승인|취소)\s*([\d,]+)원/);
    if (!dt || !kind) return null;
    const bal = t.match(/잔액\s*([\d,]+)원?/);
    const flow = t.match(/([^\n→]+?)\s*→\s*([^\n]+)/);
    let account = null, counterparty = null, type = null;
    if (flow) {
      const a = flow[1].trim(), b = flow[2].trim();
      // 내 계좌 쪽은 "통장(끝4자리)" 형태. 화살표가 내 계좌로 오면 입금, 나가면 출금.
      // (취소 알림은 원거래 방향에 따라 입금·출금이 갈리므로 단어가 아니라 화살표로 판단)
      if (/\(\d{4}\)/.test(b)) { account = b; counterparty = a; type = 'in'; }
      else if (/\(\d{4}\)/.test(a)) { account = a; counterparty = b; type = 'out'; }
    }
    if (!type) type = kind[1] === '입금' ? 'in' : kind[1] === '취소' ? null : 'out';
    if (!type) return null;
    return { bank: 'kakao', type, amount: num(kind[2]), balance: bal ? num(bal[1]) : null,
      counterparty, account, method: kind[1], at: toIso(dt[1], dt[2], n.postedAt) };
  }

  // KB국민은행 — KB스타뱅킹 앱 푸시(알림톡 없음). 제목 "출금 100원", 본문 예:
  //   홍*동님 09/25 02:08 123456-**-***789 토스홍길동 오픈뱅킹출금 100 잔액376,715
  function parseKb(n) {
    const title = n.title || '', t = n.text || '';
    const head = title.match(/(입금|출금)\s*([\d,]+)원/) || t.match(/(입금|출금)\s*([\d,]+)원/);
    const dt = t.match(/(\d{2}\/\d{2})\s+(\d{2}:\d{2})/);
    if (!head || !dt) return null;
    const bal = t.match(/잔액\s*([\d,]+)/);
    // 시각 다음: "계좌번호 상대방… 방식 금액 잔액"
    const mid = t.match(/\d{2}:\d{2}\s+(\S+)\s+(.+?)\s+[\d,]+\s+잔액/);
    let counterparty = null, method = null;
    if (mid) {
      const words = mid[2].trim().split(/\s+/);
      method = words.length > 1 ? words.pop() : null;
      counterparty = words.join(' ') || null;
    }
    // 본문 끝의 "금액 잔액…"과 제목 금액이 다르면 확인 필요로 표시한다.
    const bodyAmt = t.match(/([\d,]+)\s+잔액/);
    const amount = num(head[2]);
    const check = bodyAmt && num(bodyAmt[1]) !== amount;
    return { bank: 'kb', type: head[1] === '입금' ? 'in' : 'out', amount,
      balance: bal ? num(bal[1]) : null, counterparty, account: mid ? mid[1] : null, method,
      at: toIso(dt[1], dt[2], n.postedAt), ...(check ? { needsReview: true } : {}) };
  }

  function parseNotification(n) {
    if (!n) return null;
    const app = (n.app || '').toLowerCase();
    let r = null;
    if (/kakao\.talk|카카오톡/.test(app) && /카카오뱅크/.test(n.title || '')) r = parseKakao(n);
    else if (/kbstar|kb스타|국민/.test(app)) r = parseKb(n);
    if (!r || !r.amount) return null;
    r.raw = [n.title, n.text].filter(Boolean).join('\n');
    // 같은 알림이 두 번 와도 한 번만 저장하기 위한 키.
    // 알림 게시 시각(밀리초)이 있으면 그걸 쓴다: 같은 분·같은 금액·같은 잔액인 서로 다른 거래도 구분된다.
    // 게시 시각이 없는 경우(카카오톡 대화 내보내기 파일로 채울 때)만 거래 내용으로 키를 만든다.
    r.key = n.postedAt ? [r.bank, new Date(n.postedAt).getTime(), r.type, r.amount].join('|')
      : [r.bank, r.at, r.type, r.amount, r.balance, r.counterparty].join('|');
    return r;
  }

  // 내 계좌끼리 이동.
  // - 확정(transfer): 서로 다른 은행에서 같은 금액이 출금·입금으로 10분 안에 오고,
  //   양쪽 중 한쪽이라도 상대방에 본인 이름(ownerNames)이 들어 있을 때만 짝짓는다.
  //   (금액·시각만 맞는 우연한 두 거래를 이동으로 오인하지 않도록)
  // - 추정(transferGuess): 짝은 없지만 상대방에 본인 이름이 있는 경우. 동명이인일 수 있어 사용자 확인을 받는다.
  function markTransfers(txs, ownerNames) {
    const names = (ownerNames || []).filter(Boolean).map((nm) => nm.replace(/\s/g, ''));
    const out = txs.map((t) => ({ ...t, transfer: false, transferGuess: false }));
    const own = (c) => !!c && names.some((nm) => c.replace(/\s/g, '').includes(nm));
    for (const a of out) {
      if (a.transfer || a.type !== 'out') continue;
      const b = out.find((x) => !x.transfer && x !== a && x.type === 'in' && x.bank !== a.bank &&
        x.amount === a.amount && Math.abs(new Date(x.at) - new Date(a.at)) <= 10 * 60e3 &&
        (own(a.counterparty) || own(x.counterparty)));
      if (b) { a.transfer = true; b.transfer = true; }
    }
    for (const t of out) if (!t.transfer && own(t.counterparty)) t.transferGuess = true;
    return out;
  }

  const api = { parseNotification, markTransfers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TxParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
