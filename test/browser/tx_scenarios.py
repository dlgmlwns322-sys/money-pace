import subprocess, sys, time, os, json
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
    {"id": 1, "bank": "kb", "type": "in", "amount": 2500000, "balance": 2795000, "counterparty": "회사", "method": "급여", "at": "2026-09-21T09:00:00+09:00", "needs_review": False},
    {"id": 2, "bank": "kb", "type": "out", "amount": 300000, "balance": 2495000, "counterparty": "토스홍길동", "method": "오픈뱅킹출금", "at": "2026-09-21T13:00:00+09:00", "needs_review": False},
    {"id": 3, "bank": "kakao", "type": "in", "amount": 300000, "balance": 600000, "counterparty": "홍길동", "method": "입금", "at": "2026-09-21T13:02:00+09:00", "needs_review": False},
    {"id": 4, "bank": "kakao", "type": "out", "amount": 4500, "balance": 595500, "counterparty": "스타벅스", "method": "출금", "at": "2026-09-24T08:10:00+09:00", "needs_review": False},
    {"id": 5, "bank": "kb", "type": "out", "amount": 7000, "balance": 2488000, "counterparty": "모르는가게", "method": "체크카드", "at": "2026-09-24T19:00:00+09:00", "needs_review": True},
]
seed = {"budget": 1000000, "weeklyBudget": 250000, "budgetStart": "2026-09-25", "budgetEnd": "2026-10-24",
        "balances": {"kakao": 1, "kb": 1}, "balanceAt": {"kakao": "2026-09-20T00:00:00Z", "kb": "2026-09-20T00:00:00Z"},
        "captures": [], "fixed": [], "memos": {}, "supabaseUrl": SB, "supabaseKey": "anon", "txReadSecret": "READKEY", "ownerNames": "홍길동"}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(viewport={'width': 420, 'height': 900}, locale='ko-KR')
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        calls = {'read': [], 'rest': 0}
        p.add_init_script(f"localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));")
        def sb(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                if 'status=1' in u: return route.fulfill(status=200, content_type='application/json', body='{}', headers={'Access-Control-Allow-Origin': '*'})  # 알림센터 상태는 거래 읽기와 별개
                if 'hints=1' in u: return route.fulfill(status=200, content_type='application/json', body='[]', headers={'Access-Control-Allow-Origin': '*'})  # KB Pay 가게 이름 힌트도 별개
                if route.request.headers.get('x-read-secret') != 'READKEY':
                    calls['read'].append(u)  # 키가 틀리면 거래 요청에서 멈추므로 상태 요청은 가지 않는다
                    return route.fulfill(status=401, body='unauthorized')
                q = parse_qs(urlparse(u).query)
                calls['read'].append(u)
                after = int(q.get('after', ['0'])[0])
                out = [r for r in rows if r['id'] > after] if 'after' in q else rows
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(out), headers={'Access-Control-Allow-Origin': '*'})
            calls['rest'] += 1
            if 'select=rev' in u:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        p.route(SB + '/**', sb)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(2000)
        st = p.evaluate("({since:S.txSince,bal:S.balances,balAt:S.balanceAt,n:TX.rows.length})")
        check('거래 받음 + 시작일은 첫 거래 다음 날', st['n'] == 5 and st['since'] == '2026-09-22', json.dumps(st, ensure_ascii=False))
        check('잔액 자동 반영(계좌별 최신 거래 잔액)', st['bal']['kakao'] == 595500 and st['bal']['kb'] == 2488000)
        check('처음은 최근 7일 전체로 읽음(since)', calls['read'] and 'since=' in calls['read'][0], calls['read'][0] if calls['read'] else '')
        # 9/24(오늘이 아닌 과거일 확인): 4,500 + 7,000 = 11,500 / 내 계좌 이동 300,000은 9/21(txSince 전)이라 계산 밖
        sp = p.evaluate("sumSpentInRange('2026-09-24','2026-09-24')")
        check('9/24 지출 = 스타벅스 4,500 + 가게 7,000', sp == 11500, str(sp))
        p.evaluate("showTab('capture')"); p.wait_for_timeout(300)
        items = p.evaluate("[...document.querySelectorAll('#txList .tx-row')].map(r=>r.innerText.replace(/\\n/g,' '))")
        check('거래 목록 표시(최신부터, 태그)', len(items) == 5 and '모르는가게' in items[0] and '확인 필요' in items[0] and '내 계좌 이동' in ' '.join(items), str(items[:3]))
        p.screenshot(path=os.path.expanduser('~/orca-work/shots/mp_tx.png'))
        # 눌러서 이동으로 지정 → 9/24 지출에서 빠짐
        p.on('dialog', lambda d: d.accept())
        p.click('#txList .tx-row >> nth=0'); p.wait_for_timeout(200); p.click('#txmMove'); p.wait_for_timeout(300)  # 거래 누르면 카테고리 창 → '내 계좌 이동으로'
        sp2 = p.evaluate("sumSpentInRange('2026-09-24','2026-09-24')")
        ov = p.evaluate("S.txOverrides")
        check('눌러서 내 계좌 이동으로 지정 → 지출에서 빠짐', sp2 == 4500 and ov.get('5', {}).get('transfer') is True, f'{sp2} {ov}')
        # 화면 복귀 시 증분(after=최대id−20) 한 번만
        n_before = len(calls['read'])
        p.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); p.wait_for_timeout(800)
        check('1분 안 화면 복귀: 요청 안 함(전송량 절약)', len(calls['read']) == n_before, str(calls['read'][n_before:]))
        p.evaluate("TX.lastFetch=Date.now()-61000"); p.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); p.wait_for_timeout(800)
        new = calls['read'][n_before:]
        check('1분 뒤 화면 복귀: 새 거래만(after=최대id−3) 1회', len(new) == 1 and 'after=2' in new[0], str(new))
        check('페이지 오류 없음', not errs, str(errs))
        b.close()

        # DB가 돌려주는 UTC 형식(+00:00) + 자정 경계: 23:59(KST)와 00:01(KST)이 제 날짜로 들어가는지
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(locale='ko-KR')
        utc_rows = [
            {"id": 11, "bank": "kb", "type": "out", "amount": 1000, "balance": 99000, "counterparty": "밤가게", "method": "체크카드", "at": "2026-09-24T14:59:00+00:00", "needs_review": False},
            {"id": 12, "bank": "kakao", "type": "out", "amount": 2000, "balance": 98000, "counterparty": "새벽가게", "method": "출금", "at": "2026-09-24T15:01:00+00:00", "needs_review": False},
            {"id": 13, "bank": "kb", "type": "out", "amount": 500, "balance": 98500, "counterparty": "월말", "method": "체크카드", "at": "2026-09-30T14:30:00+00:00", "needs_review": False},
            {"id": 14, "bank": "kakao", "type": "out", "amount": 300, "balance": 97700, "counterparty": "아침", "method": "출금", "at": "2026-09-24T21:01:00+00:00", "needs_review": False},
        ]
        seed2 = {**seed, "txSince": "2026-09-20", "balanceAt": {}}
        p.add_init_script(f"localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed2))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));")
        def sb2(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                if 'status=1' in u: return route.fulfill(status=200, content_type='application/json', body='{}', headers={'Access-Control-Allow-Origin': '*'})  # 알림센터 상태는 거래 읽기와 별개
                if 'hints=1' in u: return route.fulfill(status=200, content_type='application/json', body='[]', headers={'Access-Control-Allow-Origin': '*'})  # KB Pay 가게 이름 힌트도 별개
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(utc_rows), headers={'Access-Control-Allow-Origin': '*'})
            if 'select=rev' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        p.route(SB + '/**', sb2)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(1800)
        r = p.evaluate("({d24:sumSpentInRange('2026-09-24','2026-09-24'),d25:sumSpentInRange('2026-09-25','2026-09-25'),d30:sumSpentInRange('2026-09-30','2026-09-30'),dates:TX.rows.map(x=>txDate(x.at)+' '+txTime(x.at))})")
        # 가계부 하루는 새벽 6시 시작: 25일 00:01 결제는 24일, 25일 06:01부터 25일
        check('UTC 형식·새벽 6시 경계: 24일 23:59·25일 00:01→9/24, 25일 06:01→9/25, 30일 23:30→9/30', r['d24'] == 3000 and r['d25'] == 300 and r['d30'] == 500, json.dumps(r, ensure_ascii=False))
        b.close()

        # ① 501건: 앱이 500건씩 끝까지 이어 읽기(첫 복구 since, 다음 쪽 since+after)
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(locale='ko-KR')
        many = [{"id": i, "bank": "kb" if i % 2 else "kakao", "type": "out", "amount": 10, "balance": 10000000 - i * 10, "counterparty": "가게", "method": "체크카드",
                 "at": "2026-09-26T0%d:%02d:00+09:00" % (1 + i // 60 % 8, i % 60), "needs_review": False} for i in range(1, 502)]
        pages = []
        def sb3(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                if 'status=1' in u: return route.fulfill(status=200, content_type='application/json', body='{}', headers={'Access-Control-Allow-Origin': '*'})  # 알림센터 상태는 거래 읽기와 별개
                if 'hints=1' in u: return route.fulfill(status=200, content_type='application/json', body='[]', headers={'Access-Control-Allow-Origin': '*'})  # KB Pay 가게 이름 힌트도 별개
                q = parse_qs(urlparse(u).query); after = int(q.get('after', ['0'])[0]); pages.append(u)
                part = [r for r in many if r['id'] > after][:500]
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(part), headers={'Access-Control-Allow-Origin': '*'})
            if 'select=rev' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        p.add_init_script(f"localStorage.setItem('mp_v6', {json.dumps(json.dumps({**seed, 'balanceAt': {}}))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));")
        p.route(SB + '/**', sb3)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(2500)
        n = p.evaluate("TX.rows.length")
        check('① 501건을 두 쪽(500+1)으로 끝까지 읽음', n == 501 and len(pages) == 2 and 'since=' in pages[1] and 'after=500' in pages[1], f'{n}건, {len(pages)}쪽 {pages[-1] if pages else ""}')
        b.close()

        # 다시 받을 범위: 오랜 공백(마지막 확인 10일 전) / 불완전 주기 / 1만 건 상한 도달은 미완료
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(locale='ko-KR')
        seen = []; mode = {'full500': False}
        def sb4(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                if 'status=1' in u: return route.fulfill(status=200, content_type='application/json', body='{}', headers={'Access-Control-Allow-Origin': '*'})  # 알림센터 상태는 거래 읽기와 별개
                if 'hints=1' in u: return route.fulfill(status=200, content_type='application/json', body='[]', headers={'Access-Control-Allow-Origin': '*'})  # KB Pay 가게 이름 힌트도 별개
                seen.append(u)
                if mode['full500']:
                    q = parse_qs(urlparse(u).query); after = int(q.get('after', ['0'])[0])
                    part = [{"id": after + i + 1, "bank": "kb", "type": "out", "amount": 1, "balance": 1, "counterparty": "x", "method": "m", "at": "2026-09-26T01:00:00+09:00", "needs_review": False} for i in range(500)]
                    return route.fulfill(status=200, content_type='application/json', body=json.dumps(part), headers={'Access-Control-Allow-Origin': '*'})
                return route.fulfill(status=200, content_type='application/json', body='[]', headers={'Access-Control-Allow-Origin': '*'})
            if 'select=rev' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        tx_cache = {"rows": [{"id": 1, "bank": "kb", "type": "out", "amount": 1, "balance": 1, "at": "2026-09-01T01:00:00+09:00"}], "maxId": 1}
        p.add_init_script(f"localStorage.setItem('mp_v6', {json.dumps(json.dumps({**seed, 'balanceAt': {}, 'cycles': [{'start': '2026-08-25', 'end': '2026-09-24', 'spent': 0, 'incomplete': True}]}))});"
                          f"localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));"
                          f"localStorage.setItem('mp_tx', JSON.stringify(Object.assign({json.dumps(tx_cache)}, {{lastFull: Date.now()-10*86400e3}})));")
        p.route(SB + '/**', sb4)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(2000)
        from urllib.parse import unquote
        since = unquote(parse_qs(urlparse(seen[0]).query).get('since', [''])[0]) if seen else ''
        inc = p.evaluate("S.cycles[S.cycles.length-1].incomplete")
        check('불완전 주기(8/25~)가 있으면 그 시작 전날(8/24 KST)부터 다시 받고, 받은 뒤 확정', since.startswith('2026-08-23T15:00') and inc is None, f'since={since} incomplete={inc}')
        mode['full500'] = True
        r = p.evaluate("(async()=>{TX.lastFetch=0;TX.lastFull=0;const ok=await fetchTx();return{ok,err:TX.error,n:TX.rows.length}})()")
        check('20쪽(1만 건)을 다 채우면 미완료로 처리(성공 아님, 안내)', r['ok'] is False and '일부만' in (r['err'] or ''), json.dumps(r, ensure_ascii=False))
        b.close()

        # 읽기 키가 틀리면 안내, 재시도 폭주 없음
        b = pw.chromium.launch(channel='msedge'); p = b.new_page()
        calls = {'read': [], 'rest': 0}
        bad = {**seed, "txReadSecret": "WRONG"}
        p.add_init_script(f"localStorage.setItem('mp_v6', {json.dumps(json.dumps(bad))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));")
        p.route(SB + '/**', sb)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(3000)
        p.evaluate("showTab('capture')"); p.wait_for_timeout(200)
        msg = p.evaluate("document.getElementById('txStatus').textContent")
        check('읽기 키 틀림: 안내 문구, 요청 1회', '읽기 키가 맞지 않아요' in msg and len(calls['read']) == 1, f'{msg} / {len(calls["read"])}회')
        b.close()
finally:
    srv.terminate()
print('\n결과:', sum(results), '/', len(results), '통과')
