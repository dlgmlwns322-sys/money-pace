# 이 기기 저장 공간이 부족할 때: 오류 없이 안내하고, 앱은 계속 동작. 실행: python test/browser/save_failure.py
import subprocess,sys,time,os,json
from playwright.sync_api import sync_playwright
srv=subprocess.Popen([sys.executable,'-m','http.server','8799','--bind','127.0.0.1'],cwd=os.path.expanduser('~/claude-vault'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    with sync_playwright() as pw:
        b=pw.chromium.launch(channel='msedge');p=b.new_page()
        errs=[];p.on('pageerror',lambda e:errs.append(str(e)[:200]))
        seed={"budget":1000000,"budgetStart":"2026-09-25","budgetEnd":"2026-10-24","balances":{"kakao":1,"kb":1},"captures":[],"fixed":[{"id":"f1","name":"통신","amount":55000,"paid":False,"paidDate":""}],"memos":{}}
        p.add_init_script(f"localStorage.setItem('mp_v6',{json.dumps(json.dumps(seed))});")
        p.goto('http://127.0.0.1:8799/%EB%A8%B8%EB%8B%88%ED%8E%98%EC%9D%B4%EC%8A%A4/index.html',wait_until='load');p.wait_for_timeout(800)
        p.evaluate("""()=>{const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='mp_v6')throw new Error('QuotaExceeded');return o.call(this,k,v);};}""")
        p.evaluate("showTab('fixed');toggleFixed('f1')");p.wait_for_timeout(400)
        r=p.evaluate("({toast:document.getElementById('toast').textContent,ok:save()===false})")
        print('저장 실패 시:',json.dumps(r,ensure_ascii=False),errs)
        print('PASS' if '부족' in r['toast'] and r['ok'] and not errs else 'FAIL')
        b.close()
finally: srv.terminate()
