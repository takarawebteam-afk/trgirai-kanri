CREATE TABLE IF NOT EXISTS public.analysis_tiktok_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  account text NOT NULL,
  metric text NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, month, account, metric)
);

ALTER TABLE public.analysis_tiktok_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all" ON public.analysis_tiktok_metrics;
CREATE POLICY "anon_all" ON public.analysis_tiktok_metrics
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
