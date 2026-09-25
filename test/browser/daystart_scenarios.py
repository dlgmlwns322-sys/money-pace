# 가계부 하루 = 새벽 6시 시작. 브라우저 시계를 새벽으로 고정해 확인. 실행: python test/browser/daystart_scenarios.py
import subprocess, sys, time, os, json
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
root = os.path.expanduser('~/claude-vault')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8799', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
URL = 'http://127.0.0.1:8799/%EB%A8%B8%EB%8B%88%ED%8E%98%EC%9D%B4%EC%8A%A4/index.html'
SB = 'https://fake-proj.supabase.co'
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS' if cond else 'FAIL'), '-', name, extra)
rows = [
    {"id": 1, "bank": "kb", "type": "out", "amount": 1, "balance": 1000000, "counterparty": "가게", "method": "체크카드", "at": "2026-09-21T12:00:00+09:00", "needs_review": False},
    {"id": 2, "bank": "kakao", "type": "out", "amount": 1, "balance": 500000, "counterparty": "가게", "method": "출금", "at": "2026-09-21T12:10:00+09:00", "needs_review": False},
    {"id": 3, "bank": "kb", "type": "out", "amount": 50000, "balance": 950000, "counterparty": "술집", "method": "체크카드", "at": "2026-09-23T23:00:00+09:00", "needs_review": False},
    {"id": 4, "bank": "kb", "type": "out", "amount": 50000, "balance": 900000, "counterparty": "편의점", "method": "체크카드", "at": "2026-09-24T03:00:00+09:00", "needs_review": False},
]
seed = {"budget": 1000000, "weeklyBudget": 250000, "budgetStart": "2026-09-20", "budgetEnd": "2026-10-19",
        "balances": {"kakao": 1, "kb": 1}, "captures": [{"id": "old", "date": "2026-09-22", "time": "오전 2:15", "balances": {"kakao": 500000, "kb": 1000000}, "source": "manual"}],
        "fixed": [], "memos": {}, "supabaseUrl": SB, "supabaseKey": "anon", "txReadSecret": "READKEY", "ownerNames": "홍길동"}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.clock.install(time=datetime.fromisoformat('2026-09-24T03:30:00+09:00'))
        p.add_init_script(f"localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));")
        def sb(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                q = parse_qs(urlparse(u).query)
                if q.get('status') == ['1']:
                    return route.fulfill(status=200, content_type='application/json', body='{"heartbeatAt":"2026-09-24T02:00:00+09:00","unparsed":{"count":0,"newest":null},"lastTx":{}}', headers={'Access-Control-Allow-Origin': '*'})
                after = int(q.get('after', ['0'])[0])
                out = [r for r in rows if r['id'] > after] if 'after' in q else rows
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(out), headers={'Access-Control-Allow-Origin': '*'})
            if 'select=rev' in u:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        p.route(SB + '/**', sb)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(2500)
        check('새벽 3:30의 오늘 = 23일', p.evaluate("toStr()") == '2026-09-23', p.evaluate("toStr()"))
        sp = p.evaluate("getDailySpent(toStr())")
        check('오늘(23일) 지출 = 밤 11시 5만 + 새벽 3시 5만', sp and sp.get('spent') == 100000, json.dumps(sp, ensure_ascii=False))
        mig = p.evaluate("S.captures.find(c=>c.id==='old').date")
        check('예전 캡처는 옮기지 않음(다른 기기·옛 버전과 어긋나지 않게)', mig == '2026-09-22', mig)
        p.evaluate("showTab('capture')"); p.wait_for_timeout(300)
        first = p.evaluate("document.querySelector('#txList .tx-row .tx-sub').innerText")
        check('새벽 거래 표시: 23일 · 24일 새벽 03:00', first.startswith('09-23 · 24일 새벽 03:00'), first)
        # 6시가 지나면 24일, 지출 0원
        p.clock.set_fixed_time(datetime.fromisoformat('2026-09-24T06:05:00+09:00'))
        check('6:05의 오늘 = 24일', p.evaluate("toStr()") == '2026-09-24')
        sp2 = p.evaluate("getDailySpent(toStr())")
        check('24일 지출 0원(새벽 결제는 23일에)', sp2 and sp2.get('spent') == 0, json.dumps(sp2, ensure_ascii=False))
        p.evaluate("showTab('home');render()"); p.wait_for_timeout(300)
        p.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'daystart_home.png'))
        check('JS 오류 없음', not errs, str(errs))
        b.close()
finally:
    srv.terminate()
print(f"\n{sum(results)}/{len(results)} 통과")
sys.exit(0 if all(results) else 1)
