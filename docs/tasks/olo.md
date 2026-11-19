# Task Brief: Olo (`priority-planner`)

- **Module ID**: `priority-planner`
- **Owner**: Olo
- **Initial Registry Status**: `coming-soon`
- **Owned Paths**: `src/features/priority-planner/`, `qgis/priority-analysis/`
- **Suggested Branch**: `feature/olo-priority-planner`

## 1. Scope & Responsibilities

Combine historical fire intensity/hotspot outputs, station coverage gap metrics, and official kecamatan population/density indicators into a transparent priority ranking across Kota Medan's 21 Kecamatan, implemented in `src/features/priority-planner/`.

## 2. Available Official Inputs Right Now

- Official 21-Kecamatan boundaries (`data/processed/medan_districts_osm.geojson`, OSM fallback with `12.71.01` to `12.71.21` alignment).
- Official 2025 population, density (`jiwa/km2`), and percentage distribution per Kecamatan (`2,498,293` total population) from Satu Data Medan (`01kgkf1fvm5np4c0kfkw8sszxn`), plus 2022-2024 Kecamatan series (`01m2etk7qn2km32j516b52mbqp`).
- Official 2023 fire count & scale per Kecamatan (`219` incidents across 21 Kecamatan) from Satu Data Medan (`01m36hh29wv44bcyk299ek5w7e`, `01k4rsar3ydj4x7k56yn2crg5g`).

## 3. Parallel Start Without Blocking

Do not wait for Adeptri and Adriel's final spatial outputs. Develop the scoring UI, factor weight breakdown, ranking table, and choropleth against `data/fixtures/demo/priority-planner.demo.json` (`isDemo: true`, `dataLabel: "DEMO"`).

## 4. Methodological Guardrails

- Maintain `kecamatan` as the consistent unit of analysis unless every indicator is verified at `kelurahan` level.
- Document normalization direction (higher fire density -> higher priority; higher coverage gap -> higher priority; higher population density -> higher exposure), exact weights with rationale, method version, and period.
- Store `hotspot_score`, `coverage_gap_score`, `population_exposure_score`, `composite_score`, and human-readable `priority_reason` for every zone.
