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
  옷: ['유니클로 강남점', 'ZARA 코엑스', '무신사스토어', '탑텐 군자'],
  교통: ['카카오T 택시', '티머니', '코레일 KTX', 'GS칼텍스 주유소', '공영주차장', '쏘카'],
  식비: ['김밥천국', '교촌치킨', '맥도날드 군자', '한솥도시락'],
  기타: ['이니시스(', '토스페이먼츠', '', '더 까까주까', '엄마손집', '인형의집', '빵빵문구', '자라나는서점', 'cute shop', '카카오TV', '그린카펫', '탑텐볼링장'],
};
t('가맹점 이름 → 카테고리(우선순위: 배달 → 피시방 → 카페 → 편의점 → 병원 → 교통 → 옷 → 쇼핑 → 식비)', () => {
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
t('카테고리 12개(약속·직접은 자동 분류 없이 직접 고름, 2026-10-07)', () => {
  assert.deepStrictEqual(CATS, ['식비', '카페', '편의점', '쇼핑', '옷', '교통', '약속', '병원', '배달', '피시방', '직접', '기타']);
});
t('직접 칸: 처음 고를 때 이름을 받고, 이름을 바꿔도 지정한 거래는 그대로', () => {
  let answer = '  데이트비용이름이아주긴경우  ';
  const app = require('./app.js')({ now: '2026-09-26T12:00:00+09:00', prompt: () => answer });
  const rows = [{ id: 1, bank: 'kb', type: 'out', amount: 9000, balance: 1000, counterparty: '어딘가', at: '2026-09-25T12:00:00+09:00' }];
  app.set({ S: { budget: 1, budgetStart: '2026-09-23', budgetEnd: '2026-10-22', txSince: '2026-09-21', ownerNames: '홍길동', fixed: [] }, TX: { rows } });
  assert.strictEqual(app.fn.catName('직접'), '직접 입력');
  answer = null; app.fn.setTxCat(1, '직접');
  assert.strictEqual(app.fn.txCategory(rows[0]), '기타', '이름을 안 정하면 바꾸지 않음');
  answer = '  데이트비용이름이아주긴경우  '; app.fn.setTxCat(1, '직접');
  assert.strictEqual(app.S.customCat, '데이트비용이름이아주', '앞뒤 공백 없이 10자까지');
  assert.strictEqual(app.fn.txCategory(rows[0]), '직접');
  app.S.customCat = '데이트';
  assert.strictEqual(app.fn.catName('직접'), '데이트');
  answer = '가나다라마바사아자😀🙂'; app.S.customCat = ''; app.fn.setTxCat(1, '직접');
  assert.strictEqual(app.S.customCat, '가나다라마바사아자😀', '이모지를 반으로 자르지 않음');
  assert.strictEqual(app.fn.txCategory(rows[0]), '직접', '이름을 바꿔도 지정 유지');
});
console.log(`\n통과 ${ok}개`);
