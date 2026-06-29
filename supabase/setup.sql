-- Supabase SQL Editor에서 한 번만 실행
-- 1) 중복 발송 방지용 로그 테이블
create table if not exists notify_log (
  sent_date date primary key,
  created_at timestamptz default now()
);

-- 2) 스케줄링에 필요한 확장 기능 활성화
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) 1분마다 daily-report 함수를 호출하는 cron 등록
--    함수 내부에서 사용자가 앱에 설정한 alarmTime과 비교해 실제로는 하루 1번만 발송함
--    <PROJECT_REF>, <SERVICE_ROLE_KEY>는 Supabase 프로젝트 설정 값으로 교체
select cron.schedule(
  'money-pace-daily-report',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-report',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
  );
  $$
);

-- 스케줄 확인: select * from cron.job;
-- 스케줄 삭제: select cron.unschedule('money-pace-daily-report');
