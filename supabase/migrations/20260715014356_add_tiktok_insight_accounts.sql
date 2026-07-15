alter table public.tiktok_insight_months
add column if not exists account_key text not null default 'karilun';

alter table public.tiktok_insight_months
drop constraint if exists tiktok_insight_months_pkey;

alter table public.tiktok_insight_months
add constraint tiktok_insight_months_pkey primary key (account_key, month_key);

create index if not exists tiktok_insight_months_account_year_month_idx
on public.tiktok_insight_months (account_key, year, month);
