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
        p.evaluate("S.weeklyBudget=123000;save()"); p.wait_for_timeout(5000)
        n1 = len(reqs)
        check('402 상태: 시작 1회 + 저장 1회만 요청', n0 == 1 and n1 - n0 <= 1, f'(시작 {n0}, 저장 후 +{n1-n0})')
        badge = p.evaluate("document.getElementById('syncBadge').textContent")
        check('402 상태: 동기화 실패 표시, 앱은 계속 동작', '실패' in badge and p.evaluate("S.weeklyBudget") == 123000, badge)
        check('402 상태: 페이지 오류 없음', not errs, str(errs))
        b.close()

        # ② 캡처 없음(잔액은 은행 알림으로만, 2026-09-26): 업로드·이미지 인식·공유 받기가 없고, 홈은 버튼 없이 막대 3개
        vision_calls = []
        b, p, errs, reqs = page_with(pw, {**base, "supabaseUrl": "", "supabaseKey": ""})
        p.on('request', lambda r: vision_calls.append(r.url) if 'vision.googleapis' in r.url else None)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
        ui = p.evaluate("""({up:!!document.getElementById('imgInp'),vis:!!document.getElementById('sVision'),seg:!!document.getElementById('homeSeg'),
          gauges:['ggToday','ggWeek','ggMonth'].map(id=>document.getElementById(id).innerText.split('\\n')[0]),
          nav:document.querySelector('#nav-capture .nl').textContent,acc:!!document.getElementById('accBal'),
          fns:['handleCap','autoProcessSharedImage','checkSharedImage','commitBalances'].filter(f=>typeof window[f]==='function')})""")
        check('캡처 업로드·Vision 키·세그먼트 버튼 없음', not ui['up'] and not ui['vis'] and not ui['seg'] and not ui['fns'], json.dumps(ui, ensure_ascii=False))
        check('홈: 오늘·이번 주·이번 달 막대가 한 화면에', ui['gauges'] == ['오늘', '이번 주', '이번 달'], json.dumps(ui['gauges'], ensure_ascii=False))
        check('탭 이름 "거래" + 계좌 잔액 카드', ui['nav'] == '거래' and ui['acc'])
        man = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'manifest.json'), encoding='utf-8'))
        check('공유 받기(share_target) 제거, 이미지 인식 호출 없음', 'share_target' not in man and not vision_calls)
        ui2 = p.evaluate("""({tabs:[...document.querySelectorAll('.nb .nl')].map(e=>e.textContent),
          gone:['sBudget','sWeekly','sStart','sEnd','sAlarm','sClaude','tab-add','tab-ai','memoModal','heroTotal'].filter(id=>document.getElementById(id)),
          cta:!!document.querySelector('.cta2'),payer:document.getElementById('sPayer').value,payday:document.getElementById('sPayDay').value,
          kw:!!document.getElementById('fxKw')})""")
        check('탭은 홈·거래·고정지출·설정 4개', ui2['tabs'] == ['홈', '거래', '고정지출', '설정'], json.dumps(ui2['tabs'], ensure_ascii=False))
        check('예산·알림·Gemini 설정, 지출·AI 탭, 한 번에 기록 버튼, 숨긴 옛 카드 없음', not ui2['gone'] and not ui2['cta'], str(ui2['gone']))
        check('월급 설정(기본 오피엠에스·25일) + 고정지출 알림 이름 칸', ui2['payer'] == '오피엠에스' and ui2['payday'] == '25' and ui2['kw'], json.dumps(ui2, ensure_ascii=False))
        # 설정 링크(#setup=): 한 번 열면 연결 값 저장, 주소창에서 지움, 연결 입력칸은 화면에 없음
        import base64
        cfg = base64.urlsafe_b64encode(json.dumps({"u": "https://abc.supabase.co/", "k": "anon-x", "t": "read-y", "n": "홍길동"}, ensure_ascii=False).encode()).decode().rstrip('=')
        p.goto(URL + '#setup=' + cfg, wait_until='load'); p.wait_for_timeout(800)  # 열린 창에서 링크를 열면 # 뒤만 바뀜 → hashchange로 적용(새로 읽기는 이 테스트의 초기화 스크립트가 저장소를 덮어서 쓰지 않음)
        st = p.evaluate("({u:S.supabaseUrl,k:S.supabaseKey,t:S.txReadSecret,n:S.ownerNames,hash:location.hash,inputs:['sSbUrl','sSbKey','sTxKey','sOwner','connToggle'].filter(id=>document.getElementById(id))})")
        check('설정 링크: 값 저장·주소창에서 지움·연결 입력칸 없음', st['u'] == 'https://abc.supabase.co' and st['k'] == 'anon-x' and st['t'] == 'read-y' and st['n'] == '홍길동' and st['hash'] == '' and not st['inputs'], json.dumps(st, ensure_ascii=False))
        # 잘못된 링크(숫자 주소)·주소만 있는 링크는 거부하고 기존 연결 유지(Codex 2회차)
        for bad in ({"u": 123, "k": "x"}, {"u": "https://evil.supabase.co"}, {"u": "https://evil.example.com", "k": "x"}):
            b64 = base64.urlsafe_b64encode(json.dumps(bad).encode()).decode().rstrip('=')
            p.goto(URL + '#setup=' + b64, wait_until='load'); p.reload(wait_until='load'); p.wait_for_timeout(500)
            kept = p.evaluate("[S.supabaseUrl,S.supabaseKey,S.txReadSecret]")
            check(f'잘못된 설정 링크 거부(아무것도 저장 안 함) {list(bad)}', kept == ['', '', ''] and not errs, str(kept))  # 새로 열 때마다 시험용 초기값(빈 연결)
        check('캡처 없음 화면: 페이지 오류 없음', not errs, str(errs))
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
        bk = p.evaluate("(()=>{const n=computeNotices().find(x=>x.id.startsWith('bk-'));return n?{t:n.title,a:n.acts.map(x=>x.t)}:null})()")
        check('백업이 생기면 벨에 되돌리기 버튼(설정 화면엔 백업 줄 없음)', bk and bk['a'] == ['되돌리기'] and not p.evaluate("!!document.getElementById('backupInfo')"), json.dumps(bk, ensure_ascii=False))
        p.screenshot(path=os.path.expanduser('~/orca-work/shots/mp_settings.png'), full_page=True)
        check('첫 동기화 흐름: 페이지 오류 없음', not errs, str(errs))
        b.close()
finally:
    srv.terminate()
print('\n결과:', sum(1 for r in results if r[1]), '/', len(results), '통과')
