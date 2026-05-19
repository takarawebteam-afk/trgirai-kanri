alter table public.allowed_accounts
  add column if not exists allow_outside_office boolean not null default false;
