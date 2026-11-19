---
name: firereach-geospatial
description: >-
  Geospatial and QGIS workflow standards for FireReach Medan. Use when working with
  QGIS projects, CRS transforms, GeoJSON, GeoPackage, PostGIS geometry, KDE hotspots,
  road network service areas, or priority overlay scoring.
---

# FireReach Geospatial Workflow

Follow `docs/GIS_WORKFLOW.md` and `docs/DATABASE_DESIGN.md` for every spatial dataset or analysis layer.

## Core Rules

1. **CRS separation**: Run metric calculations (area, meter buffers, network distance, KDE pixel grids) in `EPSG:32647` (WGS 84 / UTM zone 47N). Store and exchange PostGIS/web layers in `EPSG:4326` (WGS 84). Never compute meter distances or areas in degrees.
2. **Coordinate sanity**: Verify extent falls inside Kota Medan (roughly `lat 3.45..3.85`, `lon 98.55..98.78`), check for swapped lat/lon, and run geometry validity checks before export.
3. **Location accuracy honesty**:
   - Allowed `location_accuracy`: `exact_verified`, `address_geocoded_verified`, `approximate`, `district_only`, `unknown`.
   - Allowed `verification_status`: `verified`, `needs_review`, `unlocated`.
   - Never place `district_only` or aggregate counts into point KDE or render them as individual incident points.
4. **Module boundaries**:
   - `hotspot-analyzer` (Adeptri): KDE is historical concentration, not future prediction; document kernel, radius/bandwidth, pixel size, CRS, and period.
   - `station-coverage` (Adriel): Check road topology/connectivity and attribute caveats (`oneway`, `access`, `© OpenStreetMap contributors`). Label network time estimates as scenario assumptions, never actual Damkarmat response times.
   - `priority-planner` (Olo): Use a consistent administrative unit (kecamatan unless finer verified indicators exist), document normalization direction and indicator weights.
