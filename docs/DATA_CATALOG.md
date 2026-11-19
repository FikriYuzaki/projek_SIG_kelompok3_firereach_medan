# Data Catalog: FireReach Medan

Full provenance metadata lives in `data/metadata/source-register.csv`, schemas in `data/metadata/data-dictionary.md`, and anomaly findings in `data/metadata/qa-report.md`.

## 1. Acquired & Validated Datasets

| Category | Dataset | Period | Granularity | Status | Primary File |
|---|---|---|---|---|---|
| Fire Incidents (2024) | Rekapitulasi Data Kejadian Kebakaran 2024 | Jan - Dec 2024 | Monthly x 8 object categories (`269` events) | Acquired & Validated | `public/data/fire_incidents_summary.json` |
| Fire Incidents (2025) | Rekapitulasi Data Kejadian Kebakaran 2025 | Jan - Dec 2025 | Monthly x 8 object categories (`251` events) | Acquired & Validated | `public/data/fire_incidents_summary.json` |
| Fire Incidents (2023) | Rekapitulasi Kebakaran & Skala per Kecamatan 2023 | 2023 | 21 Kecamatan (`219` events) | Acquired & Validated | `public/data/fire_incidents_summary.json` |
| Fire Incidents (2016-2022) | Rekapitulasi Tahunan & Bulanan 2016-2022 | 2016 - 2022 | Annual / Monthly | Acquired | `data/raw/satudata-medan/` |
| Fire Station HQ | Knowledge Informasi Damkarmat (Mako 0.0) | 2025 - 2026 | Verified point (`3.589536, 98.671447`) | Acquired & Verified | `public/data/fire_incidents_summary.json` |
| Admin Boundaries | Batas 21 Kecamatan Kota Medan (OSM Fallback) | 2026-11-19 | 21 Kecamatan polygons (`EPSG:4326`) | OSM Fallback (ODbL) | `public/data/medan_districts_osm.geojson` |
| Population (2022-2025) | Penduduk, Kepadatan, Distribusi per Kecamatan | 2022 - 2025 | 21 Kecamatan (`2,498,293` in 2025) | Acquired & Validated | `data/processed/medan_population_2022_2025.csv` |

## 2. Metadata-Only or Blocked Sources

| Source | URL | Status & Blocker | Next Action |
|---|---|---|---|
| Damkarmat UPT Infografis & Berita | `https://p2k.medan.go.id/berita/Infografis-Letak-Pos-Damkarmat-Kota-Medan.html` | **Blocked** (`HTTP 403` Cloudflare challenge) | Adriel to open in desktop browser manually and verify each UPT coordinate |
| Geoportal Kota Medan | `https://geoportal.medan.go.id/main/katalog` | **Blocked** (`HTTP 403` Cloudflare challenge) | Currently covered by OSM 21-Kecamatan fallback (`© OpenStreetMap contributors`) |
| BPS Kota Medan Web Portal | `https://medankota.bps.go.id/id/statistics-table/2/MzEjMg%3D%3D/undefined` | **Blocked** (TSPD 520 / Cloudflare challenge) | Superseded by official BPS 2025 & Disdukcapil 2022-2024 files on Satu Data Medan |
| Geofabrik Sumatra OSM PBF | `https://download.geofabrik.de/asia/indonesia/sumatra-latest.osm.pbf` | **Metadata Recorded** (`270 MB`, up to `2026-11-18T21:21:02Z`) | Adriel to download locally and clip to Kota Medan in QGIS (excluded from Git) |

## 3. DEMO Fixtures (Explicitly Separated)

Development contract fixtures live under `data/fixtures/demo/` (and `public/data/demo/` for opt-in preview only) and carry `"isDemo": true` and `"dataLabel": "DEMO"`. They must never be presented as official statistics.
