---
name: firereach-data-provenance
description: >-
  Data sourcing, licensing, inspection, and provenance standards for FireReach Medan.
  Use when acquiring datasets, inspecting raw spreadsheets or spatial files, updating
  manifests, or distinguishing official, OSM, survey, and DEMO data.
---

# FireReach Data Provenance

Follow `docs/DATA_CATALOG.md`, `data/README.md`, and `data/metadata/source-register.csv`.

## Provenance Rules

1. **Archive raw originals**: Save untouched downloaded files under `data/raw/` (gitignored). Never edit files in `data/raw/`.
2. **Register every source**: Record `source_id`, publisher, exact URL, access date, period, file size, SHA-256 hash, license/terms, status, granularity, and `location_accuracy` in `data/metadata/source-register.csv`.
3. **Inspect before using**: Read actual sheet names, headers, row counts, null counts, duplicates, and aggregation level. Document schemas in `data/metadata/data-dictionary.md` and validation checks in `data/metadata/qa-report.md`.
4. **Honest labeling**:
   - Distinguish official Pemko/BPS/BIG data, OpenStreetMap (`© OpenStreetMap contributors`, ODbL), field verification, and `DEMO` fixtures.
   - Never disguise `DEMO` or synthetic fixtures as official observations.
   - Never invent missing coordinates, split district totals into synthetic points, or claim failed downloads succeeded. Record blocked URLs and errors explicitly.
