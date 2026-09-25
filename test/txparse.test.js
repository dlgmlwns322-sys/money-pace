// 알림 해석기 검증 (실제 알림 2건을 가명·가짜 계좌로 바꾼 것 + 변형). 실행: node test/txparse.test.js
const assert = require('assert');
const { parseNotification, markTransfers } = require('../txparse.js');
const posted = '2026-09-24T17:08:30Z'; // KST 09/25 02:08
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('ok -', name); };
const kakaoMsg = (text) => parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: posted, text });

const kakao = kakaoMsg('09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원');
t('카카오뱅크 입금', () => {
  assert.strictEqual(kakao.bank, 'kakao');
  assert.strictEqual(kakao.type, 'in');
  assert.strictEqual(kakao.amount, 100);
  assert.strictEqual(kakao.balance, 235300);
  assert.strictEqual(kakao.counterparty, '홍길동');
  assert.strictEqual(kakao.account, '입출금통장(0000)');
  assert.strictEqual(kakao.at, '2026-09-25T02:08:00+09:00');
});

const kb = parseNotification({ app: 'com.kbstar.kbbank', title: '출금 100원', postedAt: posted,
  text: '홍*동님 09/25 02:08 123456-**-***789 토스홍길동 오픈뱅킹출금 100 잔액376,715' });
t('KB 출금', () => {
  assert.strictEqual(kb.bank, 'kb');
  assert.strictEqual(kb.type, 'out');
  assert.strictEqual(kb.amount, 100);
  assert.strictEqual(kb.balance, 376715);
  assert.strictEqual(kb.counterparty, '토스홍길동');
  assert.strictEqual(kb.method, '오픈뱅킹출금');
  assert.strictEqual(kb.account, '123456-**-***789');
  assert.strictEqual(kb.needsReview, undefined);
});

t('카카오뱅크 출금(방향 반대)', () => {
  const r = kakaoMsg('09/25 12:30\n출금 4,500원\n입출금통장(0000) → 스타벅스\n잔액 230,800원');
  assert.strictEqual(r.type, 'out');
  assert.strictEqual(r.counterparty, '스타벅스');
  assert.strictEqual(r.amount, 4500);
});

t('카카오뱅크 취소는 화살표 방향으로 판단', () => {
  assert.strictEqual(kakaoMsg('09/25 13:00\n취소 4,500원\n스타벅스 → 입출금통장(0000)\n잔액 235,300원').type, 'in');
  assert.strictEqual(kakaoMsg('09/25 13:05\n취소 100원\n입출금통장(0000) → 홍길동\n잔액 235,200원').type, 'out');
});

t('KB 입금(제목 없이 본문만)', () => {
  const r = parseNotification({ app: 'com.kbstar.kbbank', title: '', postedAt: posted,
    text: '입금 1,200,000원 홍*동님 09/25 09:00 123456-**-***789 회사명 급여 1,200,000 잔액1,576,715' });
  assert.strictEqual(r.type, 'in');
  assert.strictEqual(r.amount, 1200000);
  assert.strictEqual(r.balance, 1576715);
});

t('KB 제목·본문 금액이 다르면 확인 필요', () => {
  const r = parseNotification({ app: 'com.kbstar.kbbank', title: '출금 100원', postedAt: posted,
    text: '홍*동님 09/25 02:08 123456-**-***789 토스홍길동 오픈뱅킹출금 1,000 잔액376,715' });
  assert.strictEqual(r.needsReview, true);
});

t('거래 알림이 아니면 null', () => {
  assert.strictEqual(parseNotification({ app: 'com.kakao.talk', title: '친구', text: '밥 먹었어?' }), null);
  assert.strictEqual(parseNotification({ app: 'com.kbstar.kbbank', title: 'KB 이벤트 안내', text: '포인트 받기' }), null);
});

t('내 계좌끼리 이동 짝짓기(본인 이름이 있어야 확정)', () => {
  assert.ok(markTransfers([kb, kakao], ['홍길동']).every((x) => x.transfer));
  assert.ok(markTransfers([kb, kakao], []).every((x) => !x.transfer));
});

t('금액·시각만 우연히 맞는 남과의 거래는 이동 아님', () => {
  const sent = { ...kb, counterparty: '김철수' }, got = { ...kakao, counterparty: '박영희' };
  assert.ok(markTransfers([sent, got], ['홍길동']).every((x) => !x.transfer && !x.transferGuess));
});

t('금액이 다르면 이동 아님', () => {
  assert.ok(markTransfers([kb, { ...kakao, amount: 200 }]).every((x) => !x.transfer));
});

t('짝 없이 본인 이름만 있으면 이동 추정(확인 필요)', () => {
  const m = markTransfers([{ ...kb, at: '2026-09-25T05:00:00+09:00' }], ['홍길동']);
  assert.strictEqual(m[0].transfer, false);
  assert.strictEqual(m[0].transferGuess, true);
});

t('1월에 받은 12월 알림은 전년도', () => {
  const r = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: '2027-01-01T00:10:00Z',
    text: '12/31 23:59\n출금 1,000원\n입출금통장(0000) → 편의점\n잔액 1,000원' });
  assert.strictEqual(r.at.slice(0, 4), '2026');
});

