ALTER TABLE public.task_items
  ADD COLUMN IF NOT EXISTS recurring_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurring_template_id text,
  ADD COLUMN IF NOT EXISTS recurring_parent_template_id text,
  ADD COLUMN IF NOT EXISTS recurring_generation_month text,
  ADD COLUMN IF NOT EXISTS recurring_due_day integer,
  ADD COLUMN IF NOT EXISTS recurring_due_rule text,
  ADD COLUMN IF NOT EXISTS recurring_work_day integer,
  ADD COLUMN IF NOT EXISTS recurring_work_rule text,
  ADD COLUMN IF NOT EXISTS recurring_instance_key text;

CREATE UNIQUE INDEX IF NOT EXISTS task_items_recurring_instance_key
  ON public.task_items(recurring_instance_key)
  WHERE recurring_instance_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS task_items_recurring_template_month_idx
  ON public.task_items(recurring_template_id, recurring_generation_month);
