# Task Brief: Adriel (`station-coverage`)

- **Module ID**: `station-coverage`
- **Owner**: Adriel
- **Initial Registry Status**: `coming-soon`
- **Owned Paths**: `src/features/station-coverage/`, `qgis/station-coverage/`
- **Suggested Branch**: `feature/adriel-station-coverage`

## 1. Scope & Responsibilities

Verify Damkarmat station locations (Mako and UPT pos), prepare a clean road network dataset for Kota Medan, evaluate network-based service areas in QGIS (`EPSG:32647`), compare them against straight-line Euclidean buffers, and build `src/features/station-coverage/`.

## 2. Verified Baseline & Pending Data

- **Already verified**: Mako 0.0 Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan at `Jl. Candi Borobudur No. 2` (`3.589536, 98.671447`), sourced from Satu Data Medan Knowledge Damkarmat dataset.
- **Pending manual acquisition**: UPT/Pos addresses from `https://p2k.medan.go.id/berita/Infografis-Letak-Pos-Damkarmat-Kota-Medan.html` (blocked from automated fetch by Cloudflare challenge; open manually in browser and verify every pos coordinate with field/aerial checks).
- **Road network**: Extract Kota Medan drivable roads from Geofabrik Sumatra (`sumatra-latest.osm.pbf`, `© OpenStreetMap contributors`, ODbL), verify connectivity, disconnected edges, `oneway`, and `access`/`motor_vehicle` tags.

## 3. Methodological Guardrails

- Distinguish Euclidean distance buffers from road-network service areas.
- If converting network distance to travel minutes, state the assumed speed (`km/h`) as an estimation scenario, never as actual Damkarmat response time.

## 4. Parallel Start Using DEMO Fixture

Build the coverage UI, layer toggles, and disclaimer panel against `data/fixtures/demo/station-coverage.demo.json` (`isDemo: true`, `dataLabel: "DEMO"`) while verifying UPT coordinates and road topology.
