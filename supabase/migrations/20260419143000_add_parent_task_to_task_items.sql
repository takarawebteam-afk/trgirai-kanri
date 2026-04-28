ALTER TABLE public.task_items
  ADD COLUMN IF NOT EXISTS parent_task_id text NULL;

ALTER TABLE public.task_items
  DROP COLUMN IF EXISTS detail;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_items_parent_task_id_fkey'
  ) THEN
    ALTER TABLE public.task_items
      ADD CONSTRAINT task_items_parent_task_id_fkey
      FOREIGN KEY (parent_task_id)
      REFERENCES public.task_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_items_parent_task_id
  ON public.task_items(parent_task_id);
