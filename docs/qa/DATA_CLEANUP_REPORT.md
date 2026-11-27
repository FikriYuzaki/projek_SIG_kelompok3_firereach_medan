# Laporan Audit & Pembersihan Data / Artefak - FireReach Medan

**Diperbarui:** 2026-11-27 (Tahap 1: Audit Data & QGIS)

---

## 1. Audit Integritas `data/raw/` vs `data/metadata/source-register.csv`

- Seluruh `38` baris pada `data/metadata/source-register.csv` diperiksa ulang terhadap berkas lokal di `data/raw/`.
- Hasil: `0` perbedaan ukuran byte, `0` perbedaan hash SHA-256. Tidak ada berkas mentah (`data/raw/`) yang dihapus karena seluruhnya merupakan sumber bukti resmi Damkarmat, BPBD, BPS, dan ekstrak PBF GeoFabrik (`sumatra-latest.osm.pbf`) yang dipisahkan dari Git via `.gitignore`.

## 2. Audit Berkas `data/processed/`, `public/data/`, dan `data/fixtures/demo/`

| Direktori | Berkas Aktif | Status | Keputusan |
|---|---|---|---|
| `public/data/` | `manifest.json`, `fire_incidents_summary.json`, `medan_districts_osm.geojson`, `medan_road_graph.json`, `public_incident_candidates.json`, `damkarmat_station_candidates.json`, `station-coverage.provisional.json`, `priority-planner.provisional.json`, `demo/` | Dibutuhkan oleh SPA & integrasi lintas modul | Dipertahankan; ditambahkan `medan_road_graph.json` (`587.909` byte) untuk simulasi rute jaringan jalan |
| `data/processed/` | `independent_enrichment_input.json`, `medan_population_2022_2025.csv`, `supabase_staging_bundle.json`, serta artefak mirror output pipeline | Sumber input/staging pipeline `build_processed_data.py` | Dipertahankan seluruhnya; tidak ada duplikat tak terpakai |
| `data/fixtures/demo/` | `hotspot-analyzer.demo.json`, `incident-explorer-sample.demo.json`, `priority-planner.demo.json`, `station-coverage.demo.json` | Fixture fallback mode DEMO terisolasi (`isDemo: true`) | Dipertahankan untuk keandalan pengujian & fallback |

## 3. Audit Artefak QGIS (`qgis/`)

- Ketiga proyek QGIS (`medan_hotspot_template.qgz`, `station_coverage.qgz`, `priority_analysis.qgz`) dibersihkan dari referensi relatif luar folder proyek (`../../public/data/medan_districts_osm.geojson` disalin ke `./layers/medan_districts_osm.geojson` di masing-masing proyek).
- Ekspor layout bersih berada di `./exports/` pada tiap modul dan dikemas tanpa PBF mentah ataupun `__pycache__` ke dalam `FireReach_Medan_QGIS_Pack.zip`.

## 4. Pembersihan Fitur & Ketergantungan Frontend (Tahap 2 - Tertunda)

- Penghapusan `src/components/three-preview.js` dan dependensi `three` dari `package.json` serta `vite.config.js` akan dicatat pada pembaruan laporan ini setelah Tahap 2 (Simulasi Respons Damkarmat) selesai dibangun dan diverifikasi.
