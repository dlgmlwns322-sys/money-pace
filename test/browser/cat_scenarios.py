# 홈 '이번 달 지출' 원형 그래프 카드 + 거래 눌러 카테고리 바꾸기. 실행: python test/browser/cat_scenarios.py
import subprocess, sys, time, os, json
from datetime import datetime
from playwright.sync_api import sync_playwright
root = os.path.expanduser('~/claude-vault')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8799', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
URL = 'http://127.0.0.1:8799/%EB%A8%B8%EB%8B%88%ED%8E%98%EC%9D%B4%EC%8A%A4/index.html'
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('PASS' if cond else 'FAIL'), '-', name, extra)
rows, bal, nid = [], {'kb': 1000000, 'kakao': 500000}, [0]
def tx(bank, amount, cp, at, typ='out', method=''):
    bal[bank] += amount if typ == 'in' else -amount; nid[0] += 1
    rows.append({"id": nid[0], "bank": bank, "type": typ, "amount": amount, "balance": bal[bank], "counterparty": cp, "method": method, "at": at, "needs_review": False})
tx('kb', 1, '가게', '2026-09-20T12:00:00+09:00'); tx('kakao', 1, '가게', '2026-09-20T12:10:00+09:00')
tx('kb', 4500, '메가MGC커피', '2026-09-23T08:00:00+09:00'); tx('kb', 12000, '김밥천국', '2026-09-23T12:00:00+09:00')
tx('kakao', 18900, '배달의민족', '2026-09-24T19:00:00+09:00'); tx('kakao', 5000, '쿤자PC방', '2026-09-24T21:00:00+09:00')
tx('kb', 30000, '이니시스(', '2026-09-25T10:00:00+09:00'); tx('kb', 3200, 'GS25 군자점', '2026-09-25T13:00:00+09:00')
seed = {"budget": 3100000, "budgetStart": "2026-09-23", "budgetEnd": "2026-10-22", "txSince": "2026-09-21", "ownerNames": "홍길동", "payer": "오피엠에스", "payDay": 25,
        "balances": {"kakao": bal['kakao'], "kb": bal['kb']}, "captures": [], "fixed": [], "memos": {}, "supabaseUrl": "", "supabaseKey": "", "txReadSecret": "x"}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='msedge'); p = b.new_page(viewport={'width': 360, 'height': 800}, locale='ko-KR', timezone_id='Asia/Seoul')
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.clock.install(time=datetime.fromisoformat('2026-09-26T12:00:00+09:00'))
        p.add_init_script(f"if(!sessionStorage.getItem('s')){{localStorage.setItem('mp_v6',{json.dumps(json.dumps(seed))});localStorage.setItem('mp_tx',JSON.stringify({{rows:{json.dumps(rows)},maxId:{nid[0]},lastFetch:Date.now()}}));sessionStorage.setItem('s','1');}}")
        p.goto(URL, wait_until='load'); p.wait_for_timeout(1200)
        card = p.evaluate("[...document.querySelectorAll('#catCard .cat-row')].map(r=>[r.querySelector('.nm').textContent,r.querySelector('.am').textContent])")
        head = p.evaluate("document.querySelector('#catCard .cat-hd').innerText.replace(/\\n/g,' ')")
        check('카드 제목 "이번 달 지출"과 합계', head.startswith('이번 달 지출') and '73,600원' in head, head)
        check('많이 쓴 순 정렬(기타 3만 → 배달 → 식비 → 피시방 → 카페 → 편의점)', [c[0] for c in card] == ['기타', '배달', '식비', '피시방', '카페', '편의점'], str(card))
        over = p.evaluate("(()=>{const W=document.documentElement.clientWidth;return [...document.querySelectorAll('#catCard *')].filter(e=>e.getBoundingClientRect().right>W+1).length})()")
        check('360px에서 넘침 없음', over == 0, str(over))
        p.click('#catCard .cat-row:nth-child(2)'); p.wait_for_timeout(150)
        mid = p.evaluate("document.querySelector('#catCard .cat-mid').innerText.replace(/\\n/g,' ')")
        check('누르면 가운데에 카테고리·금액·비중', mid.startswith('배달') and '18,900원' in mid and '26%' in mid, mid)
        p.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'cat_home.png'), full_page=True)
        # 거래 탭에서 이니시스 거래를 쇼핑으로(같은 가게 기억)
        p.evaluate("showTab('capture')"); p.wait_for_timeout(200)
        p.click("#txList .tx-row:has-text('이니시스')"); p.wait_for_timeout(150)
        chips = p.evaluate("[...document.querySelectorAll('#txmChips button')].map(b=>b.textContent+(b.classList.contains('on')?'*':''))")
        check('카테고리 버튼 12개(옷·교통·약속·직접 입력 포함), 지금 값(기타) 표시', len(chips) == 12 and '기타*' in chips and '직접 입력' in chips, str(chips))
        p.click("#txmChips button:has-text('쇼핑')"); p.wait_for_timeout(200)
        r = p.evaluate("({map:S.catMap,cats:cycleCategoryTotals().out})")
        check('쇼핑으로 바뀌고 가게 기억(카드도 반영)', r['map'].get('이니시스(') == '쇼핑' and r['cats']['쇼핑'] == 30000 and r['cats']['기타'] == 0, json.dumps(r, ensure_ascii=False))
        # 홈에서 바로: 카테고리 누르면 그 거래가 펼쳐지고, 눌러서 분류 바꾸기
        p.evaluate("showTab('home');catSel=null;renderCatCard()"); p.wait_for_timeout(150)
        p.click("#catCard .cat-row:has-text('쇼핑')"); p.wait_for_timeout(150)
        lst = p.evaluate("[...document.querySelectorAll('#catCard .cat-tx-row .m')].map(e=>e.textContent)")
        check('홈 그래프에서 쇼핑 누르면 그 거래 목록', lst == ['이니시스('], str(lst))
        p.click("#catCard .cat-tx-row"); p.wait_for_timeout(150)
        p.click("#txmChips button:has-text('기타')"); p.wait_for_timeout(200)
        r2 = p.evaluate("({map:S.catMap,rows:[...document.querySelectorAll('#catCard .cat-row .nm')].map(e=>e.textContent)})")
        check('목록에서 눌러 기타로 되돌림 → 그래프 반영', r2['map'].get('이니시스(') == '기타' and '쇼핑' not in r2['rows'], json.dumps(r2, ensure_ascii=False))
        p.click("#catCard .cat-row:has-text('기타')"); p.wait_for_timeout(150)
        lst2 = p.evaluate("[...document.querySelectorAll('#catCard .cat-tx-row .m')].map(e=>e.textContent)")
        check('기타 누르면 기타 거래 목록', '이니시스(' in lst2, str(lst2))
        over2 = p.evaluate("(()=>{const W=document.documentElement.clientWidth;return [...document.querySelectorAll('#catCard *')].filter(e=>e.getBoundingClientRect().right>W+1).length})()")
        check('목록 펼쳐도 넘침 없음', over2 == 0, str(over2))
        p.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'cat_open.png'), full_page=True)
        # KB Pay 가게 이름 힌트: 이니시스(5천·2026-09-25 10:00) 출금에 '쿤자PC방'이 붙어 표시·분류
        p.evaluate("S.catMap={};TX.hints=[{id:1,at:'2026-09-25T10:01:00+09:00',amount:30000,merchant:'쿤자PC방'},{id:2,at:'2026-09-25T13:10:00+09:00',amount:3200,merchant:'먼가게'}];renderTx();renderCatCard()"); p.wait_for_timeout(150)
        r3 = p.evaluate("({names:[...document.querySelectorAll('#catCard .cat-row .nm')].map(e=>e.textContent),pc:cycleCategoryTotals().out['피시방'],gs:txWithFlags().find(r=>r.amount===3200).merchant})")
        check('힌트 매칭: 1분 차 → 쿤자PC방(피시방 3.5만), 10분 차 → 매칭 안 함', r3['pc'] == 35000 and r3['gs'] == 'GS25 군자점', json.dumps(r3, ensure_ascii=False))
        p.evaluate("showTab('capture')"); p.wait_for_timeout(150)
        shown = p.evaluate("[...document.querySelectorAll('#txList .tx-row')].map(e=>e.innerText).join('|')")
        check('거래 목록에 실제 가게 이름', '쿤자PC방' in shown and '이니시스' not in shown, shown[:200])
        check('JS 오류 없음', not errs, str(errs))
        b.close()
finally:
    srv.terminate()
print(f"\n{sum(results)}/{len(results)} 통과")
sys.exit(0 if all(results) else 1)
