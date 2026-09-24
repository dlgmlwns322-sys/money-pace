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

console.log(`\n통과 ${ok}개`);
