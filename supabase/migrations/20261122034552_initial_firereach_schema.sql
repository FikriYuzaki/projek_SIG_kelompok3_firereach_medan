-- FireReach Medan initial spatial schema (local review ready; not applied to remote)
-- Follows Supabase PostGIS & Postgres best practices:
-- - PostGIS installed in dedicated extensions schema
-- - Explicit SRID 4326 geometry columns + GiST spatial indexes
-- - Row Level Security enabled on every public table without allow-all write shortcuts

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Authorized project editors allowed to mutate curated spatial records
create table if not exists public.project_editors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  module_scope text not null check (module_scope in ('all', 'incident-explorer', 'hotspot-analyzer', 'station-coverage', 'priority-planner')),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.project_editors enable row level security;

create policy "Editors can view their own editor record"
  on public.project_editors
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Source provenance register mirrored from data/metadata/source-register.csv
create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  source_code text not null unique,
  dataset_name text not null,
  category text not null check (category in ('fire_incidents', 'fire_stations', 'admin_boundaries', 'road_network', 'population', 'service_standards')),
  publisher text not null,
  source_url text not null,
  access_date date not null,
  period_label text not null,
  license_label text not null,
  granularity text not null check (granularity in ('individual', 'district_aggregate', 'monthly_aggregate', 'polygon', 'network', 'station_point', 'policy_table')),
  sha256_hash text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trg_data_sources_updated_at
  before update on public.data_sources
  for each row execute function public.set_updated_at();

alter table public.data_sources enable row level security;

create policy "Public read access for data sources"
  on public.data_sources
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert data sources"
  on public.data_sources
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())));

create policy "Authorized editors update data sources"
  on public.data_sources
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())));

create policy "Authorized editors delete data sources"
  on public.data_sources
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())));

-- Administrative areas (Kota Medan and 21 Kecamatan)
create table if not exists public.admin_areas (
  id uuid primary key default gen_random_uuid(),
  area_code text not null unique,
  admin_level smallint not null check (admin_level in (6, 7, 8)),
  district_name text not null,
  subdistrict_name text,
  population_2023 integer check (population_2023 is null or population_2023 >= 0),
  population_density_km2 numeric(12, 2),
  area_km2 numeric(12, 4),
  source_id uuid references public.data_sources(id) on delete set null,
  source_name text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_areas_geom on public.admin_areas using gist (geom);
create index if not exists idx_admin_areas_district on public.admin_areas (district_name);
create index if not exists idx_admin_areas_source_id on public.admin_areas (source_id);

create trigger trg_admin_areas_updated_at
  before update on public.admin_areas
  for each row execute function public.set_updated_at();

alter table public.admin_areas enable row level security;

create policy "Public read access for admin areas"
  on public.admin_areas
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert admin areas"
  on public.admin_areas
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())));

create policy "Authorized editors update admin areas"
  on public.admin_areas
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())));

create policy "Authorized editors delete admin areas"
  on public.admin_areas
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid())));

-- Fire incident records (Fikri: Incident Explorer)
-- geom is explicitly nullable for unlocated or district_only records
create table if not exists public.fire_incidents (
  id uuid primary key default gen_random_uuid(),
  source_record_id text not null,
  occurred_at timestamptz,
  period_year smallint not null check (period_year between 2010 and 2100),
  period_month smallint check (period_month between 1 and 12),
  address_text text,
  district_name text,
  subdistrict_name text,
  object_type text,
  cause_category text,
  location_accuracy text not null check (location_accuracy in ('exact_verified', 'address_geocoded_verified', 'approximate', 'district_only', 'unknown')),
  verification_status text not null check (verification_status in ('verified', 'needs_review', 'unlocated')),
  source_id uuid references public.data_sources(id) on delete set null,
  source_name text not null,
  source_url text not null,
  geom extensions.geometry(Point, 4326),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint uq_fire_incidents_source_record unique (source_name, source_record_id)
);

