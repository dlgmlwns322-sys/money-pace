-- 입출금 알림 자동 기록 (2026-09-25). Supabase SQL Editor 또는 CLI로 한 번 실행.
-- 휴대폰 MacroDroid → Edge Function tx-ingest(쓰기 비밀키) → tx 테이블.
-- 앱은 Edge Function tx-read(읽기 비밀키)로만 읽는다. anon 키로는 이 테이블을 읽지도 쓰지도 못한다.
-- 전송량(월 5GB 조직 공유) 기준: 한 행 약 250바이트(원문 제외해서 보냄), 하루 10건이면 월 약 0.1MB.

create table if not exists public.tx (
  id bigserial primary key,
  key text not null unique,            -- 같은 알림이 두 번 와도 한 번만 저장(은행|계좌|시각|방향|금액|잔액|상대)
  bank text not null check (bank in ('kakao','kb')),
  type text not null check (type in ('in','out')),
  amount bigint not null check (amount > 0),
  balance bigint,                      -- 거래 후 잔액(알림에 있음)
  counterparty text,
  account text,
  method text,
  at timestamptz not null,             -- 거래 시각(알림 본문, KST)
  needs_review boolean not null default false,
  raw text not null,                   -- 알림 원문(해석이 틀렸을 때 다시 해석용). 앱으로는 보내지 않는다.
  created_at timestamptz not null default now()
);
create index if not exists tx_at_idx on public.tx (at);

-- 은행 알림인데 해석하지 못한 것(형식이 바뀐 경우 등). 나중에 해석기를 고쳐 다시 넣기 위해 보관.
create table if not exists public.tx_unparsed (
  id bigserial primary key,
  app text,
  title text,
  body text not null,
  created_at timestamptz not null default now()
);

-- 둘 다 anon·authenticated는 아무 권한 없음(RLS 켜고 정책 없음). Edge Function(service role)만 접근.
alter table public.tx enable row level security;
alter table public.tx_unparsed enable row level security;
-- 예전에 만들었을 수 있는 정책을 모두 지운다(정책이 없어야 anon·authenticated가 못 읽음)
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' and tablename in ('tx','tx_unparsed') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
revoke all on public.tx from anon, authenticated;
revoke all on public.tx_unparsed from anon, authenticated;
revoke all on sequence public.tx_id_seq from anon, authenticated;
revoke all on sequence public.tx_unparsed_id_seq from anon, authenticated;

-- MacroDroid 생존 신호(하루 한 번). 한 행만 두고 시각을 덮어쓴다. 일일 리포트가 30시간 넘게 끊기면 경고.
create table if not exists public.ingest_heartbeat (
  id smallint primary key default 1 check (id = 1),
  at timestamptz not null
);
alter table public.ingest_heartbeat enable row level security;
revoke all on public.ingest_heartbeat from anon, authenticated;

-- KB Pay(카드 앱) 승인 알림의 실제 가게 이름(2026-09-26). 거래가 아니라 힌트: 앱이 같은 금액·몇 분 안의 통장 출금과 짝지어 이름만 쓴다.
create table if not exists public.card_hint (
  id bigserial primary key,
  key text not null unique,            -- 'hint|시각|금액|가게' (같은 결제의 알림 두 개는 한 번만)
  at timestamptz not null,
  amount bigint not null check (amount > 0),
  merchant text not null,
  created_at timestamptz not null default now()
);
alter table public.card_hint enable row level security;
revoke all on public.card_hint from anon, authenticated;
revoke all on sequence public.card_hint_id_seq from anon, authenticated;
