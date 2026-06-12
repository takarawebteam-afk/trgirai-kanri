do $$
declare
  t text;
begin
  foreach t in array array[
    'sns_tiktok_properties','sns_instagram_properties','sns_youtube_properties',
    'sns_recruitment_properties','sns_keihan_karilun_properties','sns_nishinomiya_karilun_properties',
    'sns_nagase_properties','sns_nishikita_properties','sns_yao_properties',
    'sns_property_select_options',
    'manual_pages','manual_sections','manual_categories','manual_page_categories','manual_page_allowed_accounts'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
