alter table if exists production_records
  add column if not exists shooting_scheduled_date date;
