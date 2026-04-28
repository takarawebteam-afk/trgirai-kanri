-- ストック管理テーブル
create table if not exists public.stock (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  deadline       date not null,
  required_count integer not null default 1,
  label          text not null default '',
  note           text not null default '',
  achieved_count integer not null default 0
);

-- RLS 無効化（他テーブルと同様の運用）
alter table public.stock disable row level security;