create index if not exists idx_fire_incidents_geom on public.fire_incidents using gist (geom) where geom is not null;
create index if not exists idx_fire_incidents_period_district on public.fire_incidents (period_year, district_name);
create index if not exists idx_fire_incidents_status on public.fire_incidents (verification_status, location_accuracy);
create index if not exists idx_fire_incidents_occurred_at on public.fire_incidents (occurred_at desc);
create index if not exists idx_fire_incidents_source_id on public.fire_incidents (source_id);

create trigger trg_fire_incidents_updated_at
  before update on public.fire_incidents
  for each row execute function public.set_updated_at();

alter table public.fire_incidents enable row level security;

create policy "Public read access for fire incidents"
  on public.fire_incidents
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert fire incidents"
  on public.fire_incidents
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'incident-explorer')));

create policy "Authorized editors update fire incidents"
  on public.fire_incidents
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'incident-explorer')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'incident-explorer')));

create policy "Authorized editors delete fire incidents"
  on public.fire_incidents
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'incident-explorer')));

-- Fire station locations (Adriel: Station Coverage)
create table if not exists public.fire_stations (
  id uuid primary key default gen_random_uuid(),
  station_code text not null unique,
  name text not null,
  station_type text not null check (station_type in ('mako', 'upt', 'pos_bantu')),
  address text not null,
  district_name text,
  geom extensions.geometry(Point, 4326),
  source_name text not null,
  source_url text not null,
  verification_status text not null check (verification_status in ('verified', 'needs_review', 'unlocated')),
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_fire_stations_geom on public.fire_stations using gist (geom) where geom is not null;
create index if not exists idx_fire_stations_status on public.fire_stations (verification_status);

create trigger trg_fire_stations_updated_at
  before update on public.fire_stations
  for each row execute function public.set_updated_at();

alter table public.fire_stations enable row level security;

create policy "Public read access for fire stations"
  on public.fire_stations
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert fire stations"
  on public.fire_stations
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create policy "Authorized editors update fire stations"
  on public.fire_stations
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create policy "Authorized editors delete fire stations"
  on public.fire_stations
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

-- Hotspot analysis metadata and zones (Adeptri: Hotspot Analyzer)
create table if not exists public.hotspot_analyses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_label text not null,
  kernel_method text not null,
  bandwidth_meters numeric(10, 2) not null check (bandwidth_meters > 0),
  pixel_size_meters numeric(10, 2) not null check (pixel_size_meters > 0),
  working_crs text not null default 'EPSG:32647',
  classification_method text not null,
  incident_count_used integer not null check (incident_count_used >= 0),
  is_demo boolean not null default false,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.hotspot_analyses enable row level security;

create policy "Public read access for hotspot analyses"
  on public.hotspot_analyses
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert hotspot analyses"
  on public.hotspot_analyses
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')));

create policy "Authorized editors update hotspot analyses"
  on public.hotspot_analyses
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')));

create policy "Authorized editors delete hotspot analyses"
  on public.hotspot_analyses
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')));

create table if not exists public.hotspot_zones (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.hotspot_analyses(id) on delete cascade,
  density_class text not null,
  density_rank smallint not null,
  density_min numeric(14, 6),
  density_max numeric(14, 6),
  area_km2 numeric(12, 4),
  geom extensions.geometry(MultiPolygon, 4326) not null
);

create index if not exists idx_hotspot_zones_geom on public.hotspot_zones using gist (geom);
create index if not exists idx_hotspot_zones_analysis_id on public.hotspot_zones (analysis_id);

alter table public.hotspot_zones enable row level security;

create policy "Public read access for hotspot zones"
  on public.hotspot_zones
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert hotspot zones"
  on public.hotspot_zones
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')));

create policy "Authorized editors update hotspot zones"
  on public.hotspot_zones
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')));

create policy "Authorized editors delete hotspot zones"
  on public.hotspot_zones
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'hotspot-analyzer')));

