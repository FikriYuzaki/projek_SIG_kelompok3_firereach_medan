# Laporan Audit & Pembersihan Data / Artefak - FireReach Medan

**Diperbarui:** 2026-11-27 (Tahap 1: Audit Data & QGIS)

---

## 1. Audit Integritas `data/raw/` vs `data/metadata/source-register.csv`

- Seluruh `38` baris pada `data/metadata/source-register.csv` diperiksa ulang terhadap berkas lokal di `data/raw/`.
- Hasil: `0` perbedaan ukuran byte, `0` perbedaan hash SHA-256. Tidak ada berkas mentah (`data/raw/`) yang dihapus karena seluruhnya merupakan sumber bukti resmi Damkarmat, BPBD, BPS, dan ekstrak PBF GeoFabrik (`sumatra-latest.osm.pbf`) yang dipisahkan dari Git via `.gitignore`.

## 2. Audit Berkas `data/processed/`, `public/data/`, dan `data/fixtures/demo/`

| Direktori | Berkas Aktif | Status | Keputusan |
|---|---|---|---|
| `public/data/` | `manifest.json`, `fire_incidents_summary.json`, `medan_districts_osm.geojson`, `medan_road_graph.json`, `public_incident_candidates.json`, `damkarmat_station_candidates.json`, `hotspot-analyzer.exploratory.geojson`, `station-coverage.provisional.json`, `priority-planner.provisional.json` | Dibutuhkan oleh SPA & integrasi lintas modul (`public/data/demo/` telah dihapus pada rilis `2026-11-27-prod`) | Dipertahankan; ditambahkan `medan_road_graph.json` (`587.909` byte) untuk simulasi rute jaringan jalan dan `hotspot-analyzer.exploratory.geojson` untuk KDE eksploratif |
| `data/processed/` | `independent_enrichment_input.json`, `medan_population_2022_2025.csv`, `public_incidents_points.geojson`, `supabase_staging_bundle.json`, serta artefak mirror output pipeline | Sumber input/staging pipeline `build_processed_data.py` | Dipertahankan seluruhnya; tidak ada duplikat tak terpakai |
| `data/fixtures/demo/` | `hotspot-analyzer.demo.json`, `incident-explorer-sample.demo.json`, `priority-planner.demo.json`, `station-coverage.demo.json` | Fixture kontrak pengujian unit terisolasi (`isDemo: true`); bukan fallback runtime produksi | Dipertahankan khusus untuk validasi kontrak di `tests/unit/` |

## 3. Audit Artefak QGIS (`qgis/`)

- Ketiga proyek QGIS (`medan_hotspot_template.qgz`, `station_coverage.qgz`, `priority_analysis.qgz`) dibersihkan dari referensi relatif luar folder proyek (`../../public/data/medan_districts_osm.geojson` disalin ke `./layers/medan_districts_osm.geojson` di masing-masing proyek).
- Ekspor layout bersih berada di `./exports/` pada tiap modul dan dikemas tanpa PBF mentah ataupun `__pycache__` ke dalam `FireReach_Medan_QGIS_Pack.zip`.

## 4. Pembersihan Fitur & Ketergantungan Frontend (Tahap 2 - Selesai)

- Dihapus: `src/components/three-preview.js`, rule CSS obsolet `.preview-box` / `.preview-stage` / `.preview-controls` di `src/styles/components.css`, manual chunk `three: ["three"]` di `vite.config.js`, serta dependensi npm `three` (`npm uninstall three`, `1` paket dihapus).
- Verifikasi grep pada `src/` (selain catatan arsip dokumentasi), `package.json`, `vite.config.js`, dan `tests/`: nol (`0`) impor atau pemakaian modul `three` yang tersisa.
- Fitur tersebut digantikan oleh modul simulasi spasial jaringan jalan Damkarmat pada `src/features/incident-explorer/response-router.js`, `response-audio.js`, dan `response-simulation.js`.
