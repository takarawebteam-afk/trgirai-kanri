alter table if exists production_records
  add column if not exists post_type text not null default '',
  add column if not exists property_number text not null default '';
