# 마감 주기 재계산: 납부 체크 → 불완전 표시 → 그 주기 범위를 서버에서 끝까지 다시 받은 뒤에만 확정.
# 거래를 받는 도중에 체크해도(경합) 끝난 뒤 한 번 더 받아서 확정되는지. 실행: python test/browser/recompute_scenarios.py
import subprocess, sys, time, os, json, threading
from datetime import datetime
from urllib.parse import urlparse, parse_qs, unquote
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
    {"id": 1, "bank": "kb", "type": "out", "amount": 1, "balance": 1000000, "counterparty": "가게", "method": "체크카드", "at": "2026-09-20T12:00:00+09:00", "needs_review": False},
    {"id": 2, "bank": "kakao", "type": "out", "amount": 1, "balance": 500000, "counterparty": "가게", "method": "출금", "at": "2026-09-20T12:10:00+09:00", "needs_review": False},
    {"id": 3, "bank": "kb", "type": "out", "amount": 10000, "balance": 990000, "counterparty": "식당", "method": "체크카드", "at": "2026-09-24T19:00:00+09:00", "needs_review": False},
    {"id": 4, "bank": "kb", "type": "out", "amount": 55000, "balance": 935000, "counterparty": "통신사", "method": "자동이체", "at": "2026-09-25T00:30:00+09:00", "needs_review": False},
]
seed = {"budget": 1000000, "weeklyBudget": 250000, "budgetStart": "2026-09-25", "budgetEnd": "2026-10-24", "budgetAnchorDay": 25, "txSince": "2026-09-21",
        "cycles": [{"start": "2026-08-25", "end": "2026-09-24", "spent": 65000, "budget": 1000000}],
        "balances": {"kakao": 1, "kb": 1}, "captures": [], "fixed": [{"id": "f1", "name": "통신", "amount": 55000, "paid": False, "paidDate": ""}],
        "memos": {}, "supabaseUrl": SB, "supabaseKey": "anon", "txReadSecret": "READKEY", "ownerNames": "홍길동"}
state = {'reads': [], 'hold': False, 'held': []}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.clock.install(time=datetime.fromisoformat('2026-09-25T12:00:00+09:00'))
        p.add_init_script(f"if(!sessionStorage.getItem('seeded')){{localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));localStorage.setItem('mp_tx', JSON.stringify({{rows:{json.dumps(rows)},maxId:4,lastFull:Date.now(),lastFetch:Date.now()}}));sessionStorage.setItem('seeded','1');}}")
        def sb(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                q = parse_qs(urlparse(u).query)
                if q.get('status') == ['1']:
                    return route.fulfill(status=200, content_type='application/json', body='{"heartbeatAt":null,"unparsed":{"count":0,"newest":null},"lastTx":{}}', headers={'Access-Control-Allow-Origin': '*'})
                state['reads'].append(unquote(urlparse(u).query))
                if state['hold']:  # 응답을 붙잡아 두어 '받는 중' 상태를 만든다
                    state['held'].append(route); return
                since = q.get('since', [None])[0]
                after = int(q.get('after', ['0'])[0])
                out = [r for r in rows if r['id'] > after]
                h = {'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'x-since-applied'}
                if since: h['x-since-applied'] = since
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(out), headers=h)
            if 'select=rev' in u:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        p.route(SB + '/**', sb)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(1500)
        check('처음: 지난 주기 결산 65,000(자동이체가 일반 지출로 잡힘)', p.evaluate("S.cycles[0].spent") == 65000)
        # 받는 중(느린 응답)에 25일 납부 체크
        state['hold'] = True; state['reads'].clear()
        p.evaluate("TX.lastFetch=0;void refreshAndRoll()"); p.wait_for_timeout(300)
        check('지금 받는 중', p.evaluate("txFetching") is True)
        p.evaluate("toggleFixed('f1')")
        c1 = p.evaluate("S.cycles[0]")
        check('체크 즉시: 기존 결산 보존 + 불완전 표시', c1['spent'] == 65000 and c1.get('incomplete') is True, json.dumps(c1))
        state['hold'] = False
        for r in state['held']: r.fulfill(status=200, content_type='application/json', body=json.dumps(rows[:2]), headers={'Access-Control-Allow-Origin': '*'})  # 이 읽기엔 새 거래 없음(after)
        state['held'].clear()
        p.wait_for_timeout(2500)
        c2 = p.evaluate("S.cycles[0]")
        check('받기 끝난 뒤 한 번 더 받아(주기 시작 전날부터) 확정: 10,000', c2['spent'] == 10000 and not c2.get('incomplete'), json.dumps(c2))
        check('다시 받기는 8/24부터 since 읽기', any('since=2026-08-23T15:00:00' in r for r in state['reads']), str(state['reads']))
        # 서버가 45일로 잘랐다고 알려 주면(기기 시계가 틀린 경우) 그 주기는 확정하지 않음
        def sb_clamped(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u and 'status=1' not in u:
                h = {'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'x-since-applied', 'x-since-applied': '2026-09-01T00:00:00.000Z'}
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows), headers=h)
            return sb(route)
        p.unroute(SB + '/**'); p.route(SB + '/**', sb_clamped)
        p.evaluate("toggleFixed('f1')"); p.wait_for_timeout(1500)  # 체크 해제 → 불완전 → 곧바로 다시 받기(서버는 9/1부터만)
        c3 = p.evaluate("S.cycles[0]")
        check('서버가 실제로 9/1부터만 줬으면 8/25 시작 주기는 확정 안 함', c3.get('incomplete') is True and c3['spent'] == 10000, json.dumps(c3))
        check('JS 오류 없음', not errs, str(errs))
        b.close()
finally:
    srv.terminate()
print(f"\n{sum(results)}/{len(results)} 통과")
sys.exit(0 if all(results) else 1)
