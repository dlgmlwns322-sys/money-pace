"""가짜 거래로 지난 월급 주기 내역이 30건 제한 없이 보이는지 확인."""
import json
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

url = (Path(__file__).resolve().parents[2] / 'index.html').as_uri()
seed = {'budget': 1000000, 'budgetStart': '2026-10-23', 'budgetEnd': '2026-11-24',
        'txSince': '2026-09-29', 'txReadSecret': 'fake-local-only', 'balances': {},
        'fixed': [], 'captures': [], 'memos': {},
        'spentAdjust': {'date': '2026-09-23', 'amount': 120000, 'note': '직접 기록'},
        'cycles': [{'start': '2026-09-23', 'end': '2026-10-22', 'spent': 155000}]}
rows = [
    {'id': i, 'bank': 'kb', 'type': 'out', 'amount': 1000, 'balance': 100000 - i * 1000,
     'counterparty': f'지난가게{i}', 'method': '카드', 'at': f'2026-10-20T12:{i:02d}:00+09:00'}
    for i in range(1, 36)
]
rows.append({'id': 36, 'bank': 'kb', 'type': 'out', 'amount': 2000, 'balance': 63000,
             'counterparty': '오늘가게', 'method': '카드', 'at': '2026-10-23T12:00:00+09:00'})
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge')
    page = browser.new_page(viewport={'width': 390, 'height': 844}, locale='ko-KR')
    page.clock.install(time=datetime.fromisoformat('2026-10-23T14:00:00+09:00'))
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(f"""localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});
      localStorage.setItem('mp_tx', JSON.stringify({{rows:{json.dumps(rows)},maxId:36,
        lastFull:Date.now(),lastFetch:Date.now(),lastOk:Date.now()}}));""")
    page.goto(url, wait_until='load')
    page.evaluate("showTab('capture')")
    assert page.locator('#txList .tx-row').count() == 1, '이번 주기만 기본 표시'
    page.get_by_role('button', name='지난 주기').click()
    assert page.locator('#txList .tx-row[onclick]').count() == 35, '지난 주기 거래 30건 초과도 전부 표시'
    assert '09/23~10/22' in page.inner_text('#txPeriodInfo')
    assert '155,000원' in page.inner_text('#txPeriodInfo')
    assert '120,000원' in page.inner_text('#txList'), '알림 연결 전 직접 기록도 표시'
    assert '직접 기록' in page.locator('#txList .tx-row').last.inner_text(), '오래된 직접 기록은 목록 끝'
    assert '오늘가게' not in page.inner_text('#txList')
    page.reload(wait_until='load')
    page.evaluate("showTab('capture')")
    page.get_by_role('button', name='지난 주기').click()
    assert page.locator('#txList .tx-row[onclick]').count() == 35
    assert not errors, errors
    browser.close()
print('통과: 현재·지난 주기 전환, 35건 전체, 직접 기록, 날짜·총액, 새로고침')
