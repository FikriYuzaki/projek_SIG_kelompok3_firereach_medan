# FireReach Medan

Aplikasi Web GIS untuk **pemetaan kejadian kebakaran dan analisis cakupan layanan Dinas Pemadam Kebakaran dan Penyelamatan (Damkarmat) Kota Medan**.

- **Aplikasi Production**: [https://firereach-medan.vercel.app](https://firereach-medan.vercel.app)
- **Release Manifest Aktif**: `2026-11-27-prod` (`public/data/manifest.json`)
- **Standar CRS**: `EPSG:4326` (WGS 84 untuk pertukaran GeoJSON/PostGIS) dan `EPSG:32647` (WGS 84 / UTM Zone 47N untuk kalkulasi jarak jaringan jalan, luas, dan KDE di QGIS/Python)

---

## Empat Modul Utama (Status: `active`)

Seluruh empat modul analisis aktif di shell aplikasi dan berjalan pada mode lokal maupun Supabase terhubung tanpa fallback `DEMO` pada runtime.

| Modul & Route | Pemilik | Fokus Analisis & Keterbatasan Data Aktual |
|---|---|---|
| **Fire Incident Explorer** (`/incident-explorer`) | Fikri | Menampilkan seri statistik resmi Damkarmat (2016-2025), pembanding BPBD, penyelamatan non-kebakaran, log anomali kualitas data resmi, simulasi rute respons Damkarmat berbasis graf jalan OSM (Canvas 2D + fallback SVG 2D), serta katalog terpisah **34 kandidat insiden kebakaran sumber publik periode 2024-2026** (**22** berlokasi ruas/landmark OSM berstatus `approximate` dan **12** berstatus `district_only` tanpa koordinat titik). |
| **Fire Hotspot Analyzer** (`/hotspot-analyzer`) | Adeptri | Menampilkan **KDE eksploratif** (`EPSG:32647`, kernel Quartic, `34` zona 4 kelas) menggunakan **22 titik insiden publik berkoordinat** (`12` catatan `district_only` dikecualikan). Hasil KDE ini bersifat eksploratif, bukan statistik resmi lengkap, dan bukan prediksi kejadian kebakaran. |
| **Fire Station Coverage** (`/station-coverage`) | Adriel | Membandingkan analisis cakupan jaringan jalan OSM (`2 km`, `3 km`, `5 km`) dengan buffer Euclidean serta partisi layanan 5 km menggunakan **1 Mako terverifikasi** (`MAKO-00`) dan **6 kandidat pos UPT** (**4** kandidat memiliki koordinat perkiraan `approximate`, sedangkan **2** kandidat tidak memiliki geometri / `district_only`). Hasil cakupan tetap **provisional** dan konversi waktu dengan asumsi kecepatan **35 km/jam** bukan waktu respons aktual di lapangan. |
| **Fire Service Priority Planner** (`/priority-planner`) | Olo | Mengevaluasi prioritas layanan pada **21 kecamatan** Kota Medan menggunakan metode **`priority-v2.0-integrated`** (menggabungkan beban kebakaran historis 2023, kesenjangan jangkauan layanan 5 km baseline/multi-pos, kepadatan penduduk BPS 2025, overlay diagnostik KDE eksploratif, dan simulasi bobot what-if di browser). Hasil indeks tetap **provisional** dan bukan prediksi risiko. |

Ringkasan detail tiap modul dapat dilihat pada README di masing-masing folder:
- [Fire Incident Explorer](./src/features/incident-explorer/README.md)
- [Fire Hotspot Analyzer](./src/features/hotspot-analyzer/README.md)
- [Fire Station Coverage](./src/features/station-coverage/README.md)
- [Fire Service Priority Planner](./src/features/priority-planner/README.md)

---

## Stack Teknologi

- **Frontend**: Vite + Vanilla JavaScript (ES Modules), HTML5, CSS3
- **Peta Spasial 2D**: Leaflet (beserta Canvas 2D dan fallback SVG 2D untuk simulasi respons jaringan jalan)
- **Visualisasi Grafik**: Chart.js
- **Database & Backend**: Supabase + PostgreSQL + PostGIS (mendukung mode lokal otomatis membaca berkas statis di `public/data/` saat kredensial tidak dikonfigurasi)
- **Pipeline Data & Analisis Spasial**: Python 3.12 dan QGIS Desktop (`3.44.13 LTR` / PyQGIS)
- **Pengujian & Linting**: ESLint, Vitest (unit dan kontrak), Playwright Chromium (E2E dan responsif), serta Python `unittest`

---

## Instalasi & Menjalankan Secara Lokal

Prasyarat: Node.js 20+ (disarankan Node.js 22 sesuai workflow CI) dan npm; Python 3.12+ untuk script data dan pengujian pipeline Python.

```bash
git clone https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan.git
cd projek_SIG_kelompok3_firereach_medan
npm ci
npm run dev
```

Secara default aplikasi berjalan pada **Mode Lokal** dengan membaca dataset tervalidasi dari `public/data/` tanpa memerlukan kredensial Supabase. Untuk menguji bundel produksi secara lokal setelah build:

```bash
npm run build
npm run preview
```

---

## Konfigurasi Environment Supabase

Aplikasi mendukung mode baca-saja ke Supabase (`public.app_data_snapshots` dan tabel terkurasi dengan Row Level Security):

1. Salin berkas contoh [`.env.example`](./.env.example) menjadi `.env` (file `.env` diabaikan oleh `.gitignore` dan tidak boleh di-commit).
2. Isi variabel berikut di `.env` atau di dashboard Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Jangan pernah menempatkan `service_role` key atau kredensial privat di kode frontend maupun variabel `VITE_*`.
4. Jika variabel Supabase kosong atau snapshot jarak jauh belum cocok dengan versi rilis `2026-11-27-prod`, klien secara otomatis memuat payload tervalidasi dari `public/data/`.

---

## Perintah Pengujian, Lint, dan Build

```bash
# Linting kode JavaScript
npm run lint

# Pengujian unit & kontrak (Vitest)
npm run test

# Pengujian pipeline GIS Python (KDE, Station Coverage, Priority Planner)
python -m unittest discover -s tests/python -v

# Build bundel produksi Vite ke dist/
npm run build

# Pengujian E2E browser & responsif (Playwright Chromium)
npm run test:e2e
```

Jika lingkungan lokal memiliki QGIS Desktop 3.44.13 LTR terpasang di Windows, verifikasi PyQGIS dan integritas paket QGIS portabel dapat dijalankan melalui:

```powershell
& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" tests/python/qgis_integration_smoke.py
& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" tests/python/qgis_station_priority_smoke.py
& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" scripts/build_qgis_pack.py --verify-only
```

---

## Struktur Folder Repository

```text
firereach-medan/
├── .github/workflows/          # Workflow GitHub Actions CI (lint, Vitest, Python unittest, build, Playwright)
├── data/
│   ├── fixtures/demo/          # Fixture DEMO khusus kontrak pengujian unit (bukan fallback runtime produksi)
│   ├── metadata/               # source-register.csv, data-dictionary.md, qa-report.md
│   └── processed/              # Dataset terproses & staging bundle untuk pipeline/QGIS/Supabase
├── docs/                       # Arsitektur, kontrak modul, katalog data, alur QGIS, DB, deployment, & QA
├── public/data/                # Dataset statis terverifikasi yang disajikan langsung oleh Vite/Vercel
├── qgis/                       # 3 proyek QGIS (.qgz), GeoPackage, GeoJSON lokal, styles (.qml), dan ekspor PNG
├── scripts/                    # Pipeline Python & Node (data builder, routing graph, paket QGIS, staging)
├── src/
│   ├── components/             # Komponen shell (dashboard, about, state-panel, guarded coming-soon)
│   ├── core/                   # Layout, feature-registry, map/charts/supabase wrapper, formatters, notifications
│   ├── features/               # 4 modul fitur mandiri (incident-explorer, hotspot-analyzer, station-coverage, priority-planner)
│   ├── router/                 # Router SPA dan definisi rute
│   └── styles/                 # Design tokens Warm Editorial, base styles, komponen, dan layout responsif
├── supabase/                   # Migrasi SQL skema PostGIS & kebijakan RLS
├── tests/                      # Pengujian unit (Vitest), pipeline GIS (Python/PyQGIS), dan E2E (Playwright)
├── DESIGN.md                   # Spesifikasi visual Warm Editorial, tipografi, kontras WCAG AA, dan aturan gerak
└── FireReach_Medan_QGIS_Pack.zip # Paket portabel 3 proyek QGIS Desktop siap buka
```

---

## Dokumentasi & Paket QGIS

### Paket QGIS Portabel
- [FireReach_Medan_QGIS_Pack.zip](./FireReach_Medan_QGIS_Pack.zip): Arsip portabel berisi tiga proyek `.qgz`, layer relatif `./layers/`, gaya simbologi `.qml`, dan layout peta A4 siap cetak.
- [Panduan Paket QGIS (`qgis/README_QGIS.md`)](./qgis/README_QGIS.md)
- [Laporan QA Proyek QGIS (`qgis/QA_REPORT.md`)](./qgis/QA_REPORT.md)

### Dokumen Teknis & QA Penting
- [Spesifikasi Desain Visual (`DESIGN.md`)](./DESIGN.md)
- [Panduan Tim & Kolaborasi (`docs/TEAM_GUIDE.md`)](./docs/TEAM_GUIDE.md)
- [Arsitektur Sistem (`docs/SYSTEM_ARCHITECTURE.md`)](./docs/SYSTEM_ARCHITECTURE.md)
- [Kontrak Integrasi Modul (`docs/INTEGRATION_CONTRACT.md`)](./docs/INTEGRATION_CONTRACT.md)
- [Katalog & Provenance Data (`docs/DATA_CATALOG.md`)](./docs/DATA_CATALOG.md) dan [Manajemen Direktori Data (`data/README.md`)](./data/README.md)
- [Alur Kerja QGIS (`docs/GIS_WORKFLOW.md`)](./docs/GIS_WORKFLOW.md)
- [Desain Database & PostGIS (`docs/DATABASE_DESIGN.md`)](./docs/DATABASE_DESIGN.md)
- [Panduan Simulasi Respons Damkarmat (`docs/SIMULATION_GUIDE.md`)](./docs/SIMULATION_GUIDE.md)
- [Konfigurasi Deployment Vercel (`docs/DEPLOYMENT.md`)](./docs/DEPLOYMENT.md)
- [Laporan QA Rilis Produksi (`docs/qa/FINAL_QA_REPORT.md`)](./docs/qa/FINAL_QA_REPORT.md)
- [Laporan Pembersihan Data & Artefak (`docs/qa/DATA_CLEANUP_REPORT.md`)](./docs/qa/DATA_CLEANUP_REPORT.md)

---

## Catatan Rilis `2026-11-27-prod`

1. Seluruh empat modul analisis aktif di `src/core/feature-registry.js` dengan antarmuka Warm Editorial yang memisahkan tegas data resmi terverifikasi, pengayaan publik (`needs_review`), KDE eksploratif, dan metrik cakupan/prioritas provisional.
2. Folder runtime `public/data/demo/` serta artefak pratinjau lama telah dihapus; simulasi respons Armada Damkarmat berjalan di atas Leaflet + Canvas 2D dengan fallback SVG 2D pada graf jalan Kota Medan (`public/data/medan_road_graph.json`).
3. Efek interaksi tombol (hover/active) dan skeleton shimmer pada status loading telah ditambahkan dengan dukungan penuh `@media (prefers-reduced-motion: reduce)`.
