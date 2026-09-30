# 같은 앱을 탭 두 개로 열었을 때(2026-09-30 실제 사고: 읽기 키 없는 옛 탭 + 설정 링크 연 새 탭 → '동기화 실패' 반복)
# - 새 탭이 저장하면 옛 탭은 저장·동기화하지 않고 새로 읽는다(읽기 키를 지우지 않음, 충돌 PATCH 없음)
# - 충돌 백업에는 캡처 사진을 넣지 않는다
# - 월급 아닌 입금: '예산에 더함' 태그, 거래를 눌러 '예산에서 빼기'
import subprocess, sys, time, os, json, base64
from urllib.parse import unquote
from playwright.sync_api import sync_playwright
root = os.path.expanduser('~/claude-vault')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8796', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
URL = 'http://127.0.0.1:8796/%EB%A8%B8%EB%8B%88%ED%8E%98%EC%9D%B4%EC%8A%A4/index.html'
SB = 'https://fake-proj.supabase.co'
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS' if cond else 'FAIL'), '-', name, extra)

rows = [
    {"id": 1, "bank": "kakao", "type": "out", "amount": 1000, "balance": 500000, "counterparty": "가게", "method": "출금", "at": "2026-09-20T12:00:00+09:00", "needs_review": False},
    {"id": 2, "bank": "kb", "type": "out", "amount": 1000, "balance": 900000, "counterparty": "가게", "method": "체크카드출금", "at": "2026-09-20T12:00:00+09:00", "needs_review": False},
    {"id": 3, "bank": "kakao", "type": "in", "amount": 177200, "balance": 677200, "counterparty": "(주)테스트회사", "method": "입금", "at": "2026-09-24T12:22:00+09:00", "needs_review": False},
    {"id": 4, "bank": "kakao", "type": "out", "amount": 200, "balance": 677000, "counterparty": "저금통", "method": "출금", "at": "2026-09-24T13:00:00+09:00", "needs_review": False},
]
thumb = 'data:image/jpeg;base64,' + 'A' * 300000
seed = {"budget": 1000000, "budgetStart": "2026-09-21", "budgetEnd": "2026-10-20", "balances": {"kakao": 1, "kb": 1},
        "captures": [{"id": 1, "date": "2026-09-19", "time": "10:00", "balances": {"kakao": 500000, "kb": 900000}, "thumb": thumb}],
        "fixed": [], "memos": {}, "supabaseUrl": SB, "supabaseKey": "anon", "txReadSecret": "", "ownerNames": ""}
