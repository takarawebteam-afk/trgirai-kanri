-- Enable RLS on sns_posting_rules (was disabled = fully public). Match anon_all pattern used by other tables.
ALTER TABLE public.sns_posting_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.sns_posting_rules;
CREATE POLICY "anon_all" ON public.sns_posting_rules FOR ALL TO anon USING (true) WITH CHECK (true);
