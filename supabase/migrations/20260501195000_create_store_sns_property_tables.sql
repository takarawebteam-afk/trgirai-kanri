create table if not exists public.sns_keihan_karilun_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  memo text default '',
  post_date text default '',
  category text default '',
  property_name text default '',
  room_number text default '',
  property_number text default '',
  document_url text default '',
  tiktok_reserved text default '',
  tiktok_wp text default '',
  instagram_reserved text default '',
  instagram_wp text default '',
  youtube_reserved text default '',
  youtube_wp text default '',
  threads_post_date text default '',
  post_text text default ''
);

create table if not exists public.sns_nishinomiya_karilun_properties (
  like public.sns_keihan_karilun_properties including defaults including constraints
);

create table if not exists public.sns_nagase_properties (
  like public.sns_keihan_karilun_properties including defaults including constraints
);

create table if not exists public.sns_nishikita_properties (
  like public.sns_keihan_karilun_properties including defaults including constraints
);

create table if not exists public.sns_yao_properties (
  like public.sns_keihan_karilun_properties including defaults including constraints
);
