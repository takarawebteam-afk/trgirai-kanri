do $$
declare
  t text;
begin
  foreach t in array array[
    'hankyo','dm','jisha_shukyaku','busho_schedules','members','stock','task_items',
    'production_records','analysis_sessions','analysis_tiktok_metrics','analysis_insta_metrics',
    'analysis_threads_metrics','analysis_youtube_metrics','tiktok_insight_months'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
