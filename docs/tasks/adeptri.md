# Task Brief: Adeptri (`hotspot-analyzer`)

- **Module ID**: `hotspot-analyzer`
- **Owner**: Adeptri
- **Initial Registry Status**: `coming-soon`
- **Owned Paths**: `src/features/hotspot-analyzer/`, `qgis/hotspot-analysis/`
- **Suggested Branch**: `feature/adeptri-hotspot-analyzer`

## 1. Scope & Responsibilities

Analyze historical spatial concentration of fire incidents across Kota Medan using Kernel Density Estimation (KDE) in QGIS Desktop (`EPSG:32647`) and visualize verified hotspot zones in `src/features/hotspot-analyzer/`.

## 2. Data Rules & Guardrails

1. Only consume individual point records whose `location_accuracy` is `exact_verified` or `address_geocoded_verified` (plus verified `approximate` only if documented). Never feed `district_only` aggregates into point KDE.
2. Record full KDE metadata in `hotspot_analyses`: period, kernel function, bandwidth/radius (`m`), pixel size (`m`), CRS (`EPSG:32647`), extent, and classification method.
3. Label outputs honestly as historical concentration, never as future fire prediction.

## 3. Parallel Start Using DEMO Fixture

While waiting for geocoded individual incident points from Fikri, start building the `hotspot-analyzer` UI, density legend, and parameter display against `data/fixtures/demo/hotspot-analyzer.demo.json` (flagged `"isDemo": true`, `"dataLabel": "DEMO"`).

## 4. Acceptance Criteria Before Promotion

- QGIS project and parameter log committed under `qgis/hotspot-analysis/`.
- Validated `EPSG:4326` hotspot polygon output and metadata match `docs/DATABASE_DESIGN.md`.
- Clean `mount()` / `unmount()` lifecycle with zero leaked Leaflet layers or charts.
- Passes `npm run lint`, `npm run test`, `npm run build`, and module-specific tests.
