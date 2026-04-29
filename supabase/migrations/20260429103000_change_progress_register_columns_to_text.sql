alter table public.production_records
  alter column wp_registered type text using (
    case
      when wp_registered = true then '登録済'
      else '未登録'
    end
  ),
  alter column aos_registered type text using (
    case
      when aos_registered = true then '登録済'
      else '未登録'
    end
  ),
  alter column youtube_reserved type text using (
    case
      when youtube_reserved = true then '登録済'
      else '未登録'
    end
  ),
  alter column wp_registered set default '未登録',
  alter column aos_registered set default '未登録',
  alter column youtube_reserved set default '未登録';
