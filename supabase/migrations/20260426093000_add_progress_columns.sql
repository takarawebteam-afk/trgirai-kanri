alter table if exists production_records
  add column if not exists floor_plan_order text not null default '未着手',
  add column if not exists youtube_reserved boolean not null default false,
  add column if not exists audio_source text not null default '';
