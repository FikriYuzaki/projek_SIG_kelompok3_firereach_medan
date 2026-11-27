# Repository Housekeeping Handoff: FireReach Medan

Status final per 2026-11-27. Dokumen ini menjadi catatan penutup menyeluruh atas housekeeping repository, pembersihan remote branch, sinkronisasi dokumentasi QGIS, dan remediasi keamanan dependensi npm.

## 1. Ringkasan Tahap dan Pull Request

| Tahap | Branch | PR | Commit SHA | Status |
|---|---|---|---|---|
| Baseline audit | `main` | - | `e8cd4d1e81699020138236283b7464f17d008ffd` | Selesai |
| Pembersihan artefak, `.gitignore`, README, dokumentasi utama | `chore/repository-housekeeping` | [#12](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/12) | Merge `d4d028ee3bd2bd09a6b2a272813edb7025e1c1dd` (Head `b95223f1115f757d81f8c59cc687e8c3d755113b`) | Merged ke `main`, CI dan Vercel lulus |
| Perbaikan alur branch, fakta `QA_REPORT.md`, dan sanitasi handoff | `chore/repository-housekeeping-followup` | [#13](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/13) | Merge `fed9ad721183f1d4f6c7dc557bb12fc04909d989` (Head `31bab846c0e02ad7d4042795dc8b12516b6da818`) | Merged ke `main`, CI dan Vercel lulus |
| Sinkronisasi `qgis/README_QGIS.md`, rebuild ZIP, dan `qgis/QA_REPORT.md` | `docs/qgis-readme-sync` | [#14](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/14) | Merge `761e67ee7ba56fc357bf8b7f836c619d7a310d6f` (Head `c1fcd9f4e1d15d9eb2ea9a0e879f26e6fa735da9`) | Merged ke `main`, CI dan Vercel lulus |
| Audit dan remediasi dependensi npm (`vitest@^4.1.12`) | `security/npm-dependency-remediation` | [#15](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/15) | Merge `1527a4a3225907cf39e0e4587ce400c878a1356a` (Head `9d69a2a9f84f7bf7ac6da04ba595417d5fde91ba`) | Merged ke `main`, CI dan Vercel lulus |
| Dokumen penutup housekeeping repository | `docs/housekeeping-closeout` | [#16](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/16) | Penutup akhir housekeeping ke `main` | Finalisasi dan merge ke `main` |

## 2. Pembersihan Remote Branches

Seluruh branch lama diaudit terlebih dahulu terhadap `origin/main` sebelum dihapus.

**Remote branches lama yang telah dihapus setelah PR #13 merged (14 branch):**
- `develop`
- `feature/adeptri-hotspot-analyzer`
- `feature/adriel-station-coverage`
- `feature/fikri-button-hover-skeleton-shimmer`
- `feature/fikri-finalisasi-fire-response`
- `feature/fikri-fire-reach-audit-cleanup`
- `feature/fikri-incident-explorer`
- `feature/fikri-production-release`
- `feature/olo-priority-planner`
- `feature/station-coverage-public-candidates`
- `feature/supabase-online-data`
- `fix/fikri-supabase-snapshot-fallback`
- `chore/repository-housekeeping`
- `chore/repository-housekeeping-followup`

**Branch PR penyelesaian akhir (dihapus segera setelah PR #14, #15, dan #16 berstatus merged):**
- `docs/qgis-readme-sync`
- `security/npm-dependency-remediation`
- `docs/housekeeping-closeout`

**Remote branches final yang dipertahankan:**
- `main` (branch produksi aktif Vercel `https://firereach-medan.vercel.app`)
- `backup/feature-fikri-incident-explorer-a3ec706` (branch backup sementara)

## 3. Sinkronisasi Dokumentasi QGIS dan Paket ZIP (PR #14)

- `qgis/README_QGIS.md` menjelaskan kelima komponen proyek `hotspot-analysis/medan_hotspot_template.qgz`: agregat resmi kebakaran 2023 (`219` kejadian pada `21` kecamatan, bukan KDE titik individual), titik `Mako 0.0` terverifikasi, layer titik insiden publik OSM (`22` lokasi perkiraan `approximate`), layer KDE eksploratif (`22` titik publik, kernel Quartic, bandwidth `1.500` meter, pixel `100` meter, `34` zona Quantile 4 kelas), pengecualian `12` insiden `district_only` tanpa koordinat titik, serta penegasan bahwa KDE eksploratif **bukan statistik resmi lengkap** dan **bukan prediksi kebakaran**.
- `FireReach_Medan_QGIS_Pack.zip` terdiri atas **22 entri** berukuran **3.096.932 byte** dengan kesamaan byte-per-byte terhadap `qgis/README_QGIS.md` (`PARITY_RAW=True`).
- Pemeriksaan ulang pasca-merge pada `main` dengan PyQGIS (`scripts/build_qgis_pack.py --verify-only`) lulus (`medan_hotspot_template.qgz` `5` layer / `259.575` byte PNG, `station_coverage.qgz` `6` layer / `313.254` byte PNG, `priority_analysis.qgz` `3` layer / `216.035` byte PNG, seluruh proyek `EPSG:32647`, `0` path absolut, `0` geometri invalid).
- `qgis/QA_REPORT.md` telah mencerminkan ukuran ZIP dan rincian KDE eksploratif aktual tersebut.

## 4. Audit dan Remediasi Keamanan npm (PR #15)

Audit awal (`npm audit --json`) mengidentifikasi **3 kerentanan** pada devDependency pengujian `vitest`, sementara `vite@6.4.6` memiliki **0 kerentanan**:

| Paket | Severity | Jalur Dependensi | Versi Terpasang | Rentang Terdampak | Versi Patch | Advisory |
|---|---|---|---|---|---|---|
| `vitest` | Critical dan Moderate | `vitest` (langsung di `devDependencies`) | `3.2.7` | `0.0.95 - 4.1.10` | `>=4.1.11` (`4.1.12`) | GHSA-82fw-gwwq-j7x9, GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr |
| `@vitest/mocker` | Moderate | `vitest > @vitest/mocker` | `3.2.7` | `<=4.1.11` | `>=4.1.12` | GHSA-82fw-gwwq-j7x9 (`>=2.1.0 <4.1.11`), GHSA-qxg6-89mg-rqv8 (`>=2.1.0-beta.7 <4.1.12`) |
| `tinypool` | Critical | `vitest > tinypool` | `1.1.1` | `<=2.1.1` | `>=2.1.2` (dihapus di `vitest@4.1.12`) | GHSA-5gmw-xhrv-c9v3 (`<=2.1.0`), GHSA-85c8-ppgw-ccpr (`<2.1.2`) |

**Penyelesaian:**
- `npm audit fix` tanpa `--force` tidak mengubah paket karena ketiganya memerlukan pembaruan major `vitest`.
- `npm audit fix --force` (`vitest@5.1.2`) tidak dipakai. Paket `vitest` diperbarui secara terukur ke `^4.1.12` (`4.1.12`, `@vitest/mocker@4.1.12`, tanpa `tinypool`), menjaga kompatibilitas `vite@6.4.6` dan Node `20/22/24+`.
- Hasil `npm audit --json` pada `main` pasca-merge menunjukkan **0 vulnerabilities** (`total: 0`).

## 5. Integritas Data & Kebersihan Repository

- Koordinat, dataset `data/processed/` dan `public/data/`, metodologi analisis KDE/coverage/priority, serta perilaku runtime aplikasi tetap tidak berubah selama housekeeping.
- `data/fixtures/demo/` tetap terbatas untuk kontrak unit test (`tests/unit/`), bukan fallback runtime produksi.
- `docs/tasks/*.md` dan `docs/laporan/` dipertahankan sebagai arsip historis dan naskah akademik.
- File lokal pengguna yang belum di-track serta direktori kerja lokal yang diabaikan `.gitignore` tidak diubah, tidak dihapus, dan tidak dipublikasikan ke GitHub.

## 6. Validasi Aktual pada `main` Pasca-Merge (#12 sampai #15)

| Pemeriksaan | Hasil |
|---|---|
| `npm ci` & `npm ls vitest` | Sukses (`vitest@4.1.12`) |
| `npm audit --json` | `0 vulnerabilities` (`info: 0, low: 0, moderate: 0, high: 0, critical: 0`) |
| `npm run lint` | Lulus (0 error/warning) |
| `npm run test` (`vitest@4.1.12`) | Lulus (`10` file, `74/74` test) |
| `npm run build` | Sukses (`vite@6.4.6`) |
| `npm run test:e2e` | Lulus (`5/5` skenario Playwright Chromium dalam `18.0s`) |
| `python -m unittest discover -s tests/python -v` | Lulus (`19/19` test) |
| PyQGIS `scripts/build_qgis_pack.py --verify-only` & parity ZIP | Lulus (`22` entri, `3.096.932` byte, `0` path absolut, `0` geometri invalid, parity `True`) |
| GitHub Actions `verify` & Vercel Preview (#12, #13, #14, #15) | Seluruhnya `completed / success` |
