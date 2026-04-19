-- task_items テーブルに memo と work_date カラムを追加
-- Supabase の SQL Editor でこのファイルを実行してください

ALTER TABLE public.task_items
  ADD COLUMN IF NOT EXISTS memo      text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS work_date date;
