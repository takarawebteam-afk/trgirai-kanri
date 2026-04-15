ALTER TABLE public.busho_schedules
  ADD COLUMN IF NOT EXISTS start_time time DEFAULT NULL;
