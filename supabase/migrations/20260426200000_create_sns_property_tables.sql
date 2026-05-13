-- SNS物件管理: TikTok / Instagram / YouTube 各テーブル

create table if not exists sns_tiktok_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  memo text default '',
  wp_registered boolean default false,
  aos_registered boolean default false,
  post_date date,
  property_number text default '',
  floor_plan text default '',
  rent text default '',
  area text default '',
  nearest_station text default '',
  document_url text default '',
  property_name text default '',
  room_number text default '',
  address text default '',
  acquisition_source text default '',
  management_company text default '',
  contact text default ''
);

create table if not exists sns_instagram_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  memo text default '',
  wp_registered boolean default false,
  category text default '',
  post_date date,
  property_number text default '',
  floor_plan text default '',
  rent text default '',
  area text default '',
  nearest_station text default '',
  document_url text default '',
  property_name text default '',
  room_number text default '',
  address text default '',
  acquisition_source text default '',
  management_company text default '',
  contact text default ''
);

create table if not exists sns_youtube_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  memo text default '',
  wp_registered boolean default false,
  post_date date,
  property_number text default '',
  document_url text default '',
  property_name text default '',
  room_number text default '',
  address text default '',
  acquisition_source text default '',
  management_company text default '',
  contact text default ''
);
