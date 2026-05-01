alter table public.sns_keihan_karilun_properties enable row level security;
create policy "anon_all" on public.sns_keihan_karilun_properties for all to anon using (true) with check (true);

alter table public.sns_nishinomiya_karilun_properties enable row level security;
create policy "anon_all" on public.sns_nishinomiya_karilun_properties for all to anon using (true) with check (true);

alter table public.sns_nagase_properties enable row level security;
create policy "anon_all" on public.sns_nagase_properties for all to anon using (true) with check (true);

alter table public.sns_nishikita_properties enable row level security;
create policy "anon_all" on public.sns_nishikita_properties for all to anon using (true) with check (true);

alter table public.sns_yao_properties enable row level security;
create policy "anon_all" on public.sns_yao_properties for all to anon using (true) with check (true);
