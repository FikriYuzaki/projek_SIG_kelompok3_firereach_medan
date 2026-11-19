# GIS Workflow & Methodology Standards

## 1. Coordinate Reference Systems (CRS)

- **Metric Analysis CRS**: `EPSG:32647` (WGS 84 / UTM zone 47N). Use this CRS in QGIS for every metric calculation: area (`km2`), distance buffers, KDE pixel size/bandwidth, and road network lengths. Never compute meter buffers or areas in geographic degrees.
- **Web & PostGIS Exchange CRS**: `EPSG:4326` (WGS 84 geographic coordinates). Reproject final QGIS outputs to `EPSG:4326` when exporting GeoJSON for Leaflet or loading into PostGIS (`SRID 4326`).
- Always verify layer CRS and Kota Medan spatial extent (`lat 3.45` to `3.85`, `lon 98.55` to `98.78`) before running geoprocessing tools.

## 2. Location Accuracy & Verification Taxonomy

| `location_accuracy` | Meaning | Allowed on Point Map / KDE? |
|---|---|---|
| `exact_verified` | Field-checked GPS or official point coordinate | Yes |
| `address_geocoded_verified` | Street address geocoded and manually checked against street/kelurahan | Yes |
| `approximate` | Road segment or landmark estimate with explicit uncertainty note | Optional on explorer map with accuracy badge; check before KDE |
| `district_only` | Only Kecamatan name is known (or dataset is Kecamatan aggregate) | **No** (choropleth/aggregate only; never place synthetic dots or feed KDE) |
| `unknown` | Missing or unparseable location | **No** (list in unlocated / needs-review queue) |

Verification statuses: `verified`, `needs_review`, `unlocated`.

## 3. Module-Specific QGIS Workflows

### 3.1 Fikri: Fire Incident Explorer (`incident-explorer`)
- Standardize official tabular records, normalize whitespace in `Kecamatan` names (for example `"Medan  Kota"` -> `"Medan Kota"`), and separate `district_aggregate` / `monthly_aggregate` tables from individual point records.
- Keep `geom = null` for records without verified coordinates and expose them in the dedicated unlocated / needs-review table.

### 3.2 Adeptri: Fire Hotspot Analyzer (`hotspot-analyzer`)
- Filter input strictly to `location_accuracy` in `('exact_verified', 'address_geocoded_verified')` (never mix `district_only` aggregates into point KDE).
- Run Heatmap (Kernel Density Estimation) in `EPSG:32647` and document: period covered, kernel shape (e.g. Quartic), bandwidth/radius (meters), pixel size (meters), extent, and classification method (e.g. Quantile or Natural Breaks).
- Always label KDE outputs as historical event concentration, never as fire prediction.

### 3.3 Adriel: Fire Station Coverage (`station-coverage`)
- Verify Mako 0.0 (`Jl. Candi Borobudur No. 2`, `3.589536, 98.671447`) and every UPT pos address/coordinate before running network analysis.
- Extract roads from Geofabrik Sumatra OSM PBF (`sumatra-latest.osm.pbf`), clip to Kota Medan bounding box + 3 km buffer, retain drivable `highway` classes (`motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `unclassified`, `residential`, `service` excluding private/restricted gates where tagged), and check topology, disconnected islands, `oneway`, and `access`/`motor_vehicle` tags.
- Compare straight-line Euclidean buffers against road-network service areas in QGIS (`Service area (from layer)` / QNEAT3). Whenever converting distance to minutes, state explicit speed assumptions (`km/h`) as an estimation scenario, never as actual Damkarmat response time.
- Include mandatory attribution: `© OpenStreetMap contributors` (ODbL).

### 3.4 Olo: Fire Service Priority Planner (`priority-planner`)
- Use consistent analysis units (`kecamatan`, matching all 21 districts with code `12.71.01` to `12.71.21`, because official population and 2023 district fire aggregates exist at kecamatan level).
- Combine normalized indicators: historical fire/hotspot intensity, station coverage gap, and BPS population/density exposure.
- Document normalization direction (benefit vs cost), exact indicator weights with rationale, method version, and period.
- Develop UI and pipeline immediately against `data/fixtures/demo/priority-planner.demo.json` (`DEMO`) while awaiting Adeptri and Adriel outputs.
