-- DM管理廃止に伴い、既存環境のDM記録テーブルを削除します。
drop table if exists public.dm cascade;
