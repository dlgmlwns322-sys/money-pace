// 알림 해석기 검증 (실제 알림 2건을 가명으로 바꾼 것 + 변형). 실행: node test/txparse.test.js
const assert = require('assert');
const { parseNotification, markTransfers } = require('../txparse.js');
const posted = '2026-09-24T17:08:30Z'; // KST 09/25 02:08
let ok = 0;
const t = (name, fn) => { fn(); ok++; t('카카오뱅크 취소는 화살표 방향으로 판단', () => {
  const refund = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: posted,
    text: '09/25 13:00
취소 4,500원
스타벅스 → 입출금통장(0000)
잔액 235,300원' });
  assert.strictEqual(refund.type, 'in');
  const undo = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: posted,
    text: '09/25 13:05
취소 100원
입출금통장(0000) → 홍길동
잔액 235,200원' });
  assert.strictEqual(undo.type, 'out');
});

t('KB 제목·본문 금액이 다르면 확인 필요', () => {
  const r = parseNotification({ app: 'com.kbstar.kbbank', title: '출금 100원', postedAt: posted,
    text: '홍*동님 09/25 02:08 123456-**-***789 토스홍길동 오픈뱅킹출금 1,000 잔액376,715' });
  assert.strictEqual(r.needsReview, true);
  assert.strictEqual(kb.needsReview, undefined);
});

console.log('ok -', name); };

const kakao = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: posted,
  text: '09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원' });
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
});

t('카카오뱅크 출금(방향 반대)', () => {
  const r = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: posted,
    text: '09/25 12:30\n출금 4,500원\n입출금통장(0000) → 스타벅스\n잔액 230,800원' });
  assert.strictEqual(r.type, 'out');
  assert.strictEqual(r.counterparty, '스타벅스');
  assert.strictEqual(r.amount, 4500);
});

t('KB 입금(제목 없이 본문만)', () => {
  const r = parseNotification({ app: 'com.kbstar.kbbank', title: '', postedAt: posted,
    text: '입금 1,200,000원 홍*동님 09/25 09:00 123456-**-***789 회사명 급여 1,200,000 잔액1,576,715' });
  assert.strictEqual(r.type, 'in');
  assert.strictEqual(r.amount, 1200000);
  assert.strictEqual(r.balance, 1576715);
});

t('거래 알림이 아니면 null', () => {
  assert.strictEqual(parseNotification({ app: 'com.kakao.talk', title: '친구', text: '밥 먹었어?' }), null);
  assert.strictEqual(parseNotification({ app: 'com.kbstar.kbbank', title: 'KB 이벤트 안내', text: '포인트 받기' }), null);
});

t('내 계좌끼리 이동 짝짓기', () => {
  assert.ok(markTransfers([kb, kakao]).every((x) => x.transfer));
});

t('금액이 다르면 이동 아님', () => {
  assert.ok(markTransfers([kb, { ...kakao, amount: 200 }]).every((x) => !x.transfer));
});

t('본인 이름 상대방은 이동', () => {
  const m = markTransfers([{ ...kb, at: '2026-09-25T05:00:00+09:00' }], ['홍길동']);
  assert.ok(m[0].transfer);
});

t('1월에 받은 12월 알림은 전년도', () => {
  const r = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: '2027-01-01T00:10:00Z',
    text: '12/31 23:59\n출금 1,000원\n입출금통장(0000) → 편의점\n잔액 1,000원' });
  assert.strictEqual(r.at.slice(0, 4), '2026');
});

t('같은 알림 두 번이면 키 동일(중복 제거)', () => {
  const again = parseNotification({ app: 'com.kakao.talk', title: '카카오뱅크', postedAt: posted,
    text: '09/25 02:08\n입금 100원\n홍길동 → 입출금통장(0000)\n잔액 235,300원' });
  assert.strictEqual(again.key, kakao.key);
});

console.log(`\n통과 ${ok}개`);
