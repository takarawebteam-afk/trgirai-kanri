create table if not exists public.tiktok_insight_months (
  month_key text primary key,
  year integer not null,
  month integer not null,
  overview_rows jsonb not null default '[]'::jsonb,
  follower_rows jsonb not null default '[]'::jsonb,
  gender_rows jsonb not null default '[]'::jsonb,
  territory_rows jsonb not null default '[]'::jsonb,
  file_status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists tiktok_insight_months_year_month_idx
on public.tiktok_insight_months (year, month);

alter table public.tiktok_insight_months enable row level security;

drop policy if exists "anon_all" on public.tiktok_insight_months;
create policy "anon_all"
on public.tiktok_insight_months
for all
to anon
using (true)
with check (true);
