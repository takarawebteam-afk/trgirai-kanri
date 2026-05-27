alter table public.sns_keihan_karilun_properties
  add column if not exists source_month text;

alter table public.sns_nishinomiya_karilun_properties
  add column if not exists source_month text;

alter table public.sns_nagase_properties
  add column if not exists source_month text;

alter table public.sns_nishikita_properties
  add column if not exists source_month text;

alter table public.sns_yao_properties
  add column if not exists source_month text;

create index if not exists sns_keihan_karilun_source_month_property_room_idx
on public.sns_keihan_karilun_properties (source_month, property_name, room_number);

create index if not exists sns_nishinomiya_karilun_source_month_property_room_idx
on public.sns_nishinomiya_karilun_properties (source_month, property_name, room_number);

create index if not exists sns_nagase_source_month_property_room_idx
on public.sns_nagase_properties (source_month, property_name, room_number);

create index if not exists sns_nishikita_source_month_property_room_idx
on public.sns_nishikita_properties (source_month, property_name, room_number);

create index if not exists sns_yao_source_month_property_room_idx
on public.sns_yao_properties (source_month, property_name, room_number);
