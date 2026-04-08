-- DM管理テーブル
create table if not exists public.dm (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  date           date not null,
  account        text not null default '',
  sns            text not null default '',
  area           text not null default '',
  property_number text not null default ''
);

-- RLS 無効化（他テーブルと同様の運用）
alter table public.dm disable row level security;
