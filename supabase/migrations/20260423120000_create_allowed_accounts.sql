create table if not exists public.allowed_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  is_master boolean not null default false,
  created_by text
);

alter table public.allowed_accounts
  add constraint allowed_accounts_email_lowercase
  check (email = lower(email));

insert into public.allowed_accounts (email, is_master, created_by)
values
  ('trg.yshini@gmail.com', true, 'trg.yshini@gmail.com'),
  ('takara.webteam@gmail.com', false, 'trg.yshini@gmail.com'),
  ('izumiyurina2322@gmail.com', false, 'trg.yshini@gmail.com'),
  ('takarabaito3@gmail.com', false, 'trg.yshini@gmail.com'),
  ('takarabaito1@gmail.com', false, 'trg.yshini@gmail.com')
on conflict (email) do update
set
  is_master = excluded.is_master,
  created_by = excluded.created_by;

alter table public.allowed_accounts disable row level security;
