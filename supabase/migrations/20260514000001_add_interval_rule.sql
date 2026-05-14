ALTER TABLE public.sns_posting_rules
  ADD COLUMN IF NOT EXISTS rule_type text NOT NULL DEFAULT 'weekday',
  ADD COLUMN IF NOT EXISTS interval_days integer,
  ADD COLUMN IF NOT EXISTS reference_date date;

ALTER TABLE public.sns_posting_rules
  ALTER COLUMN day_of_week DROP NOT NULL;
