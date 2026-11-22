# System Architecture: FireReach Medan

## 1. End-to-End Flow

FireReach Medan connects desktop GIS analysis, PostGIS spatial storage, static verified open datasets, and a modular Vite web shell:

```text
Official & OSM Sources
(Satu Data Medan, BPS, Geofabrik OSM, Field Verification)
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
  |- Leaflet 2D Primary Map + Chart.js + Bounded Three.js Mini Preview
  |- Modules: incident-explorer (Fikri), hotspot-analyzer (Adeptri),
              station-coverage (Adriel), priority-planner (Olo)
```

## 2. Frontend Architecture

1. **Application Shell (`src/core/layout.js`, `src/router/`)**:
   - Owns top bar, navigation rail / mobile drawer, route matching, and `<main>` focus management.
   - Awaits the previous route's `unmount()` cleanup before loading and mounting the next module.
2. **Feature Registry (`src/core/feature-registry.js`)**:
   - Single authoritative registry listing all four modules, owners, routes, and activation states (`coming-soon`, `in-development`, `ready-for-review`, `active`, `blocked`).
   - Prevents unfinished modules from being mounted prematurely by routing `coming-soon` / `blocked` items to `src/components/coming-soon.js`.
3. **Shared Services (`src/core/`)**:
   - `supabase.js`: Safe `@supabase/supabase-js` client initialized strictly from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, falling back cleanly to local-only mode when unconfigured.
   - `map/index.js`: Shared Leaflet factory defaulting to Kota Medan (`3.5952, 98.6722`) with lifecycle tracking so every map instance is destroyed on `unmount()`.
   - `charts.js`: Shared Chart.js wrapper registering only required chart controllers and tracking active instances for cleanup.
   - `data-status.js`: Reads `/data/manifest.json` to present verified dataset counts, periods, granularity, and source blockers consistently across Dashboard, Explorer, and About views.

## 3. Three.js Bounded Role

Leaflet 2D remains the sole spatial analysis map. `src/components/three-preview.js` provides a compact schematic object massing preview (for residential, commercial, warehouse, land/vegetation, or station structures) with explicit Play/Pause control, clean WebGL disposal, and an automatic 2D SVG schematic fallback whenever WebGL is unavailable.

## 4. Local-Only vs Supabase Mode

- **Local-Only Mode (Current Default)**: When `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` is empty, the application serves validated files from `public/data/` and labels connection status honestly as `Mode Lokal (tanpa Supabase)`.
- **Connected Supabase Mode**: Once the project owner provisions Supabase and applies `supabase/migrations/20261122034552_initial_firereach_schema.sql` and `supabase/migrations/20261122034632_public_snapshot_and_aggregate_access.sql`, modules query curated `public.*` tables using the publishable key under Row Level Security.
