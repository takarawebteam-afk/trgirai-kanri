alter table if exists sns_tiktok_properties
  add column if not exists acquisition_source text not null default '';

alter table if exists sns_instagram_properties
  add column if not exists acquisition_source text not null default '';

alter table if exists sns_youtube_properties
  add column if not exists acquisition_source text not null default '';

alter table if exists production_records
  add column if not exists acquisition_source text not null default '';
