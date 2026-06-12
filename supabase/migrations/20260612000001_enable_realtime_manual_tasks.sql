do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'manual_tasks'
  ) then
    alter publication supabase_realtime add table public.manual_tasks;
  end if;
end $$;
