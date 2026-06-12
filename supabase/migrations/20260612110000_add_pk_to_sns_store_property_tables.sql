-- Realtimeの更新エラーを防ぐため、idを主キーにする。
-- 主キーがない表をRealtime配信に入れると、更新時にエラーになることがある:
-- cannot update table ... because it does not have a replica identity and publishes updates
do $$
declare
  target_table regclass;
begin
  foreach target_table in array array[
    'public.sns_nagase_properties'::regclass,
    'public.sns_nishikita_properties'::regclass,
    'public.sns_nishinomiya_karilun_properties'::regclass,
    'public.sns_yao_properties'::regclass
  ] loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = target_table
        and contype = 'p'
    ) then
      execute format('alter table %s add primary key (id)', target_table);
    end if;
  end loop;
end $$;
