begin;

create table if not exists public.manual_page_allowed_accounts (
  page_id uuid not null references public.manual_pages(id) on delete cascade,
  email text not null references public.allowed_accounts(email) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (page_id, email),
  constraint manual_page_allowed_accounts_email_lowercase check (email = lower(email))
);

create index if not exists manual_page_allowed_accounts_email_idx
  on public.manual_page_allowed_accounts (email);

alter table public.manual_page_allowed_accounts enable row level security;

drop policy if exists "manual_page_allowed_accounts_select_all" on public.manual_page_allowed_accounts;
create policy "manual_page_allowed_accounts_select_all"
on public.manual_page_allowed_accounts
for select
to anon, authenticated
using (true);

drop policy if exists "manual_page_allowed_accounts_insert_all" on public.manual_page_allowed_accounts;
create policy "manual_page_allowed_accounts_insert_all"
on public.manual_page_allowed_accounts
for insert
to anon, authenticated
with check (true);

drop policy if exists "manual_page_allowed_accounts_update_all" on public.manual_page_allowed_accounts;
create policy "manual_page_allowed_accounts_update_all"
on public.manual_page_allowed_accounts
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "manual_page_allowed_accounts_delete_all" on public.manual_page_allowed_accounts;
create policy "manual_page_allowed_accounts_delete_all"
on public.manual_page_allowed_accounts
for delete
to anon, authenticated
using (true);

commit;
