-- app_data 저장 가드 (2026-09-25). 한 번 실행.
-- 지난번 월 5GB 초과의 원인은 캡처 썸네일이 든 큰 블롭을 반복해서 읽은 것이었다.
-- 지금 앱은 썸네일을 빼고 올리지만, 오래 열어둔 옛 버전 탭 등이 다시 올리지 못하게 서버에서도 막는다.
--  1) 캡처에 썸네일(thumb)이 있으면 거부
--  2) 블롭이 300KB를 넘으면 거부(썸네일 없는 정상 데이터는 수십 KB)
-- 거부되면 앱에는 저장 오류로 보이고(자동 재시도 없음), 새로고침하면 최신 앱으로 다시 저장된다.
-- 실행 전 백업: select id, data from public.app_data;   크기 확인: select id, octet_length(data::text) from public.app_data;
-- 정리 → 검증 → 가드 설치를 한 트랜잭션으로: 정리 뒤에도 300KB를 넘는 행이 있으면 전부 되돌리고 멈춘다(그 행은 직접 확인).

begin;

-- 1) 이미 클라우드에 남아 있는 썸네일 정리. rev는 그대로 두므로 기기들은 다시 받지 않고, 각 기기의 썸네일은 기기에 그대로 남는다.
update public.app_data
   set data = jsonb_set(data::jsonb, '{captures}',
     coalesce((select jsonb_agg(c - 'thumb' order by i) from jsonb_array_elements(data::jsonb->'captures') with ordinality as e(c, i)), '[]'::jsonb))
 where jsonb_path_exists(data::jsonb, '$.captures[*].thumb ? (@ != null)');

-- 2) 검증: 썸네일이 남았거나 300KB를 넘는 행이 있으면 중단(트랜잭션 전체 취소)
do $$ declare bad int; begin
  select count(*) into bad from public.app_data
   where octet_length(data::text) > 300000 or jsonb_path_exists(data::jsonb, '$.captures[*].thumb ? (@ != null)');
  if bad > 0 then raise exception 'app_data %행이 정리 뒤에도 300KB 초과 또는 썸네일 포함 — 가드 설치 중단', bad; end if;
end $$;

-- 3) 가드 설치
create or replace function public.app_data_guard() returns trigger
language plpgsql as $$
begin
  if octet_length(new.data::text) > 300000 then
    raise exception 'app_data too large (% bytes)', octet_length(new.data::text) using errcode = '22023';
  end if;
  if jsonb_path_exists(new.data::jsonb, '$.captures[*].thumb ? (@ != null)') then
    raise exception 'app_data: thumbnails must stay on the device' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists app_data_guard on public.app_data;
create trigger app_data_guard before insert or update of data on public.app_data
  for each row execute function public.app_data_guard();

commit;
