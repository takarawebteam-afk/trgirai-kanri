-- Enable RLS and grant anon full access on all public tables that had rowsecurity=false.
-- These are internal management tables accessed directly by the frontend (anon key).
-- The primary access control is the OfficeNetworkGate (IP restriction).
-- Enabling RLS here allows future policy hardening without breaking existing functionality.

-- allowed_accounts
ALTER TABLE public.allowed_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.allowed_accounts FOR ALL TO anon USING (true) WITH CHECK (true);

-- busho_schedules
ALTER TABLE public.busho_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.busho_schedules FOR ALL TO anon USING (true) WITH CHECK (true);

-- checked_events
ALTER TABLE public.checked_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.checked_events FOR ALL TO anon USING (true) WITH CHECK (true);

-- hankyo
ALTER TABLE public.hankyo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.hankyo FOR ALL TO anon USING (true) WITH CHECK (true);

-- jisha_shukyaku
ALTER TABLE public.jisha_shukyaku ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.jisha_shukyaku FOR ALL TO anon USING (true) WITH CHECK (true);

-- manual_tasks
ALTER TABLE public.manual_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.manual_tasks FOR ALL TO anon USING (true) WITH CHECK (true);

-- members
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.members FOR ALL TO anon USING (true) WITH CHECK (true);

-- production_records
ALTER TABLE public.production_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.production_records FOR ALL TO anon USING (true) WITH CHECK (true);

-- sns_instagram_properties
ALTER TABLE public.sns_instagram_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.sns_instagram_properties FOR ALL TO anon USING (true) WITH CHECK (true);

-- sns_tiktok_properties
ALTER TABLE public.sns_tiktok_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.sns_tiktok_properties FOR ALL TO anon USING (true) WITH CHECK (true);

-- sns_youtube_properties
ALTER TABLE public.sns_youtube_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.sns_youtube_properties FOR ALL TO anon USING (true) WITH CHECK (true);

-- stock
ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.stock FOR ALL TO anon USING (true) WITH CHECK (true);

-- task_items
ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON public.task_items FOR ALL TO anon USING (true) WITH CHECK (true);
