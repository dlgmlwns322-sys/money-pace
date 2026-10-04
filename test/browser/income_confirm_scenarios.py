"""가짜 데이터: 입금 확인 UI, 선택 저장, 저장 실패, 새로고침 검증."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

url = (Path(__file__).resolve().parents[2] / 'index.html').as_uri()
seed = {'budget': 800000, 'budgetStart': '2026-09-23', 'budgetEnd': '2026-10-22',
        'txSince': '2026-09-29', 'ownerNames': '홍길동', 'txReadSecret': 'fake-local-only',
        'balances': {'kakao': 517000, 'kb': 100000}, 'fixed': [], 'captures': [], 'memos': {},
        'spentAdjust': {'date': '2026-09-23', 'amount': 300000}}
rows = [{'id': 1, 'bank': 'kakao', 'type': 'in', 'amount': 17000, 'balance': 517000,
         'counterparty': '홍길동', 'at': '2026-10-03T21:09:00+09:00'}]
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge')
    page = browser.new_page(viewport={'width': 390, 'height': 844}, locale='ko-KR')
    page.clock.install(time=__import__('datetime').datetime.fromisoformat('2026-10-04T03:30:00+09:00'))
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('https://**/*', lambda route: route.abort())
    page.add_init_script(f"""if(!sessionStorage.getItem('seeded')){{
      localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});
      localStorage.setItem('mp_tx', JSON.stringify({{rows:{json.dumps(rows)},maxId:1,lastFull:Date.now(),lastFetch:Date.now(),lastOk:Date.now()}}));
      sessionStorage.setItem('seeded','1');
    }}""")
    page.goto(url, wait_until='load')
    assert '확인할 입금 17,000원' in page.inner_text('#ggMonth')
    assert page.evaluate('effectiveBudget()-totSpent()') == 500000
    page.locator('#ggMonth button').click()
    notice = page.locator('.nt-item').filter(has_text='확인할 입금 17,000원')
    assert '예산에서 제외' in notice.inner_text()
    shot_dir = Path(os.environ['SHOTS'])
    shot_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(shot_dir / 'income-confirm.png'))

    # 저장 실패 시 메모리도 되돌려 미반영 상태와 확인 알림 유지.
    page.evaluate("""() => { window.realSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='mp_v6')throw new Error('full');return window.realSetItem.call(this,k,v)}; }""")
    notice.get_by_role('button', name='새로 받은 돈', exact=True).click()
    assert page.evaluate('cycleIncome()') == 0
    assert '확인할 입금 17,000원' in page.inner_text('#ggMonth')
    page.evaluate('() => { Storage.prototype.setItem=window.realSetItem; }')

    page.locator('#ggMonth button').click()
    notice.get_by_role('button', name='새로 받은 돈', exact=True).click()
    assert page.evaluate('effectiveBudget()-totSpent()') == 517000
    assert '확인할 입금' not in page.inner_text('#ggMonth')
    assert page.evaluate("JSON.parse(localStorage.getItem('mp_v6')).txOverrides[1].transfer") is False
    page.reload(wait_until='load')
    assert page.evaluate('cycleIncome()') == 17000
    assert not page.evaluate("computeNotices().some(n=>n.id==='ownin-1')")

    # 선택을 바꾸는 UI: 내 계좌 이동 ↔ 새로 받은 돈.
    page.evaluate('openTxSheet(1)')
    page.locator('#txmMove').click()
    assert page.evaluate('cycleIncome()') == 0
    page.evaluate('openTxSheet(1)')
    assert page.inner_text('#txmMove') == '새로 받은 돈으로'
    page.locator('#txmMove').click()
    assert page.evaluate('cycleIncome()') == 17000

    # 거래 목록에서 직접 확인하는 경로.
    page.evaluate('S.txOverrides={};save();render();showTab("capture");openTxSheet(1)')
    assert page.inner_text('#txmIncome') == '새로 받은 돈'
    page.locator('#txmIncome').click()
    assert page.evaluate('cycleIncome()') == 17000

    # 상세창을 연 뒤 대응 출금이 오면, 옛 '내 계좌 이동' 버튼으로 수입이 되지 않는다.
    page.evaluate('S.txOverrides={};save();render();openTxSheet(1)')
    page.evaluate("TX.rows=[...TX.rows,{...TX.rows[0],id:2,bank:'kb',type:'out',balance:100000,at:'2026-10-03T21:08:00+09:00'}]")
    page.locator('#txmMove').click()
    assert page.evaluate('cycleIncome()') == 0
    assert page.evaluate('txWithFlags().every(r=>r.isTransfer)')
    assert not page.evaluate('!!S.txOverrides[1]')
    assert not errors, errors
    browser.close()
print('통과: 미확인 표시·새 수입·이동·저장 실패 복원·재로딩·거래 상세 선택, 브라우저 오류 0')
