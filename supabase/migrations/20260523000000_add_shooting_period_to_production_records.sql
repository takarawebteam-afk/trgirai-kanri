alter table if exists production_records
  add column if not exists shooting_start_date date,
  add column if not exists shooting_end_date date;
