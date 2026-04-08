begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.manual_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null default '無題',
  content text not null default '<p></p>',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.manual_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint manual_categories_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists manual_categories_name_lower_key
  on public.manual_categories (lower(name));

create table if not exists public.manual_page_categories (
  page_id uuid not null references public.manual_pages(id) on delete cascade,
  category_id uuid not null references public.manual_categories(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (page_id, category_id)
);

create index if not exists manual_page_categories_category_id_idx
  on public.manual_page_categories (category_id);

create index if not exists manual_pages_updated_at_idx
  on public.manual_pages (updated_at desc);

create index if not exists manual_pages_title_idx
  on public.manual_pages (title);

drop trigger if exists set_manual_pages_updated_at on public.manual_pages;
create trigger set_manual_pages_updated_at
before update on public.manual_pages
for each row
execute function public.set_updated_at();

insert into public.manual_categories (name)
values
  ('TikTok'),
  ('Instagram'),
  ('Threads'),
  ('マニュアル')
on conflict do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'manual-images',
  'manual-images',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.manual_pages enable row level security;
alter table public.manual_categories enable row level security;
alter table public.manual_page_categories enable row level security;

drop policy if exists "manual_pages_select_all" on public.manual_pages;
create policy "manual_pages_select_all"
on public.manual_pages
for select
to anon, authenticated
using (true);

drop policy if exists "manual_pages_insert_all" on public.manual_pages;
create policy "manual_pages_insert_all"
on public.manual_pages
for insert
to anon, authenticated
with check (true);

drop policy if exists "manual_pages_update_all" on public.manual_pages;
create policy "manual_pages_update_all"
on public.manual_pages
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "manual_pages_delete_all" on public.manual_pages;
create policy "manual_pages_delete_all"
on public.manual_pages
for delete
to anon, authenticated
using (true);

drop policy if exists "manual_categories_select_all" on public.manual_categories;
create policy "manual_categories_select_all"
on public.manual_categories
for select
to anon, authenticated
using (true);

drop policy if exists "manual_categories_insert_all" on public.manual_categories;
create policy "manual_categories_insert_all"
on public.manual_categories
for insert
to anon, authenticated
with check (true);

drop policy if exists "manual_categories_update_all" on public.manual_categories;
create policy "manual_categories_update_all"
on public.manual_categories
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "manual_categories_delete_all" on public.manual_categories;
create policy "manual_categories_delete_all"
on public.manual_categories
for delete
to anon, authenticated
using (true);

drop policy if exists "manual_page_categories_select_all" on public.manual_page_categories;
create policy "manual_page_categories_select_all"
on public.manual_page_categories
for select
to anon, authenticated
using (true);

drop policy if exists "manual_page_categories_insert_all" on public.manual_page_categories;
create policy "manual_page_categories_insert_all"
on public.manual_page_categories
for insert
to anon, authenticated
with check (true);

drop policy if exists "manual_page_categories_update_all" on public.manual_page_categories;
create policy "manual_page_categories_update_all"
on public.manual_page_categories
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "manual_page_categories_delete_all" on public.manual_page_categories;
create policy "manual_page_categories_delete_all"
on public.manual_page_categories
for delete
to anon, authenticated
using (true);

drop policy if exists "manual_images_public_read" on storage.objects;
create policy "manual_images_public_read"
on storage.objects
for select
to public
using (bucket_id = 'manual-images');

drop policy if exists "manual_images_insert" on storage.objects;
create policy "manual_images_insert"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'manual-images');

drop policy if exists "manual_images_update" on storage.objects;
create policy "manual_images_update"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'manual-images')
with check (bucket_id = 'manual-images');

drop policy if exists "manual_images_delete" on storage.objects;
create policy "manual_images_delete"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'manual-images');

commit;
