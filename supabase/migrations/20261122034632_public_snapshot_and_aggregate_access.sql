create table if not exists public.app_data_snapshots (
  snapshot_key text primary key,
  dataset_status text not null check (dataset_status in ('verified', 'provisional', 'fallback_osm', 'unavailable')),
  payload jsonb not null,
  source_metadata jsonb not null default '{}'::jsonb,
  content_sha256 text,
  published_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.app_data_snapshots enable row level security;
create policy "Public read access for app data snapshots"
  on public.app_data_snapshots for select to anon, authenticated using (true);

create table if not exists public.fire_incident_aggregates (
  id uuid primary key default gen_random_uuid(),
  aggregate_key text not null unique,
  aggregate_type text not null check (aggregate_type in ('district_aggregate', 'monthly_aggregate', 'annual_aggregate')),
  period_year smallint not null check (period_year between 2010 and 2100),
  period_month smallint check (period_month between 1 and 12),
  area_code text,
  district_name text,
  total_incidents integer not null check (total_incidents >= 0),
  categories jsonb not null default '{}'::jsonb,
  location_accuracy text not null check (location_accuracy in ('district_only', 'unknown')),
  verification_status text not null check (verification_status in ('needs_review', 'unlocated')),
  source_name text not null,
  source_url text not null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ck_aggregate_district_key check (
    (aggregate_type = 'district_aggregate' and area_code is not null and period_month is null)
    or (aggregate_type = 'monthly_aggregate' and area_code is null and period_month is not null)
    or (aggregate_type = 'annual_aggregate' and area_code is null and period_month is null)
  )
);
alter table public.fire_incident_aggregates enable row level security;
create policy "Public read access for fire incident aggregates"
  on public.fire_incident_aggregates for select to anon, authenticated using (true);
create index if not exists idx_fire_incident_aggregates_period on public.fire_incident_aggregates (period_year, period_month);
create index if not exists idx_fire_incident_aggregates_area on public.fire_incident_aggregates (area_code);

alter table public.admin_areas
  add column if not exists population_2025 integer check (population_2025 is null or population_2025 >= 0),
  add column if not exists population_density_2025 numeric(12,2) check (population_density_2025 is null or population_density_2025 >= 0),
  add column if not exists boundary_source text not null default 'unknown';

-- Browser clients are read-only. Curated inserts and updates stay server-side.
revoke all privileges on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.data_sources, public.admin_areas, public.fire_incidents, public.fire_stations,
  public.hotspot_analyses, public.hotspot_zones, public.station_coverage_analyses,
  public.station_coverage_zones, public.priority_analyses, public.priority_zones,
  public.app_data_snapshots, public.fire_incident_aggregates to anon, authenticated;
grant select on public.project_editors to authenticated;
