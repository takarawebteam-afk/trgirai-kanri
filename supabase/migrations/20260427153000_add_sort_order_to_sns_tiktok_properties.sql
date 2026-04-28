alter table public.sns_tiktok_properties
add column if not exists sort_order integer;

with ordered_rows as (
  select id, row_number() over (order by created_at asc, id asc) - 1 as next_sort_order
  from public.sns_tiktok_properties
)
update public.sns_tiktok_properties as target
set sort_order = ordered_rows.next_sort_order
from ordered_rows
where target.id = ordered_rows.id
  and target.sort_order is null;

create index if not exists sns_tiktok_properties_sort_order_idx
on public.sns_tiktok_properties (sort_order, created_at);