-- Station coverage analysis metadata and zones (Adriel: Station Coverage)
create table if not exists public.station_coverage_analyses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  method_type text not null check (method_type in ('network_service_area', 'euclidean_buffer_comparison')),
  road_extract_date date,
  assumed_speed_kmh numeric(6, 2),
  threshold_label text not null,
  working_crs text not null default 'EPSG:32647',
  is_demo boolean not null default false,
  disclaimer text not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.station_coverage_analyses enable row level security;

create policy "Public read access for station coverage analyses"
  on public.station_coverage_analyses
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert station coverage analyses"
  on public.station_coverage_analyses
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create policy "Authorized editors update station coverage analyses"
  on public.station_coverage_analyses
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create policy "Authorized editors delete station coverage analyses"
  on public.station_coverage_analyses
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create table if not exists public.station_coverage_zones (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.station_coverage_analyses(id) on delete cascade,
  station_id uuid references public.fire_stations(id) on delete set null,
  coverage_tier text not null,
  threshold_value numeric(10, 2) not null,
  threshold_unit text not null check (threshold_unit in ('meters', 'minutes')),
  geom extensions.geometry(MultiPolygon, 4326) not null
);

create index if not exists idx_coverage_zones_geom on public.station_coverage_zones using gist (geom);
create index if not exists idx_coverage_zones_analysis_id on public.station_coverage_zones (analysis_id);
create index if not exists idx_coverage_zones_station_id on public.station_coverage_zones (station_id);

alter table public.station_coverage_zones enable row level security;

create policy "Public read access for station coverage zones"
  on public.station_coverage_zones
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert station coverage zones"
  on public.station_coverage_zones
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create policy "Authorized editors update station coverage zones"
  on public.station_coverage_zones
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

create policy "Authorized editors delete station coverage zones"
  on public.station_coverage_zones
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'station-coverage')));

-- Priority planner analyses and zones (Olo: Priority Planner)
create table if not exists public.priority_analyses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  method_version text not null,
  period_label text not null,
  analysis_unit text not null check (analysis_unit in ('kecamatan', 'kelurahan')),
  weights_json jsonb not null,
  is_demo boolean not null default false,
  rationale text not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.priority_analyses enable row level security;

create policy "Public read access for priority analyses"
  on public.priority_analyses
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert priority analyses"
  on public.priority_analyses
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')));

create policy "Authorized editors update priority analyses"
  on public.priority_analyses
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')));

create policy "Authorized editors delete priority analyses"
  on public.priority_analyses
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')));

create table if not exists public.priority_zones (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.priority_analyses(id) on delete cascade,
  admin_area_id uuid references public.admin_areas(id) on delete set null,
  area_name text not null,
  hotspot_score numeric(8, 4) not null,
  coverage_gap_score numeric(8, 4) not null,
  population_exposure_score numeric(8, 4) not null,
  composite_score numeric(8, 4) not null,
  priority_tier text not null check (priority_tier in ('Sangat Tinggi', 'Tinggi', 'Sedang', 'Rendah')),
  priority_reason text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null
);

create index if not exists idx_priority_zones_geom on public.priority_zones using gist (geom);
create index if not exists idx_priority_zones_analysis_id on public.priority_zones (analysis_id);
create index if not exists idx_priority_zones_admin_area_id on public.priority_zones (admin_area_id);

alter table public.priority_zones enable row level security;

create policy "Public read access for priority zones"
  on public.priority_zones
  for select
  to anon, authenticated
  using (true);

create policy "Authorized editors insert priority zones"
  on public.priority_zones
  for insert
  to authenticated
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')));

create policy "Authorized editors update priority zones"
  on public.priority_zones
  for update
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')))
  with check (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')));

create policy "Authorized editors delete priority zones"
  on public.priority_zones
  for delete
  to authenticated
  using (exists (select 1 from public.project_editors pe where pe.user_id = (select auth.uid()) and pe.module_scope in ('all', 'priority-planner')));
