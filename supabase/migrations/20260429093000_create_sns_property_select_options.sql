create table if not exists public.sns_property_select_options (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  field text not null,
  label text not null default '',
  sort_order integer not null default 0
);

create unique index if not exists sns_property_select_options_field_label_key
  on public.sns_property_select_options(field, label);

create index if not exists sns_property_select_options_field_sort_order_idx
  on public.sns_property_select_options(field, sort_order, created_at);

alter table public.sns_property_select_options enable row level security;

drop policy if exists "anon_all" on public.sns_property_select_options;
create policy "anon_all"
  on public.sns_property_select_options
  for all
  to anon
  using (true)
  with check (true);
