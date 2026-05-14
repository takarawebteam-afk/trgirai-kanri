CREATE TABLE IF NOT EXISTS public.sns_posting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_platform_key text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_platform_key, day_of_week)
);
