begin;

create extension if not exists pgcrypto;

create table if not exists public.task_report_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  keywords text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint task_report_categories_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists task_report_categories_name_lower_key
  on public.task_report_categories (lower(name));

insert into public.task_report_categories (name, keywords, sort_order)
values
  ('SNS投稿・予約投稿', 'sns
投稿
youtube
tiktok
instagram
threads
予約', 0),
  ('分析・改善', '数値入力
数値,入力
アカウント,数値
分析
改善
レポート', 1),
  ('その他', '', 999)
on conflict do nothing;

alter table public.task_report_categories enable row level security;

drop policy if exists "task_report_categories_select_all" on public.task_report_categories;
create policy "task_report_categories_select_all"
on public.task_report_categories
for select
to anon, authenticated
using (true);

drop policy if exists "task_report_categories_insert_all" on public.task_report_categories;
create policy "task_report_categories_insert_all"
on public.task_report_categories
for insert
to anon, authenticated
with check (true);

drop policy if exists "task_report_categories_update_all" on public.task_report_categories;
create policy "task_report_categories_update_all"
on public.task_report_categories
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "task_report_categories_delete_all" on public.task_report_categories;
create policy "task_report_categories_delete_all"
on public.task_report_categories
for delete
to anon, authenticated
using (true);

commit;
