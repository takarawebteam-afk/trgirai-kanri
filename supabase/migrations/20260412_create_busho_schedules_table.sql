-- 部署予定テーブル
create table if not exists public.busho_schedules (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  date           date not null,
  title          text not null default '',
  department     text not null default '',
  note           text not null default ''
);

-- RLS 無効化（他テーブルと同様の運用）
alter table public.busho_schedules disable row level security;