t('같은 알림 두 번이면 키 동일(중복 제거)', () => {
  assert.strictEqual(kakaoMsg('09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원').key, kakao.key);
});

t('같은 분·금액·잔액이어도 게시 시각이 다르면 다른 거래', () => {
  const text = '09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원';
  const a = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: '2026-09-24T17:08:10.100Z', text });
  const b = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: '2026-09-24T17:08:40.500Z', text });
  assert.notStrictEqual(a.key, b.key);
});

// 2026-09-26 사용자 실제 알림 형식(이름·계좌·카드번호는 가짜로 바꿈)
t('카카오뱅크 체크카드 결제: 가맹점·잔액, 뒤의 홍보 문구는 무시', () => {
  const r = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: '2026-09-25T15:09:30Z',
    text: '09/26 00:09\n카드 결제 600원\n체크카드(0000) | 더 까까주까\n잔액 214,700원\n\n이번달 총 이용금액과 캐시백은 얼마?\n카드 이용내역에서 확인해보세요!⬇️' });
  assert.strictEqual(r.type, 'out'); assert.strictEqual(r.amount, 600); assert.strictEqual(r.balance, 214700);
  assert.strictEqual(r.counterparty, '더 까까주까'); assert.strictEqual(r.account, '체크카드(0000)');
  assert.strictEqual(r.at, '2026-09-26T00:09:00+09:00', '알림 시각은 자정 기준 그대로(가계부 날짜는 앱이 6시 기준으로 판정)');
});
t('KB 체크카드출금(펼친 전체 글)', () => {
  const r = parseNotification({ app: 'com.kbstar.kbbank', title: '출금 5,000원', postedAt: '2026-09-25T10:29:10Z',
    text: '홍*동님 09/25 19:29 123456-**-***789 이니시스(    체크카드출금 5,000 잔액370,215' });
  assert.strictEqual(r.amount, 5000); assert.strictEqual(r.balance, 370215); assert.strictEqual(r.method, '체크카드출금');
  assert.ok(!r.needsReview);
});
t('잘린 미리보기 잔액("잔액375,...")은 버림 → 잘못된 잔액으로 누락 오탐하지 않게', () => {
  const r = parseNotification({ app: 'com.kbstar.kbbank', title: '출금 1,500원', postedAt: '2026-09-25T10:13:10Z',
    text: '홍*동님 09/25 19:13 123456-**-***789 메가MGC(인 체크카드출금 1,500 잔액375,...' });
  assert.strictEqual(r.amount, 1500); assert.strictEqual(r.balance, null);
  for (const text of ['09/26 00:09\n카드 결제 600원\n잔액 214,…', '09/26 00:09\n카드 결제 600원\n잔액 214,']) {
    assert.strictEqual(parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', text }).balance, null, text);
  }
});
t('KB Pay 앱 알림(잔액 없음·중복)은 은행 알림이 아님', () => {
  assert.strictEqual(parseNotification({ app: 'com.kbcard.cxh.appcard', title: 'KB Pay', text: '[KB Pay 사용 알림] 체크 0000 09/25 19:29 5,000원 가게 승인' }), null);
});

t('KB Pay 승인 알림 → 가게 이름 힌트(거래 아님)', () => {
  const { parseCardHint } = require('../txparse.js');
  const h = parseCardHint({ app: 'com.kbcard.cxh.appcard', title: 'KB Pay', postedAt: '2026-09-25T10:29:20Z', text: '[KB Pay 사용 알림] 체크 0000 09/25 19:29 5,000원 쿤자PC방 승인' });
  assert.deepStrictEqual({ at: h.at, amount: h.amount, merchant: h.merchant }, { at: '2026-09-25T19:29:00+09:00', amount: 5000, merchant: '쿤자PC방' });
  assert.strictEqual(h.key, 'hint|2026-09-25T19:29:00+09:00|5000|쿤자PC방', '같은 분·같은 금액이라도 가게가 다르면 다른 힌트');
  assert.strictEqual(parseCardHint({ app: 'com.kbcard.cxh.appcard', title: 'KB Pay', text: '09/25 19:29 5,000원 쿤자PC방 사용 취소' }), null, '"사용 취소"도 안 씀');
  const h2 = parseCardHint({ app: 'com.kbcard.cxh.appcard', title: 'KB국민카드', big: 'KB국민체크(0000)\n홍*동님\n09/25 12:03\n12,000원\n김밥 천국 군자점 사용', text: '잘린 글' });
  assert.strictEqual(h2.merchant, '김밥 천국 군자점', '펼친 글(big) 우선, 줄바꿈 무시');
  assert.strictEqual(parseCardHint({ app: 'com.kbcard.cxh.appcard', title: 'KB Pay', text: '09/25 19:29 5,000원 쿤자PC방 취소' }), null, '취소는 안 씀');
  assert.strictEqual(parseCardHint({ app: 'com.kbcard.cxh.appcard', title: 'KB Pay', text: '이번 달 혜택 안내' }), null);
  assert.strictEqual(parseCardHint({ app: 'com.kbstar.kbbank', title: '출금 5,000원', text: '09/25 19:29 5,000원 가게 승인' }), null, '은행 앱은 힌트 아님');
});

console.log(`\n통과 ${ok}개`);
