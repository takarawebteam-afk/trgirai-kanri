CREATE TABLE IF NOT EXISTS public.analysis_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  account text NOT NULL,
  media text NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  sessions integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, account, media, month)
);

ALTER TABLE public.analysis_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all" ON public.analysis_sessions;
CREATE POLICY "anon_all" ON public.analysis_sessions
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
