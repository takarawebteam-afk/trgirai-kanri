-- Add 種別 (category) column to TikTok properties so SNS物件管理/進捗管理 can store it
ALTER TABLE public.sns_tiktok_properties
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '';
