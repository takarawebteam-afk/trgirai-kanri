create table if not exists public.change_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  feature text not null,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('update', 'delete', 'restore')),
  changed_field text,
  old_value text,
  new_value text,
  snapshot jsonb not null
);

create index if not exists change_history_feature_created_at_idx
on public.change_history (feature, created_at desc);

create index if not exists change_history_table_record_created_at_idx
on public.change_history (table_name, record_id, created_at desc);

alter table public.change_history enable row level security;

drop policy if exists "anon_all" on public.change_history;
create policy "anon_all"
  on public.change_history
  for all
  to anon
  using (true)
  with check (true);
