-- sns_recruitment_propertiesテーブルに新カラムを追加
alter table public.sns_recruitment_properties
  add column if not exists tiktok_reserved text default '',
  add column if not exists instagram_reserved text default '';

-- 既存の post_reserved からデータを移行する
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sns_recruitment_properties'
      and column_name = 'post_reserved'
  ) then
    update public.sns_recruitment_properties
      set tiktok_reserved = post_reserved
      where tiktok_reserved = '' or tiktok_reserved is null;
  end if;
end $$;
