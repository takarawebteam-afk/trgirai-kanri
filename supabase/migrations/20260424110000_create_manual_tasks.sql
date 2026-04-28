create table if not exists manual_tasks (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  member_calendar_id text not null,
  task_name text not null,
  minutes integer,
  checked boolean not null default false,
  created_at timestamptz default now()
);
