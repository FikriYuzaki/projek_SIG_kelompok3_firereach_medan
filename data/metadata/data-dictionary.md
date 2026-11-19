# Data Dictionary: Processed & Validated FireReach Datasets

## 1. `data/processed/medan_districts_osm.geojson`

- **CRS**: `EPSG:4326` (WGS 84)
- **Geometry**: `Polygon` / `MultiPolygon` for all 21 Kecamatan in Kota Medan
- **Source**: OpenStreetMap Nominatim (`© OpenStreetMap contributors`, ODbL 1.0) joined with Satu Data Medan official tables

| Property | Type | Nullable | Description |
|---|---|---|---|
| `area_code` | string | No | Standardized code (`12.71.01` to `12.71.21`) |
| `district_name` | string | No | Normalized Kecamatan name (e.g. `Medan Kota`) |
| `osm_id` | number | No | OpenStreetMap relation ID |
| `incidents_2023` | integer | No | Total fire incidents in 2023 (`Rekapitulasi 2023`) |
| `incidents_2023_besar` | integer | No | Large-scale fire incidents in 2023 |
| `incidents_2023_kecil` | integer | No | Small-scale fire incidents in 2023 |
| `categories_2023` | object | No | Map of 8 official fire object categories |
| `population_2024` | integer | No | 2024 population (`JUMLAH_PENDUDUK_KOTA_MEDAN_BERDASARKAN_KECAMATAN_2022-2024.xlsx`) |
| `population_2025` | integer | No | 2025 population (BPS via Satu Data Medan) |
| `density_km2_2025` | integer | No | Population density (`jiwa/km2`, 2025) |
| `distribution_pct_2025` | number | No | Percentage share of city population (`%`, 2025) |
| `granularity` | string | No | Always `district_aggregate` |

## 2. `data/processed/fire_incidents_summary.json`

| Section | Granularity | Count | Key Fields |
|---|---|---|---|
| `district_2023` | `district_aggregate` | 21 rows (`219` fires) | `area_code`, `district_name`, `total_incidents`, `scale_besar`, `scale_kecil`, `scale_discrepancy`, `raw_area_reported`, `area_anomaly_flag`, `categories`, `location_accuracy` (`district_only`), `geom` (`null`) |
| `monthly_2024` | `monthly_aggregate` | 12 rows (`269` fires) | `period_year`, `month_number`, `month_name`, `total_incidents`, `categories`, `location_accuracy` (`unknown`), `geom` (`null`) |
| `monthly_2025` | `monthly_aggregate` | 12 rows (`251` fires) | `period_year`, `month_number`, `month_name`, `total_incidents`, `categories`, `location_accuracy` (`unknown`), `geom` (`null`) |
| `monthly_2023_impact` | `monthly_aggregate` | 12 rows (`219` fires) | `period_year`, `month_number`, `month_name`, `total_incidents`, `injured`, `fatalities`, `raw_material_loss`, `loss_anomaly_flag`, `loss_anomaly_note`, `scale_besar_monthly`, `scale_kecil_monthly`, `raw_area_reported_monthly`, `geom` (`null`) |
| `annual_series` | `annual_aggregate` | 10 rows (2016-2025) | `year`, `total_incidents`, `granularity`, `location_accuracy`, `verification_status`, `comparison_total_with_outside_medan`, `comparison_rekap_total`, `consistency_flag`, `consistency_note`, `geom` (`null`) |
| `verified_stations` | `station_point` | 1 verified station | `station_code`, `name`, `station_type`, `address`, `lat`, `lon`, `verification_status` |
| `unlocated_register` | audit metadata | 4 batches (`2,327` aggregate records 2016-2025) | `batch_id`, `period_label`, `record_count`, `granularity`, `location_accuracy`, `verification_status`, `geom` (`null`), `reason` |
| `data_quality_anomalies` | QA register | 6 documented findings | `anomaly_id`, `period`, `severity`, `summary`, `resolution`, `source_files` |

## 3. `data/processed/medan_population_2022_2025.csv`

Columns: `area_code`, `district_name`, `population_2022`, `population_2023_disdukcapil`, `population_2024_disdukcapil`, `population_2025_bps`, `density_km2_2025_bps`, `distribution_pct_2025_bps`.
