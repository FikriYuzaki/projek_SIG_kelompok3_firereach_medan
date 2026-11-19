# QGIS Workspace Conventions

QGIS Desktop projects for FireReach Medan follow a common folder structure and CRS convention. Subdirectories are created by each module owner when adding real `.qgz` project files and GeoPackage layers (no empty placeholder folders are pre-created):

- `qgis/incident-data/` (Owner: Fikri): standardized incident staging layers and district join tables.
- `qgis/hotspot-analysis/` (Owner: Adeptri): KDE parameter logs, raster exports, and vectorized hotspot zone GeoJSON.
- `qgis/station-coverage/` (Owner: Adriel): verified Mako/UPT point layers, clipped OSM road network GeoPackage, and service area polygons.
- `qgis/priority-analysis/` (Owner: Olo): district-level multi-criteria overlay layers and scored GeoJSON outputs.

## Standards

1. Set QGIS project CRS to `EPSG:32647` (WGS 84 / UTM zone 47N) for all distance, buffer, density, and area measurements.
2. Store intermediate working layers in GeoPackage (`.gpkg`) locally; keep large raw PBF/raster files out of Git.
3. Export final web-ready polygons and points in `EPSG:4326` GeoJSON into `data/processed/` (and `public/data/`) with metadata documented in `data/metadata/source-register.csv`.
