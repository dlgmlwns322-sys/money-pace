-- 생존 신호 감시(2026-09-29). 한 번 실행. tx.sql 다음.
-- 폰(MacroDroid) 생존 신호가 30시간 넘게 없으면 heartbeat-watch 함수가 텔레그램으로 알린다.
-- ⚠️ <WATCH_SECRET> 세 곳(검사 2곳·크론 1곳)을 실제 HEARTBEAT_WATCH_SECRET 값으로 바꿔 실행한다. 실제 값은 저장소에 두지 않는다.
--    바꾸지 않고 실행하면 아래 검사에서 멈춘다(정상 크론을 자리표시 값으로 덮어쓰지 않게).

do $$ begin
  if '<WATCH_SECRET>' like '<%>' or length('<WATCH_SECRET>') < 32 then
    raise exception 'WATCH_SECRET 자리표시를 실제 비밀키로 바꾼 뒤 실행하세요';
  end if;
end $$;

-- 마지막 경고 시각(정상이면 null)
alter table public.ingest_heartbeat add column if not exists alert_at timestamptz;

-- 1시간마다(매시 37분 — 12:00 생존 신호와 겹치지 않게). 같은 이름이면 덮어쓴다.
select cron.schedule('money-pace-heartbeat-watch', '37 * * * *', $cron$
  select net.http_post(
    url := 'https://mspcoeyumypoptvayyhw.supabase.co/functions/v1/heartbeat-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-watch-secret','<WATCH_SECRET>'),
    body := '{}'::jsonb
  );
$cron$);
