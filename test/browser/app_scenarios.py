import subprocess, sys, time, os, json
from playwright.sync_api import sync_playwright
root = os.path.expanduser('~/claude-vault')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8799', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
URL = 'http://127.0.0.1:8799/%EB%A8%B8%EB%8B%88%ED%8E%98%EC%9D%B4%EC%8A%A4/index.html'
SB = 'https://fake-proj.supabase.co'
base = {"budget": 1000000, "weeklyBudget": 250000, "budgetStart": "2026-09-25", "budgetEnd": "2026-10-24",
        "balances": {"kakao": 300000, "kb": 200000},
        "captures": [{"id": "1790000000000", "date": "2026-09-24", "time": "오후 9:00", "thumb": None, "balances": {"kakao": 310000, "kb": 200000}}],
        "fixed": [], "memos": {}, "visionKey": "VKEY", "supabaseUrl": SB, "supabaseKey": "anon"}
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS' if cond else 'FAIL'), '-', name, extra)

def page_with(pw, seed, sync=None, sb_handler=None, vision_text=None):
    b = pw.chromium.launch(channel='msedge'); p = b.new_page(viewport={'width': 420, 'height': 900}, locale='ko-KR')
    errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    reqs = []
    init = f"localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});"
    if sync is not None: init += f"localStorage.setItem('mp_sync', {json.dumps(json.dumps(sync))});"
    p.add_init_script(init)
    def sb_route(route):
        reqs.append((route.request.method, route.request.url))
        if sb_handler: return sb_handler(route)
        route.fulfill(status=402, body='{"message":"quota"}', content_type='application/json')
    p.route(SB + '/**', sb_route)
    def vision_route(route):
        route.fulfill(status=200, content_type='application/json', body=json.dumps({"responses": [{"fullTextAnnotation": {"text": vision_text or ''}}]}))
    p.route('https://vision.googleapis.com/**', vision_route)
    return b, p, errs, reqs

try:
    with sync_playwright() as pw:
        # ① Supabase 한도 초과(402): 요청이 폭주하지 않는다
        b, p, errs, reqs = page_with(pw, base, sync={"rev": 3, "seq": 5, "sentSeq": 5})
        p.goto(URL, wait_until='load'); p.wait_for_timeout(1200)
        n0 = len(reqs)
        p.evaluate("showTab('capture'); showManual();"); p.click('#applyBtn'); p.wait_for_timeout(5000)
        n1 = len(reqs)
        check('402 상태: 시작 1회 + 저장 1회만 요청', n0 == 1 and n1 - n0 <= 1, f'(시작 {n0}, 저장 후 +{n1-n0})')
        badge = p.evaluate("document.getElementById('syncBadge').textContent")
        check('402 상태: 동기화 실패 표시, 앱은 계속 동작', '실패' in badge and p.evaluate("S.captures.length") == 2, badge)
        check('402 상태: 페이지 오류 없음', not errs, str(errs))
        b.close()

        # ② 공유 캡처 자동 처리: 두 계좌 다 읽으면 바로 반영
        text_ok = "\n".join(["1,000원", "9월에 쓴 돈", "입출금통장", "123,456원", "KB국민 우대통장", "234,567원"])
        b, p, errs, reqs = page_with(pw, {**base, "supabaseUrl": "", "supabaseKey": ""}, vision_text=text_ok)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
        p.evaluate("autoProcessSharedImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')")
        p.wait_for_timeout(1500)
        r = p.evaluate("({n:S.captures.length,b:S.captures[0].balances,src:S.captures[0].source,bal:S.balances})")
        check('공유(둘 다 읽음): 자동 반영 + 캡처 기록', r['n'] == 2 and r['b'] == {'kakao': 123456, 'kb': 234567} and r['src'] == 'ocr', json.dumps(r, ensure_ascii=False))
        b.close()

        # ② 한 계좌 못 읽음: 자동 반영하지 않고 확인 화면(지난 잔액 표시)
        text_miss = "입출금통장\n123,456원\n광고 문구"
        b, p, errs, reqs = page_with(pw, {**base, "supabaseUrl": "", "supabaseKey": ""}, vision_text=text_miss)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
        p.evaluate("autoProcessSharedImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')")
        p.wait_for_timeout(1500)
        n_before = p.evaluate("S.captures.length")
        rows = p.evaluate("[...document.querySelectorAll('.ocr-row')].map(r=>r.innerText.replace(/\\n/g,' '))")
        check('공유(한 계좌 못 읽음): 자동 반영 안 함', n_before == 1, str(n_before))
        check('확인 화면: 국민은행에 지난 잔액·못 읽음 표시', any('국민' in x and '못 읽음' in x for x in rows), str(rows))
        p.click('#applyBtn'); p.wait_for_timeout(500)
        r = p.evaluate("S.captures[0].balances")
        check('확인 후 반영: 국민은 지난 잔액(0원 아님)', r == {'kakao': 123456, 'kb': 200000}, str(r))
        p.screenshot(path=os.path.expanduser('~/orca-work/shots/mp_confirm.png'))
        b.close()

        # ③ 새 동기화 첫 실행: 사용자에게 묻고, [확인]이면 이 기기 것을 rev 없는 행에 조건부로 올림
        state = {"patch": None, "dialogs": []}
        cloud = {"budget": 777, "captures": [{"id": "1780000000000", "date": "2026-09-01", "time": "오후 1:00", "balances": {"kakao": 1, "kb": 1}}]}
        def sb_first(route):
            req = route.request
            if req.method == 'GET' and 'select=rev' in req.url:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": None}]))
            if req.method == 'GET':
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"data": cloud}]))
            if req.method == 'PATCH':
                state['patch'] = (req.url, json.loads(req.post_data))
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"id": "my_money_data"}]))
            route.fulfill(status=500, body='x')
        b, p, errs, reqs = page_with(pw, base, sync=None, sb_handler=sb_first)
        p.on('dialog', lambda d: (state['dialogs'].append(d.message), d.accept()))
        p.goto(URL, wait_until='load'); p.wait_for_timeout(2500)
        check('첫 동기화: 한 번 물어봄', len(state['dialogs']) == 1 and '동기화 방식이 바뀌어' in state['dialogs'][0])
        pu = state['patch']
        check('첫 동기화 [확인]: rev 없는 행에만 조건부 갱신, rev 1', pu and 'data-%3E%3Erev=is.null' in pu[0].replace('->>', '-%3E%3E') and pu[1]['data']['rev'] == 1, pu[0] if pu else 'no patch')
        check('첫 동기화: 캡처 사진은 올리지 않음', pu and all('thumb' not in c for c in pu[1]['data']['captures']))
        bk = p.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('mp_v6_backup_'))")
        check('첫 동기화: 양쪽 백업 존재', any('_cloud_' in k for k in bk) and any('_cloud_' not in k for k in bk), str(bk))
        # ④ 설정: 백업 되돌리기 표시
        p.evaluate("showTab('settings')"); p.wait_for_timeout(300)
        info = p.evaluate("document.getElementById('backupInfo').textContent")
        check('설정: 백업 개수 표시', '백업 2개' in info, info)
        p.screenshot(path=os.path.expanduser('~/orca-work/shots/mp_settings.png'), full_page=True)
        check('첫 동기화 흐름: 페이지 오류 없음', not errs, str(errs))
        b.close()
finally:
    srv.terminate()
print('\n결과:', sum(1 for r in results if r[1]), '/', len(results), '통과')
