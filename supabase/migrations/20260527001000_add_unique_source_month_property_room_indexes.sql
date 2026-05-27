create unique index if not exists sns_keihan_karilun_unique_source_month_property_room_idx
on public.sns_keihan_karilun_properties (source_month, property_name, room_number)
where source_month is not null and source_month <> '';

create unique index if not exists sns_nishinomiya_karilun_unique_source_month_property_room_idx
on public.sns_nishinomiya_karilun_properties (source_month, property_name, room_number)
where source_month is not null and source_month <> '';

create unique index if not exists sns_nagase_unique_source_month_property_room_idx
on public.sns_nagase_properties (source_month, property_name, room_number)
where source_month is not null and source_month <> '';

create unique index if not exists sns_nishikita_unique_source_month_property_room_idx
on public.sns_nishikita_properties (source_month, property_name, room_number)
where source_month is not null and source_month <> '';

create unique index if not exists sns_yao_unique_source_month_property_room_idx
on public.sns_yao_properties (source_month, property_name, room_number)
where source_month is not null and source_month <> '';
