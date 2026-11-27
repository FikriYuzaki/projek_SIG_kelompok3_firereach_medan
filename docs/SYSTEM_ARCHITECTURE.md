# System Architecture: FireReach Medan

## 1. End-to-End Flow

FireReach Medan connects desktop GIS analysis, PostGIS spatial storage, static verified open datasets, and a modular Vite web shell:

```text
Official, Public & OSM Sources
(Satu Data Medan, BPS, Portal Damkarmat/Media Publik, Geofabrik OSM)
        |
        v
QGIS Desktop Processing (CRS: EPSG:32647 UTM 47N)
& Reproducible Python Validation Scripts
        |
        +---> Validated GeoJSON / JSON (EPSG:4326) ---> public/data/ (Local-first fallback)
        |
        +---> Curated PostGIS Tables (SRID 4326) ---> Supabase Postgres + RLS
                                                            |
                                                            v
Browser Client (Vite + Vanilla JS ES Modules)
  |- Shell (Layout, Router, Feature Registry, Shared Services)
  |- Leaflet 2D Primary Map + Chart.js + Canvas/SVG 2D Response Simulation
  |- Modules: incident-explorer (Fikri), hotspot-analyzer (Adeptri),
              station-coverage (Adriel), priority-planner (Olo)
```

## 2. Frontend Architecture

1. **Application Shell (`src/core/layout.js`, `src/router/`)**:
   - Owns top bar, navigation rail / mobile drawer, route matching, and `<main>` focus management.
   - Awaits the previous route's `unmount()` cleanup before loading and mounting the next module.
2. **Feature Registry (`src/core/feature-registry.js`)**:
   - Single authoritative registry listing all four modules, owners, routes, and activation states (all 4 modules set to `active` for production release `2026-11-27-prod`).
   - Supports guarded fallback routes via `src/components/coming-soon.js` if any module is ever temporarily disabled in maintenance.
3. **Shared Services (`src/core/`)**:
   - `supabase.js`: Safe `@supabase/supabase-js` client initialized strictly from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, falling back cleanly to local-only mode when unconfigured.
   - `map/index.js`: Shared Leaflet factory defaulting to Kota Medan (`3.5952, 98.6722`) with lifecycle tracking so every map instance is destroyed on `unmount()`.
   - `charts.js`: Shared Chart.js wrapper registering only required chart controllers and tracking active instances for cleanup.
   - `data-status.js`: Reads published dataset snapshots (`manifest`, `fire_incidents_summary`, `medan_districts_osm`, `station_coverage_provisional`, `priority_planner_provisional`) from Supabase `public.app_data_snapshots` with automatic schema verification (`release_version: 2026-11-27-prod`, `34` public incidents, `per_station_coverage`, `priority-v2.0-integrated`) and fallback to `public/data/` static files (`hotspot-analyzer.exploratory.geojson` is also read from `public/data/`). Runtime `DEMO` fixtures do not exist in `public/data/`; `data/fixtures/demo/` is retained strictly for unit contract tests.

## 3. Spatial Visualization & Simulation Scope

Leaflet 2D remains the sole spatial analysis map across all four modules. Prior Three.js preview scaffolding was removed ahead of release `2026-11-27-prod`, and interactive dispatch simulation in `src/features/incident-explorer/response-simulation.js` renders directly over Leaflet with Canvas 2D animation and an automatic SVG 2D fallback (`src/features/incident-explorer/response-router.js`, `response-audio.js`).

## 4. Local-Only vs Supabase Mode

- **Connected Supabase Mode**: The remote Supabase project (`firereach-medan`) is provisioned and migrations `20261122034552_initial_firereach_schema.sql` and `20261122034632_public_snapshot_and_aggregate_access.sql` are applied to the remote database (tracked in Git strictly for version control without secrets). Frontend clients use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only, with read-only (`SELECT`) browser access under Row Level Security and automatic fallback to `public/data/`.
- **Local-Only Fallback Mode**: When `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` is empty (for example in unconfigured local setups), the application serves validated files from `public/data/` and labels connection status honestly as `Mode Lokal (tanpa Supabase)`.
