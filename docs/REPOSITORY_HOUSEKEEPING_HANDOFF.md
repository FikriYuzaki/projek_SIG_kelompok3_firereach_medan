# Repository Housekeeping Handoff: FireReach Medan

Status per 2026-11-27. Dokumen ini merangkum penyelesaian akhir housekeeping repository, pembersihan remote branch, sinkronisasi dokumentasi QGIS, dan remediasi keamanan dependensi npm.

## 1. Ringkasan Tahap dan Pull Request

| Tahap | Branch | PR | Commit SHA | Status |
|---|---|---|---|---|
| Baseline audit | `main` | - | `e8cd4d1e81699020138236283b7464f17d008ffd` | Selesai |
| Pembersihan artefak, `.gitignore`, README, dokumentasi utama | `chore/repository-housekeeping` | [#12](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/12) | Merge `d4d028ee3bd2bd09a6b2a272813edb7025e1c1dd` (Head `b95223f1115f757d81f8c59cc687e8c3d755113b`) | Merged ke `main`, CI dan Vercel lulus |
| Perbaikan alur branch, fakta `QA_REPORT.md`, dan sanitasi handoff | `chore/repository-housekeeping-followup` | [#13](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/13) | Merge `fed9ad721183f1d4f6c7dc557bb12fc04909d989` (Head `31bab846c0e02ad7d4042795dc8b12516b6da818`) | Merged ke `main`, CI (`verify`) dan Vercel Preview lulus |
| Sinkronisasi `qgis/README_QGIS.md`, rebuild ZIP, dan `qgis/QA_REPORT.md` | `docs/qgis-readme-sync` | [#14](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/14) | Head `c1fcd9f4e1d15d9eb2ea9a0e879f26e6fa735da9` | Open, CI (`verify`) dan Vercel Preview lulus |
| Audit dan remediasi dependensi npm (`vitest@^4.1.12`) | `security/npm-dependency-remediation` | [#15](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/15) | Head `9d69a2a9f84f7bf7ac6da04ba595417d5fde91ba` | Open, CI (`verify`) dan Vercel Preview lulus |
| Penutupan catatan handoff housekeeping | `docs/housekeeping-closeout` | PR closeout ke `main` | Lihat branch PR | Menunggu review dan merge |

## 2. Pembersihan Remote Branches

Seluruh candidate branch terlebih dahulu diaudit terhadap `origin/main` (ancestry, `git log origin/main..origin/<branch>`, `git cherry`, status PR merged, dan diff tree untuk squash merge multi-commit) sebelum dihapus:

**Remote branches yang dihapus (14 branch terverifikasi merged tanpa pekerjaan unik tersisa):**
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

**Remote branches yang dipertahankan:**
- `main` (branch produksi aktif ke Vercel `https://firereach-medan.vercel.app`)
- `backup/feature-fikri-incident-explorer-a3ec706` (branch backup dipertahankan sementara sesuai kebijakan)
- Branch PR yang masih terbuka (`docs/qgis-readme-sync`, `security/npm-dependency-remediation`, dan branch closeout ini)

## 3. Sinkronisasi Dokumentasi QGIS dan Paket ZIP (PR #14)

- `qgis/README_QGIS.md` diperbarui agar proyek `hotspot-analysis/medan_hotspot_template.qgz` menjelaskan kelima komponen aktual: agregat resmi kebakaran 2023 (`219` kejadian pada `21` kecamatan, bukan KDE titik individual), titik `Mako 0.0` terverifikasi, layer titik insiden publik OSM (`22` lokasi perkiraan `approximate`), layer KDE eksploratif (`22` titik publik, kernel Quartic, bandwidth `1.500` meter, pixel `100` meter, `34` zona Quantile 4 kelas), pengecualian `12` insiden `district_only` tanpa koordinat titik, serta penegasan bahwa KDE eksploratif **bukan statistik resmi lengkap** dan **bukan prediksi kebakaran**.
- `FireReach_Medan_QGIS_Pack.zip` dibangun ulang menggunakan `scripts/build_qgis_pack.py` dengan hasil **22 entri** dan ukuran **3.096.932 byte**.
- Pemeriksaan `scripts/build_qgis_pack.py --verify-only` melalui PyQGIS lulus (`medan_hotspot_template.qgz` `5` layer / `259.575` byte PNG, `station_coverage.qgz` `6` layer / `313.254` byte PNG, `priority_analysis.qgz` `3` layer / `216.035` byte PNG, seluruh proyek `EPSG:32647`, `0` path absolut, `0` geometri invalid).
- `README_QGIS.md` di dalam arsip `FireReach_Medan_QGIS_Pack.zip` terverifikasi identik byte-per-byte (`PARITY_RAW=True`) dengan `qgis/README_QGIS.md`.
- `qgis/QA_REPORT.md` diperbarui dengan ukuran ZIP terbaru (`3.096.932` byte) dan parameter KDE eksploratif.
- GitHub Actions `verify` dan Vercel Preview pada PR #14 lulus.

## 4. Audit dan Remediasi Keamanan npm (PR #15)

Berdasarkan `npm audit --json` sebelum perbaikan, seluruh **3 kerentanan** berasal dari rantai devDependency pengujian `vitest` (bukan `vite`; paket `vite@6.4.6` terpasang bersih dengan `0` kerentanan):

| Paket | Severity | Jalur Dependensi | Versi Terpasang | Rentang Terdampak | Versi Patch | Advisory |
|---|---|---|---|---|---|---|
| `vitest` | Critical dan Moderate | `vitest` (langsung di `devDependencies`) | `3.2.7` | `0.0.95 - 4.1.10` | `>=4.1.11` (`4.1.12`) | GHSA-82fw-gwwq-j7x9, GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr |
| `@vitest/mocker` | Moderate | `vitest > @vitest/mocker` | `3.2.7` | `<=4.1.11` | `>=4.1.12` | GHSA-82fw-gwwq-j7x9 (`>=2.1.0 <4.1.11`), GHSA-qxg6-89mg-rqv8 (`>=2.1.0-beta.7 <4.1.12`) |
| `tinypool` | Critical | `vitest > tinypool` | `1.1.1` | `<=2.1.1` | `>=2.1.2` (dihapus dari tree di `vitest@4.1.12`) | GHSA-5gmw-xhrv-c9v3 (`<=2.1.0`), GHSA-85c8-ppgw-ccpr (`<2.1.2`) |

**Langkah remediasi dan evaluasi:**
- `npm audit fix` tanpa `--force` tidak mengubah paket karena ketiga advisory memerlukan kenaikan semver major pada `vitest`.
- `npm audit fix --force` (yang mengarahkan ke `vitest@5.1.2`) sengaja tidak dijalankan. Sebagai gantinya dipilih pembaruan terukur ke `vitest@^4.1.12` (`4.1.12` dan `@vitest/mocker@4.1.12`) karena mempertahankan kompatibilitas penuh dengan `vite@6.4.6` (`^6.0.0 || ^7.0.0 || ^8.0.0`) serta Node `^20 || ^22 || >=24` dan menghilangkan `tinypool` dari pohon dependensi.
- `npm audit --json` setelah pembaruan menunjukkan **0 kerentanan** (`total: 0`).
- Seluruh pengujian pada `vitest@4.1.12` lulus tanpa mengubah kode aplikasi maupun logika uji.

## 5. Yang Sengaja Dipertahankan & Catatan Kejujuran Data

- Data GIS, koordinat, metodologi KDE, cakupan, dan skor prioritas tidak diubah selama rangkaian tugas dokumentasi, pembersihan branch, maupun remediasi keamanan ini.
- `data/fixtures/demo/` tetap disimpan khusus untuk validasi kontrak unit test (`tests/unit/`), bukan fallback runtime produksi.
- `docs/tasks/*.md` dan `docs/laporan/` dipertahankan sebagai arsip historis dan naskah akademik.
- File lokal pengguna yang belum di-track serta direktori kerja lokal yang diabaikan `.gitignore` tidak diubah, tidak dihapus, dan tidak dipublikasikan ke GitHub.

## 6. Validasi Aktual

| Pemeriksaan | Scope / Cabang | Hasil |
|---|---|---|
| `npm run lint` | `chore/repository-housekeeping-followup` & `security/npm-dependency-remediation` | Lulus (0 error/warning) |
| `npm run test` | `vitest@4.1.12` pada `security/npm-dependency-remediation` | Lulus (`10` file, `74/74` test) |
| `npm run build` | Vite `6.4.6` production bundle | Sukses |
| `npm run test:e2e` | Playwright Chromium pada `security/npm-dependency-remediation` | Lulus (`5/5` skenario) |
| `python -m unittest discover -s tests/python -v` | Suite pipeline Python | Lulus (`19/19` test) |
| PyQGIS `scripts/build_qgis_pack.py` & `--verify-only` | `docs/qgis-readme-sync` (`FireReach_Medan_QGIS_Pack.zip`) | Lulus (`22` entri, `3.096.932` byte, `0` path absolut, `0` geometri invalid, parity README `True`) |
| `npm audit --json` (pasca-remediasi) | `security/npm-dependency-remediation` | `0 vulnerabilities` |
| GitHub Actions `verify` & Vercel Preview | PR #13 (merged), PR #14 (open), PR #15 (open) | Seluruhnya `completed / success` |
