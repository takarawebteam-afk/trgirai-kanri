create table if not exists public.sns_recruitment_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  memo text default '',
  post_date text default '',
  category text default '',
  title text default '',
  property_number text default '',
  post_reserved text default '',
  youtube_reserved text default ''
);

alter table public.sns_recruitment_properties
  add column if not exists property_number text default '';

alter table public.sns_recruitment_properties enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sns_recruitment_properties'
      and policyname = 'anon_all'
  ) then
    create policy "anon_all" on public.sns_recruitment_properties for all to anon using (true) with check (true);
  end if;
end $$;
