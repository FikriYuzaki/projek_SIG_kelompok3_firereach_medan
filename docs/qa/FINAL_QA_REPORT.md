# Laporan QA Rilis Produksi - FireReach Medan (2026-11-27)

**Branch rilis:** `feature/fikri-production-release`
**Versi release manifest:** `2026-11-27-prod`
**Status keseluruhan:** PASS

---

## 1. Ringkasan Cakupan Rilis

1. **Pengayaan Data Insiden Kebakaran Publik & Pos Damkarmat:**
   - Katalog insiden publik ditingkatkan dari `27` menjadi `34` kejadian unik (`2024`: `8`, `2025`: `12`, `2026`: `14`) bersumber dari `p2k.medan.go.id`, `ANTARA Sumut`, dan `Detik Sumut`.
   - `22` insiden berkoordinat ruas/landmark OSM inside Kota Medan polygon (`approximate`, diekspor ke `data/processed/public_incidents_points.geojson`) dan `12` insiden `district_only` (`geom = null`).
   - Seluruh `7` pos Damkarmat (`MAKO-00` terverifikasi + `UPT-01..06` kandidat) terdokumentasi kanonis; `UPT-03` dan `UPT-04` dipertahankan jujur sebagai `district_only` (`geom = null`).
2. **Analisis Spasial Nyata (`EPSG:32647` -> `EPSG:4326`):**
   - **KDE Eksploratif (`public/data/hotspot-analyzer.exploratory.geojson`):** `22/22` titik lolos validasi poligon Kota Medan, `12` `district_only` dikecualikan (`excluded_count: 12`), bandwidth `1.500 m`, piksel `100 m`, kernel Quartic, `34` zona Quantile 4 kelas (`breaks P25=0.149085, P50=0.476430, P75=0.879300`).
   - **Jangkauan Stasiun (`station-coverage.provisional.json`):** `per_station_coverage` untuk seluruh `7` pos (`5` routable: `MAKO-00`, `UPT-01`, `UPT-02`, `UPT-05`, `UPT-06`; `2` `district_only`: `UPT-03`, `UPT-04`), plus partisi layanan 5 km (`overlap_ge2: 30.94 km2 / 11.11%`, `single_station: 84.52 km2 / 30.36%`, `uncovered: 162.84 km2 / 58.48%`).
   - **Prioritas Layanan (`priority-planner.provisional.json`):** `method_version: priority-v2.0-integrated` untuk `21` kecamatan, menggabungkan beban kebakaran 2023, gap layanan 5 km (`baseline` Mako 0.0 & `zones_multi_station` 5 pos), paparan penduduk BPS 2025, dan diagnostik tumpang tindih KDE eksploratif.
3. **Penghapusan Jalur DEMO/Coming Soon Runtime & Redesign UI/UX Pro Max:**
   - Seluruh berkas di `public/data/demo/` dihapus dan seluruh tombol/fallback DEMO maupun label `Coming Soon` / `Dalam Pengembangan` dihapus dari antarmuka produksi.
   - Seluruh `4` modul diset `active` pada `src/core/feature-registry.js`.
   - Sistem visual Warm Editorial + Geospatial Intelligence (`Playfair Display`, `Plus Jakarta Sans`, `IBM Plex Mono`; `#FAF6F0`, `#FFFDF9`, `#B83B28`, `#2C555C`, `#8A5212`) diterapkan dengan kontras WCAG AA terverifikasi.

---

## 2. Hasil Verifikasi Otomatis

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| ESLint | `npm run lint` | PASS (0 error/warning) |
| Vitest Unit & Contract Tests | `npm run test` | PASS (`10` file, `74` test passed) |
| Vite Production Bundle | `npm run build` | PASS (zero `dist/data/demo/`) |
| Playwright Chromium E2E & Responsive (`1440`/`768`/`375`) | `npm run test:e2e` | PASS (`4/4` skenario, `0` console/page/HTTP error) |
| Python Pipeline Unit Tests | `python -m unittest discover -s tests/python -v` | PASS (`19/19` passed) |
| PyQGIS Hotspot Integration Smoke | `python-qgis-ltr.bat tests/python/qgis_integration_smoke.py` | PASS |
| PyQGIS Coverage + Priority Smoke | `python-qgis-ltr.bat tests/python/qgis_station_priority_smoke.py` | PASS |
| Portable QGIS Pack Verification | `python-qgis-ltr.bat scripts/build_qgis_pack.py --verify-only` | PASS (`3` proyek `.qgz`, CRS `EPSG:32647`, `0` path absolut, `0` geometri invalid) |
| Supabase Staging Validator | `node scripts/import_supabase_staging.mjs --dry-run` | PASS (`38` sources, `193` aggregates, `7` stations, `34` incidents, `5` snapshots) |
| WCAG AA Contrast Checker | `contrast-check.py` pada 11 pasangan warna | PASS (`5.60:1` s.d. `15.51:1`) |

---

## 3. Catatan Keterbatasan Data yang Dipertahankan Secara Jujur

- Titik individual resmi dari Dinas Damkarmat tetap tercatat `0 titik` pada mode utama; KDE eksploratif memanfaatkan `22` lokasi ruas OSM dari catatan publik (`needs_review`).
- Pos `UPT-03` (KIM Mabar) dan `UPT-04` (Belawan II) belum memiliki poligon/persil jalan yang terkonfirmasi dalam batas OSM Kota Medan sehingga tetap berstatus `district_only` (`geom = null`, `routable = false`).
- Apabila snapshot `public.app_data_snapshots` di Supabase masih membawa versi sebelum `2026-11-27-prod`, klien otomatis memilih aset statis terverifikasi terbaru di `/data/` tanpa mencampur versi data.
