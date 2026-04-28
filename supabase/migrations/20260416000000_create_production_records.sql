-- 動画制作進捗管理テーブル
-- Supabase のダッシュボード (SQL Editor) でこのファイルを実行してください

create table if not exists production_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- 基本情報
  status text not null default '撮影済',         -- 撮影済 / 制作中 / チェック中 / 完了
  shooting_date date,                             -- 撮影日
  scheduled_post_date date,                       -- 投稿予定日
  aos_registered boolean not null default false,  -- AOS登録
  media text not null default 'TikTok',           -- 媒体
  property_name text not null default '',         -- 物件名
  floor_plan text not null default '',            -- 間取り
  rent text not null default '',                  -- 賃料
  area text not null default '',                  -- エリア
  nearest_station text not null default '',       -- 最寄駅
  assignee text not null default '',              -- 担当者
  device text not null default '',                -- 使用デバイス
  property_url text not null default '',          -- 物件資料URL

  -- 仕上げ（チェックボックス）
  wp_registered boolean not null default false,   -- WP登録
  post_completed boolean not null default false,  -- 投稿完了

  -- 制作工程（未着手 / 進行中 / 完了）
  material_processing text not null default '未着手',  -- 素材加工
  text_overlay text not null default '未着手',         -- 文字入れ
  video_duration text not null default '',             -- 動画尺（テキスト）
  afureko text not null default '未着手',              -- アフレコ
  floor_plan_insert text not null default '未着手',    -- 図面挿入

  -- チェック
  floor_plan_check text not null default '未着手',     -- 図面確認
  countermeasure text not null default '',             -- 対策内容
  memo text not null default '',                       -- メモ

  -- 仕上げ工程
  final_save text not null default '未着手',           -- 完成品保存
  post_text text not null default ''                   -- 投稿文
);

-- RLS（既存テーブルに合わせて無効にする場合はこちらを使用）
-- alter table production_records disable row level security;
