# 알림센터(벨) 브라우저 시나리오. 실행: python test/browser/bell_scenarios.py (msedge + playwright)
import subprocess, sys, time, os, json
from datetime import datetime, timedelta, timezone
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
iso = lambda d: d.astimezone(timezone.utc).isoformat()
now = datetime.now(timezone.utc)
KST = timezone(timedelta(hours=9))
today = now.astimezone(KST).strftime('%Y-%m-%d')
start = (now.astimezone(KST) - timedelta(days=3)).strftime('%Y-%m-%d')
end = (now.astimezone(KST) + timedelta(days=26)).strftime('%Y-%m-%d')
rows = [
    {"id": 1, "bank": "kb", "type": "out", "amount": 7000, "balance": 100000, "counterparty": "가게", "method": "체크카드", "at": iso(now - timedelta(days=2)), "needs_review": True},
    {"id": 2, "bank": "kakao", "type": "out", "amount": 4500, "balance": 50000, "counterparty": "카페", "method": "출금", "at": iso(now - timedelta(days=1)), "needs_review": False},
]
state = {
    'status': {"heartbeatAt": iso(now - timedelta(hours=40)), "unparsed": {"count": 2, "newest": iso(now - timedelta(hours=5))},
               "lastTx": {"kakao": iso(now - timedelta(days=1)), "kb": iso(now - timedelta(days=20))}},
    'fail': False, 'status_fail': False, 'status_calls': 0,
}
seed = {"budget": 1000000, "weeklyBudget": 250000, "budgetStart": start, "budgetEnd": end,
        "balances": {"kakao": 1, "kb": 1}, "captures": [], "fixed": [], "memos": {},
        "supabaseUrl": SB, "supabaseKey": "anon", "txReadSecret": "READKEY", "ownerNames": "홍길동"}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(viewport={'width': 390, 'height': 844}, locale='ko-KR')
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.add_init_script(f"if(!sessionStorage.getItem('seeded')){{localStorage.setItem('mp_v6', {json.dumps(json.dumps(seed))});localStorage.setItem('mp_sync', JSON.stringify({{rev:3,seq:1,sentSeq:1}}));sessionStorage.setItem('seeded','1');}}")
        def sb(route):
            u = route.request.url
            if '/functions/v1/tx-read' in u:
                if state['fail']:
                    return route.fulfill(status=503, body='down', headers={'Access-Control-Allow-Origin': '*'})
                q = parse_qs(urlparse(u).query)
                if q.get('status') == ['1']:
                    state['status_calls'] += 1
                    if state['status_fail']:
                        return route.fulfill(status=503, body='down', headers={'Access-Control-Allow-Origin': '*'})
                    return route.fulfill(status=200, content_type='application/json', body=json.dumps(state['status']), headers={'Access-Control-Allow-Origin': '*'})
                after = int(q.get('after', ['0'])[0])
                out = [r for r in rows if r['id'] > after] if 'after' in q else rows
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(out), headers={'Access-Control-Allow-Origin': '*'})
            if 'select=rev' in u:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{"rev": "3"}]))
            return route.fulfill(status=200, content_type='application/json', body='[{"id":"my_money_data"}]')
        p.route(SB + '/**', sb)
        p.goto(URL, wait_until='load'); p.wait_for_timeout(2500)

        check('거래 받은 뒤 상태도 한 번 받음', state['status_calls'] == 1, str(state['status_calls']))
        dot = p.evaluate("(()=>{const d=document.querySelector('.hero2 [data-bell] .bell-dot');return d?d.className:null})()")
        check('홈 히어로 벨에 빨간 점(경고 있음)', dot and 'warn' in dot, str(dot))
        titles = p.evaluate("computeNotices().map(n=>n.level+':'+n.title)")
        tj = ' | '.join(titles)
        check('폰 자동화 멈춤 경고(40시간)', 'warn:폰 자동화가 멈춘 것 같아요' in tj, tj)
        check('미해석 2건 경고', 'warn:해석하지 못한 은행 알림 2건' in tj)
        check('국민은행 14일 무알림 안내(카카오는 없음)', '국민은행 알림이 14일' in tj and '카카오뱅크 알림이 14일' not in tj)
        check('확인 필요 거래 1건', '확인이 필요한 거래 1건' in tj)
        p.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'bell_home.png'))

        p.click('.hero2 [data-bell]'); p.wait_for_timeout(300)
        vis = p.is_visible('#noticeModal')
        n_items = p.evaluate("document.querySelectorAll('#noticeList .nt-item').length")
        foot = p.inner_text('#noticeFoot')
        check('벨 누르면 목록 열림', vis and n_items == len(titles), f'{n_items} items, foot={foot}')
        check('하단 부가 문구 없음(2026-09-26 사용자)', foot.strip() == '', foot)
        p.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'bell_list.png'))
        p.click('#noticeModal .nt-go >> nth=0'); p.wait_for_timeout(300)
        check('보러 가기 → 해당 탭으로 이동·모달 닫힘', not p.is_visible('#noticeModal') and p.is_visible('#tab-capture'))
        dot2 = p.evaluate("document.querySelectorAll('[data-bell] .bell-dot').length")
        check('본 뒤에는 점 사라짐', dot2 == 0, str(dot2))
        hdr_bell = p.is_visible('#appHeader [data-bell]')
        check('다른 탭 헤더에도 벨', hdr_bell)

        # 새로고침해도 확인 기록 유지(이 기기)
        p.reload(wait_until='load'); p.wait_for_timeout(2500)
        check('새로고침 후에도 확인 유지', p.evaluate("document.querySelectorAll('[data-bell] .bell-dot').length") == 0)

        # 같은 문제가 '다시' 생기면(새 미해석 발생) 새 알림으로 점이 다시 뜸
        state['status']['unparsed'] = {"count": 3, "newest": iso(now - timedelta(minutes=5))}
        p.evaluate("TX.lastFetch=0"); p.evaluate("refreshAndRoll()"); p.wait_for_timeout(1500)
        dot3 = p.evaluate("(()=>{const d=document.querySelector('[data-bell] .bell-dot');return d?d.className:null})()")
        check('새 미해석 발생 → 다시 빨간 점', dot3 and 'warn' in dot3, str(dot3))

        # 상태 조회만 실패: 독립 경고 + 로컬 거래 검토 알림은 그대로 + 생존 신호 판정은 마지막 확인 기준
        state['status_fail'] = True
        p.evaluate("TX.lastFetch=0"); p.evaluate("refreshAndRoll()"); p.wait_for_timeout(1500)
        tj3 = ' | '.join(p.evaluate("computeNotices().map(n=>n.level+':'+n.title)"))
        check('상태 조회 실패 → 독립 경고', 'warn:자동화 상태를 확인하지 못했어요' in tj3, tj3)
        check('상태 실패여도 거래 검토 알림 유지', '확인이 필요한 거래 1건' in tj3)
        state['status_fail'] = False
        p.evaluate("TX.lastFetch=0"); p.evaluate("refreshAndRoll()"); p.wait_for_timeout(1500)
        check('상태 복구 → 상태 경고 사라짐', '자동화 상태를 확인하지 못했어요' not in ' '.join(p.evaluate("computeNotices().map(n=>n.title)")))

        # 재시도 중(saving)에 다시 실패해도 같은 사건(새 알림 아님)
        p.evaluate("updateSyncBadge('error')")
        id1 = p.evaluate("computeNotices().find(n=>n.title==='동기화 실패').id")
        p.wait_for_timeout(30); p.evaluate("updateSyncBadge('saving')"); p.evaluate("updateSyncBadge('error')")
        id2 = p.evaluate("computeNotices().find(n=>n.title==='동기화 실패').id")
        check('재시도 중 재실패는 같은 사건', id1 == id2, f'{id1} {id2}')
        # 앱을 다시 켜도(상태 모름) 사건 유지 → 성공(saved)해야 해제
        p.evaluate("lastSyncStatus=null")
        check('재시작 직후에도 사건 유지', any(n['title'] == '동기화 실패' for n in p.evaluate("computeNotices()")))
        p.evaluate("updateSyncBadge('saved')")
        check('저장 성공하면 해제', not any(n['title'] == '동기화 실패' for n in p.evaluate("computeNotices()")))
        # 동기화 장애가 같은 날 '복구 후 재발'하면 새 알림(빨간 점)
        p.evaluate("updateSyncBadge('error')"); p.evaluate("openNotices();closeNotices()")
        p.evaluate("updateSyncBadge('saved')"); p.wait_for_timeout(50)
        p.evaluate("updateSyncBadge('error')")
        unseen = p.evaluate("computeNotices().filter(n=>n.title==='동기화 실패'&&!noticeSeen.includes(n.id)).length")
        check('같은 날 재발한 동기화 실패도 새 알림', unseen == 1, str(unseen))
        p.evaluate("updateSyncBadge('saved')")

        # 한 은행 알림이 한 번도 안 온 경우(처음부터 설정 누락)
        state['status']['lastTx'] = {"kakao": iso(now - timedelta(days=1)), "kb": None}
        p.evaluate("TX.lastFetch=0"); p.evaluate("refreshAndRoll()"); p.wait_for_timeout(1500)
        check('국민은행 수신 이력 없음 안내', '국민은행 알림을 아직 한 번도 받지 못했어요' in ' '.join(p.evaluate("computeNotices().map(n=>n.title)")))

        # 서버가 죽으면 '특이사항 없음'이 아니라 '받지 못함' 경고 + 마지막 성공 시각
        state['fail'] = True
        p.evaluate("TX.lastFetch=0"); p.evaluate("refreshAndRoll()"); p.wait_for_timeout(1500)
        tj2 = ' | '.join(p.evaluate("computeNotices().map(n=>n.level+':'+n.title+' '+n.body)"))
        check('서버 장애 → 거래 못 받음 경고(마지막 성공 표시)', 'warn:거래를 받지 못했어요' in tj2 and '마지막 성공: 방금' in tj2, tj2[:160])

        # 동기화 실패 경고
        p.evaluate("updateSyncBadge('error')")
        check('동기화 실패 경고', '동기화 실패' in ' '.join(p.evaluate("computeNotices().map(n=>n.title)")))

        # 거래 받기 실패 뒤 재시작: 옛 성공 기록(lastOk)만으로는 해제하지 않음, 실패 사유도 저장됨
        p.evaluate("TX.error=null;TX.lastOk=1000;incidents.tx=2000")
        check('사건 뒤 성공이 없으면 거래 장애 유지', any(n['title'] == '거래를 받지 못했어요' for n in p.evaluate("computeNotices()")))
        p.evaluate("TX.lastOk=Date.now()+1")
        check('사건 뒤 성공하면 해제', not any(n['title'] == '거래를 받지 못했어요' for n in p.evaluate("computeNotices()")))
        saved_err = p.evaluate("(()=>{TX.error='연결 안 됨';saveTxCache();return JSON.parse(localStorage.getItem('mp_tx')).error})()")
        check('실패 사유가 기기에 저장됨', saved_err == '연결 안 됨', str(saved_err))
        # 알림을 안 쓰는 사용자(읽기 키 없음): 서버 호출 없음, 거래 관련 알림 없음
        p.evaluate("S.txReadSecret='';updateSyncBadge('saved')")
        check('읽기 키 없으면 거래 알림 없음', p.evaluate("computeNotices().length") == 0)
        check('JS 오류 없음', not errs, str(errs))
        b.close()
finally:
    srv.terminate()
print(f"\n{sum(results)}/{len(results)} 통과")
sys.exit(0 if all(results) else 1)
