# Data Management & Directory Structure

All datasets in FireReach Medan follow strict lineage tracking from raw acquisition to processed web outputs.

## Directory Layout

- `data/raw/` (gitignored): Untouched original files exactly as downloaded from official portals or OpenStreetMap. Never edit files here.
- `data/interim/` (gitignored): Intermediate cleaned tables or geometries during inspection and normalization.
- `data/processed/` (tracked when small/licensed): Validated, clean GeoJSON/JSON/CSV outputs ready for QGIS or web consumption (`EPSG:4326` for GeoJSON).
- `data/fixtures/demo/` (tracked): Small explicitly labeled `"isDemo": true` / `"dataLabel": "DEMO"` contract fixtures enabling parallel module development before upstream outputs arrive.
- `data/metadata/` (tracked): Authoritative `source-register.csv`, `data-dictionary.md`, and `qa-report.md`.

## Rules

1. Every downloaded dataset must be logged in `data/metadata/source-register.csv` with URL, publisher, access date, period, byte size, SHA-256 hash, license, granularity, and accuracy tier.
2. Never convert district or monthly aggregates into synthetic individual fire coordinates.
3. Never disguise `DEMO` fixtures as official data.
4. Keep large raw archives (such as full Sumatra OSM PBF extracts) out of Git.
