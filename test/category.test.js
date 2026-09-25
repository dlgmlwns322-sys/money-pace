// 카테고리 자동 분류 검증. 실행: node test/category.test.js
const assert = require('assert');
const { categorize, CATS } = require('../category.js');
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok -', n); };
const cases = {
  배달: ['배달의민족', '쿠팡이츠 서울', '요기요_결제'],
  카페: ['메가MGC커피 군자역점', '군자역점(메가MGC커', '스타벅스 강남', '이디야커피', '파리바게뜨', 'COFFEE BEAN'],
  편의점: ['GS25 군자점', 'CU 난바점', 'CU 강남점', 'cu', '세븐일레븐', '이마트24'],
  피시방: ['쿤자PC방', '피시방 OO', 'OO PC카페'],
  병원: ['OO정형외과의원', 'OO약국', '서울치과', 'OO한의원'],
  쇼핑: ['쿠팡', '네이버페이', '올리브영 강남', '다이소', '이마트 성수점'],
  식비: ['김밥천국', '교촌치킨', '맥도날드 군자', '한솥도시락'],
  기타: ['이니시스(', '토스페이먼츠', '', '더 까까주까', '엄마손집', '인형의집', '빵빵문구', '자라나는서점', 'cute shop'],
};
t('가맹점 이름 → 카테고리(우선순위: 배달 → 피시방 → 카페 → 편의점 → 병원 → 쇼핑 → 식비)', () => {
  for (const [cat, names] of Object.entries(cases)) for (const n of names) assert.strictEqual(categorize(n), cat, `${n} → ${categorize(n)} (기대 ${cat})`);
});
t('KB Pay 가게 이름 짝짓기: 국민은행 카드 출금만, 3분 안, 시간 순서대로 1:1', () => {
  const app = require('./app.js')({ now: '2026-09-26T12:00:00+09:00' });
  const o = (id, at, extra = {}) => ({ id, bank: 'kb', type: 'out', amount: 5000, balance: null, counterparty: '이니시스(', method: '체크카드출금', at: `2026-09-25T${at}:00+09:00`, ...extra });
  const rows = [o(1, '11:58'), o(2, '12:01'), o(3, '12:00', { method: '오픈뱅킹출금', counterparty: '친구' }), o(4, '12:00', { bank: 'kakao', method: '결제' }), o(5, '15:00')];
  const hints = [{ id: 1, at: '2026-09-25T12:00:00+09:00', amount: 5000, merchant: 'A카페' }, { id: 2, at: '2026-09-25T12:02:00+09:00', amount: 5000, merchant: 'B김밥' }];
  app.set({ S: { budget: 1, budgetStart: '2026-09-23', budgetEnd: '2026-10-22', ownerNames: '홍길동', fixed: [] }, TX: { rows, hints } });
  const m = Object.fromEntries(app.fn.txWithFlags().map((r) => [r.id, r.merchant]));
  assert.deepStrictEqual(m, { 1: 'A카페', 2: 'B김밥', 3: '친구', 4: '이니시스(', 5: '이니시스(' });
});
t('카테고리는 사용자 지정 8개', () => {
  assert.deepStrictEqual(CATS, ['식비', '카페', '편의점', '쇼핑', '병원', '배달', '피시방', '기타']);
});
console.log(`\n통과 ${ok}개`);
