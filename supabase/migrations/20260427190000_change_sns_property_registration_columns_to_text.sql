alter table public.sns_tiktok_properties
  alter column wp_registered type text using (
    case
      when wp_registered = true then '登録済'
      else ''
    end
  ),
  alter column aos_registered type text using (
    case
      when aos_registered = true then '登録済'
      else ''
    end
  ),
  alter column wp_registered set default '',
  alter column aos_registered set default '';

alter table public.sns_instagram_properties
  alter column wp_registered type text using (
    case
      when wp_registered = true then '登録済'
      else ''
    end
  ),
  alter column wp_registered set default '';

alter table public.sns_youtube_properties
  alter column wp_registered type text using (
    case
      when wp_registered = true then '登録済'
      else ''
    end
  ),
  alter column wp_registered set default '';