link = base64.urlsafe_b64encode(json.dumps({"u": SB, "k": "anon", "t": "READKEY", "n": "홍길동"}, ensure_ascii=False).encode()).decode().rstrip('=')
cloud = {"rev": 3, "data": {**{k: v for k, v in seed.items() if k not in ('supabaseUrl', 'supabaseKey', 'txReadSecret')}, "captures": [{**seed["captures"][0], "thumb": None}], "rev": 3}}
calls = {'patch_ok': 0, 'patch_conflict': 0}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge'); ctx = b.new_context(viewport={'width': 420, 'height': 900}, locale='ko-KR')
        errs = []
        ctx.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('seeded','1');"
                            f"localStorage.setItem('mp_v6',{json.dumps(json.dumps(seed))});localStorage.setItem('mp_sync',JSON.stringify({{rev:3,seq:1,sentSeq:1}}));"
                            f"localStorage.setItem('mp_v6_backup_1700000000000',{json.dumps(json.dumps(seed))});}}")
        H = {'Access-Control-Allow-Origin': '*'}
        def sb(route):
            u, m = unquote(route.request.url), route.request.method
            if '/functions/v1/tx-read' in u:
                if route.request.headers.get('x-read-secret') != 'READKEY': return route.fulfill(status=401, body='unauthorized', headers=H)
                if 'status=1' in u: return route.fulfill(status=200, content_type='application/json', body='{}', headers=H)
                if 'hints=1' in u: return route.fulfill(status=200, content_type='application/json', body='[]', headers=H)
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows), headers=H)
            if m == 'PATCH':  # 조건부 갱신: data->>rev가 맞을 때만
                want = u.split('data->>rev=eq.')[1].split('&')[0] if 'data->>rev=eq.' in u else None
                if want is not None and str(cloud['rev']) == want:
                    d = json.loads(route.request.post_data)['data']; cloud['data'] = d; cloud['rev'] = d['rev']; calls['patch_ok'] += 1
                    return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
                calls['patch_conflict'] += 1
                return route.fulfill(status=200, content_type='application/json', body='[]')
            if 'select=rev' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": str(cloud['rev'])}]))
            if 'select=data' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"data": cloud['data']}]))
            return route.fulfill(status=200, content_type='application/json', body='[]')
        ctx.route(SB + '/**', sb)
        a = ctx.new_page(); a.on('pageerror', lambda e: errs.append('A:' + str(e)[:200]))
        a.goto(URL); a.wait_for_timeout(1500)
        check('옛 탭 A: 읽기 키 없음', a.evaluate("!S.txReadSecret"))
        slim = a.evaluate("localStorage.getItem('mp_v6_backup_1700000000000')")
        check('예전 사진 포함 백업은 시작할 때 사진을 빼서 작아짐', slim and len(slim) < 20000 and '"thumb":"data:' not in slim, str(len(slim or '')))
        bp = ctx.new_page(); bp.on('pageerror', lambda e: errs.append('B:' + str(e)[:200]))
        bp.goto(URL + '#setup=' + link); bp.wait_for_timeout(2500)
        st = bp.evaluate("({key:!!S.txReadSecret,n:TX.rows.length,own:S.ownerNames})")
        check('새 탭 B: 설정 링크 적용·거래 받음', st['key'] and st['n'] == 4 and st['own'] == '홍길동', json.dumps(st, ensure_ascii=False))
        check('A는 다른 탭 저장을 알아챔(staleTab)', a.evaluate("staleTab"))
        conflicts_before = calls['patch_conflict']
        # A에서 무언가 저장하려 하면 옛 상태로 덮지 않고 새로 읽는다
        a.evaluate("staleTab=false")  # storage 이벤트를 놓친 탭(멈춘 탭·뒤로 가기 캐시) 가정 → 쓰기 표식으로 알아채야 함
        with a.expect_navigation(): a.evaluate("save()")
        a.wait_for_timeout(1500)
        check('이벤트를 놓쳐도 쓰기 표식으로 알아채고 새로 읽음 + 알림', '다른 창에서 바뀐 내용' in a.evaluate("document.getElementById('toast').textContent"))
        check('A 새로 읽은 뒤 읽기 키 있음(덮어서 지우지 않음)', a.evaluate("!!S.txReadSecret&&S.ownerNames==='홍길동'"))
        check('저장소의 읽기 키도 그대로', json.loads(bp.evaluate("localStorage.getItem('mp_v6')")).get('txReadSecret') == 'READKEY')
        check('A가 옛 버전으로 충돌 저장을 보내지 않음', calls['patch_conflict'] == conflicts_before, str(calls))
        check('클라우드에 이름 저장됨', cloud['data'].get('ownerNames') == '홍길동')
        # 충돌 백업에는 사진을 넣지 않는다(사진은 본 데이터에 그대로)
        bp.reload(); bp.wait_for_timeout(1500)  # A가 새로 읽으며 저장했을 수 있어 B도 최신으로
        bk = bp.evaluate("backupLocal('t_')?(()=>{const k=listBackups()[0].k;return {len:localStorage.getItem(k).length,main:localStorage.getItem('mp_v6').includes('AAAA')};})():null")
        check('백업은 사진 없이 작음, 본 데이터엔 사진 그대로', bk and bk['len'] < 20000 and bk['main'], json.dumps(bk))
        # 입금: 예산에 더함 → 거래를 눌러 빼기
        eb0 = bp.evaluate("effectiveBudget()")
        bp.evaluate("showTab('capture')"); bp.wait_for_timeout(300)
        items = bp.evaluate("[...document.querySelectorAll('#txList .tx-row')].map(r=>r.innerText.replace(/\\n/g,' '))")
        inc_row = next((x for x in items if '테스트회사' in x), '')
        piggy_row = next((x for x in items if '저금통' in x), '')
        check('입금에 "예산에 더함" 태그, 저금통은 저축', '예산에 더함' in inc_row and '저축' in piggy_row, str([inc_row, piggy_row]))
        check('쓸 수 있는 돈 = 100만 + 입금 177,200 − 저축 200', eb0 == 1000000 + 177200 - 200, str(eb0))
        bp.evaluate("openTxSheet(3)"); bp.wait_for_timeout(200)
        btn = bp.evaluate("(()=>{const b=document.getElementById('txmIncome');return {vis:!b.classList.contains('hidden'),t:b.textContent};})()")
        check('입금 상세에 "예산에서 빼기" 버튼', btn['vis'] and btn['t'] == '예산에서 빼기', json.dumps(btn, ensure_ascii=False))
        bp.click('#txmIncome'); bp.wait_for_timeout(300)
        check('빼면 쓸 수 있는 돈에서 제외', bp.evaluate("effectiveBudget()") == 1000000 - 200)
        bp.evaluate("openTxSheet(4)"); bp.wait_for_timeout(200)
        check('출금(저금통)엔 입금 버튼 없음', bp.evaluate("document.getElementById('txmIncome').classList.contains('hidden')"))
        # 이미 열린 창에서 설정 링크를 열면(# 뒤만 바뀜) 새로 읽지 않아도 적용
        bp.evaluate("S.ownerNames='임시'"); bp.evaluate(f"location.hash='#setup={link}'"); bp.wait_for_timeout(800)
        check('열린 창에서 설정 링크 적용(hashchange)', bp.evaluate("S.ownerNames==='홍길동'&&document.getElementById('toast').textContent.includes('연결됐어요')"))
        check('페이지 오류 없음', not errs, str(errs[:3]))
        # 기기 버전이 클라우드보다 낡았을 때 설정 링크를 열어도 이름이 클라우드 빈 값으로 되돌아가지 않음(검토 반영)
        ctx2 = b.new_context(viewport={'width': 420, 'height': 900}, locale='ko-KR')
        cloud['rev'] = 5; cloud['data'] = {**cloud['data'], 'rev': 5, 'ownerNames': ''}
        ctx2.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('seeded','1');"
                             f"localStorage.setItem('mp_v6',{json.dumps(json.dumps(seed))});localStorage.setItem('mp_sync',JSON.stringify({{rev:2,seq:1,sentSeq:1}}));}}")
        ctx2.route(SB + '/**', sb)
        c2 = ctx2.new_page(); c2.on('pageerror', lambda e: errs.append('C:' + str(e)[:200]))
        c2.goto(URL + '#setup=' + link); c2.wait_for_timeout(3000)
        check('낡은 기기에서 링크 적용 → 이름 유지·클라우드에 올라감', c2.evaluate("S.ownerNames") == '홍길동' and cloud['data'].get('ownerNames') == '홍길동', str(cloud['rev']))
        check('두 번째 창도 오류 없음', not errs, str(errs[:3]))
        b.close()
finally:
    srv.terminate()
print('결과:', sum(results), '/', len(results))
sys.exit(0 if all(results) else 1)
