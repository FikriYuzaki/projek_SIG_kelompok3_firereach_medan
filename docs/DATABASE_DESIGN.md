# Database Design: Supabase + PostGIS

Remote database migrations have **not been applied** because no remote Supabase project credentials exist in this repository. All schema definitions are prepared for local SQL/static review and future deployment by the project owner.

## 1. Spatial Extension & Schema Safety

Migration file: `supabase/migrations/20261119000001_initial_firereach_schema.sql`

- Installs `postgis` and `pgcrypto` inside the dedicated `extensions` schema (`create extension if not exists postgis with schema extensions;`), keeping `spatial_ref_sys` out of the exposed `public` Data API schema.
- Defines `public.set_updated_at()` as `security invoker` with `set search_path = ''`.
- Stores geometries explicitly in `EPSG:4326` (`extensions.geometry(Point, 4326)` and `extensions.geometry(MultiPolygon, 4326)`).

## 2. Conceptual Tables

| Table | Owner / Consumer | Geometry & SRID | Key Fields & Constraints |
|---|---|---|---|
| `data_sources` | Shared provenance | None | `source_code`, `dataset_name`, `category`, `publisher`, `source_url`, `access_date`, `period_label`, `granularity`, `sha256_hash` |
| `project_editors` | Auth allowlist | None | `user_id` (FK to `auth.users`), `module_scope` |
| `admin_areas` | Shared / Olo | `MultiPolygon, 4326` | `area_code`, `admin_level` (6/7/8), `district_name`, `population_2023`, `area_km2` |
| `fire_incidents` | Fikri / Adeptri | `Point, 4326` (nullable) | `source_record_id`, `occurred_at`, `period_year`, `address_text`, `district_name`, `subdistrict_name`, `object_type`, `cause_category`, `location_accuracy`, `verification_status`, `source_name`, `source_url` |
| `fire_stations` | Adriel | `Point, 4326` (nullable) | `station_code`, `name`, `station_type`, `address`, `verification_status`, `verified_at` |
| `hotspot_analyses` / `hotspot_zones` | Adeptri | `MultiPolygon, 4326` | `kernel_method`, `bandwidth_meters`, `pixel_size_meters`, `working_crs`, `classification_method`, `is_demo` |
| `station_coverage_analyses` / `station_coverage_zones` | Adriel | `MultiPolygon, 4326` | `method_type`, `road_extract_date`, `assumed_speed_kmh`, `threshold_value`, `threshold_unit`, `disclaimer`, `is_demo` |
| `priority_analyses` / `priority_zones` | Olo | `MultiPolygon, 4326` | `method_version`, `analysis_unit`, `weights_json`, `hotspot_score`, `coverage_gap_score`, `population_exposure_score`, `composite_score`, `priority_tier`, `priority_reason`, `is_demo` |

Notes on `fire_incidents`:
- `geom` is explicitly nullable so records with `district_only` or `unknown` location remain stored and inspectable without inventing points.
- `location_accuracy` checks: `exact_verified`, `address_geocoded_verified`, `approximate`, `district_only`, `unknown`.
- `verification_status` checks: `verified`, `needs_review`, `unlocated`.

## 3. Indexes

- Spatial GiST indexes (`using gist (geom)`) on `admin_areas`, `fire_incidents` (partial `where geom is not null`), `fire_stations` (partial `where geom is not null`), `hotspot_zones`, `station_coverage_zones`, and `priority_zones`.
- B-tree indexes on foreign keys (`source_id`, `analysis_id`, `station_id`, `admin_area_id`), `(period_year, district_name)`, `(verification_status, location_accuracy)`, and `occurred_at desc`.

## 4. Row Level Security (RLS) Policy Model

- RLS is enabled (`enable row level security`) on **every** table in `public`.
- Public read tables allow `for select to anon, authenticated using (true)` so the public Web GIS dashboard works read-only.
- `project_editors` restricts `select` strictly to `(select auth.uid()) = user_id`.
- Write policies (`insert`, `update`, `delete`) on spatial tables are granted strictly `to authenticated` and checked against `public.project_editors` with `(select auth.uid())` scalar subquery wrapping and module-scope authorization. No `allow all` write policy or deprecated `auth.role()` helper is used.

## 5. Local Verification Instructions

Once Supabase CLI and Docker are available locally:
```bash
supabase start
supabase db reset
supabase db advisors
```
Do not run `supabase db push` or remote migrations without explicit project owner approval and credentials.
