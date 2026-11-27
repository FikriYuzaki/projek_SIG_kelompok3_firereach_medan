# Katalog Sumber Data - FireReach Medan

**Diperbarui:** 2026-11-27

**Register sumber induk:** [source-register.csv](../../data/metadata/source-register.csv) (`38` entri sumber; seluruh berkas lokal pada `data/raw/` lolos audit byte & SHA-256)

**Manifest web publik:** [manifest.json](../../public/data/manifest.json) (`17` dataset tervalidasi/fallback + `2` katalog kandidat independen + `4` blocker sumber + graf rute `medan_road_graph.json`)

---

## 1. Ringkasan Cakupan & Prinsip Pemisahan

Seluruh dataset pada repositori ini menjaga pemisahan tegas antara:
1. **Statistik kebakaran resmi Dinas Damkarmat Kota Medan** (`damkarmat_fire`), yang menjadi sumber angka kebakaran resmi Kota Medan.
2. **Dataset pembanding BPBD Kota Medan** (`bpbd_comparison`), yang disajikan terpisah karena menggunakan kriteria insiden kebencanaan yang berbeda (`108` kebakaran di 2021, `138` di 2022, dan `87` bulanan di 2023).
3. **Standar Pelayanan Minimal (SPM) dan penyelamatan non-kebakaran Damkarmat** (`damkarmat_spm`, `damkarmat_non_fire`), termasuk `2.218` operasi evakuasi non-kebakaran (2023 - 2025) yang ditandai `is_fire_incident = false` dan tidak pernah dijumlahkan ke angka kebakaran.
4. **Kandidat pengayaan publik independen (`UNVERIFIED_CANDIDATES`)**, berasal dari media berita terbuka dan dokumen regulasi JDIH (`27` kandidat kejadian kebakaran + `6` kandidat pos UPT), seluruhnya berstatus `needs_review` dan dikecualikan dari kalkulasi KDE maupun layer pos terverifikasi.

---

## 2. Daftar Dataset Resmi & Fallback Spasial (`manifest.json`: 17 Entri + Graf Jalan)

| ID Manifest | Dataset | Penerbit | Periode | Granularitas | Akurasi Lokasi | Jumlah / Cakupan | Status |
|---|---|---|---|---|---|---|---|
| `medan-fire-2016-2021-bulanan` | Kebakaran Per Bulan Kota Medan 2016 - 2021 | Damkarmat Medan (Satu Data Medan) | Jan 2016 - Des 2021 | `monthly_aggregate` | `unknown` | `1.372` (72 baris) | `verified` |
| `medan-fire-2023-kecamatan` | Rekapitulasi Kebakaran Menurut Kecamatan 2023 | Damkarmat Medan (Satu Data Medan) | 2023 | `district_aggregate` | `district_only` | `219` (21 kecamatan) | `verified` |
| `medan-fire-2024` | Rekapitulasi Kebakaran Kota Medan 2024 | Damkarmat Medan (Satu Data Medan) | Jan - Des 2024 | `monthly_aggregate` | `unknown` | `269` (12 bulan) | `verified` |
| `medan-fire-2025` | Rekapitulasi Kebakaran Kota Medan 2025 | Damkarmat Medan (Satu Data Medan) | Jan - Des 2025 | `monthly_aggregate` | `unknown` | `251` (12 bulan) | `verified` |
| `bpbd-kebencanaan-2021-kecamatan` | BPBD Rekapitulasi Bencana per Kecamatan 2021 | BPBD Medan (Satu Data Medan) | 2021 | `district_aggregate` | `district_only` | `108` kebakaran / `152` bencana | `verified` (`bpbd_comparison`) |
| `bpbd-kebencanaan-2022-kecamatan` | BPBD Rekapitulasi Kebencanaan per Kecamatan 2022 | BPBD Medan (Satu Data Medan) | 2022 | `district_aggregate` | `district_only` | `138` kebakaran / `187` bencana | `verified` (`bpbd_comparison`) |
| `bpbd-kebencanaan-2022-bulanan` | BPBD Rekapitulasi Bencana Jenis & Bulan 2022 | BPBD Medan (Satu Data Medan) | Jan - Des 2022 | `monthly_aggregate` | `unknown` | `138` kebakaran / `187` bencana | `verified` (`bpbd_comparison`) |
| `bpbd-kebencanaan-2023-bulanan` | BPBD Kejadian Kebencanaan Jenis per Bulan 2023 | BPBD Medan (Satu Data Medan) | Jan - Des 2023 | `monthly_aggregate` | `unknown` | `87` kebakaran / `116` bencana | `verified` (`bpbd_comparison`) |
| `bpbd-rekapitulasi-2021-2022` | BPBD Rekapitulasi Total Kebencanaan 2021 - 2022 | BPBD Medan (Satu Data Medan) | 2021 - 2022 | `annual_aggregate` | `unknown` | `339` total bencana | `verified` (`bpbd_comparison`) |
| `medan-damkarmat-spm` | Target & Realisasi SPM Dinas Damkarmat | Damkarmat Medan (Satu Data Medan) | 2023 - 2024 | `policy_table` | `unknown` | `2` indikator (`100%`, `13,10 mnt`) | `verified` (`damkarmat_spm`) |
| `medan-non-fire-rescues-2023` | Penyelamatan Non-Kebakaran 2023 | Damkarmat Medan (Satu Data Medan) | Jan - Des 2023 | `monthly_aggregate` | `unknown` | `449` operasi | `verified` (`damkarmat_non_fire`) |
| `medan-non-fire-rescues-2024` | Penyelamatan Non-Kebakaran 2024 | Damkarmat Medan (Satu Data Medan) | Jan - Des 2024 | `monthly_aggregate` | `unknown` | `691` operasi | `verified` (`damkarmat_non_fire`) |
| `medan-non-fire-rescues-2025` | Penyelamatan Non-Kebakaran 2025 | Damkarmat Medan (Satu Data Medan) | Jan - Des 2025 | `monthly_aggregate` | `unknown` | `1.078` operasi | `verified` (`damkarmat_non_fire`) |
| `medan-population-2025` | Jumlah, Kepadatan & Distribusi Penduduk 2025 | BPS Kota Medan (Satu Data Medan) | 2025 | `district_aggregate` | `district_only` | `21` kecamatan (`2.498.293` jiwa) | `verified` |
| `medan-damkarmat-mako` | Koordinat Resmi Mako 0.0 Dinas Damkarmat | Damkarmat Medan (Satu Data Medan) | 2025 - 2026 | `station_point` | `exact_verified` | `1` pos (`Jl. Candi Borobudur No. 2`) | `verified` |
| `medan-districts-osm` | Batas Administrasi 21 Kecamatan Kota Medan | OpenStreetMap Nominatim (ODbL 1.0) | 2026-11-19 | `polygon` | `district_only` | `21` poligon (`EPSG:4326`) | `fallback_osm` |
| `medan-roads-osm` | Jaringan Jalan Drivable Kota Medan | Geofabrik / OSM Contributors (ODbL 1.0) | 2026-11-20 | `network` | `unknown` | `44.522` segmen / `6.723,27 km` (`EPSG:32647`) | `fallback_osm` |

> **Graf Rute Simulasi (`public/data/medan_road_graph.json`, `587.909` byte):** Turunan dari `data/interim/medan_roads_utm.gpkg` (`11` kelas jalan kendaraan `motorway` s.d. `unclassified`, panjang terukur `EPSG:32647`, arah `oneway` dipertahankan, subdivisi segmen maksimal `250 m`) menghasilkan `8.581` simpul dan `9.720` ruas berarah (`1.579,7 km`) untuk rute terpendek simulasi skenario (non-resmi).
>
> **Sumber Pendukung Tambahan di `source-register.csv` (`38` baris total):**
> Selain 17 entri manifest di atas, `source-register.csv` merekam workbook resmi skala/dampak 2023 (`SRC-FIRE-2023-SCALE`, `SRC-FIRE-2023-LOSS`, `SRC-FIRE-2023-SCALE-MONTHLY`), seri tahunan & penanggulangan 2016 - 2022 (`SRC-FIRE-2016-2022`, `SRC-FIRE-2016-EXT` s.d. `SRC-FIRE-2022-EXT`, `SRC-FIRE-2020-REKAP`, `SRC-FIRE-2022-REKAP`), kependudukan 2022 - 2024 (`SRC-POP-2022-2024`), 3 portal terblokir, serta 4 entri sumber pengayaan independen (`SRC-IND-ANTARA-SUMUT`, `SRC-IND-DETIK-SUMUT`, `SRC-LEGAL-PERWALI-25-2018`, `SRC-GEO-NOMINATIM-CANDIDATES`).

---

## 3. Katalog Pengayaan Kandidat Independen (`needs_review`, Non-KDE) & Audit Regulasi

| ID Katalog | File Publik | Jumlah & Akurasi | Cakupan & Verifikasi Sumber | Status |
|---|---|---|---|---|
| `medan-fire-incident-candidates` | `public/data/public_incident_candidates.json` | `27` kejadian unik (`2024`: 8, `2025`: 12, `2026`: 7): `17` `approximate` (ruas/landmark OSM Nominatim di dalam poligon kecamatan) + `10` `district_only` (`geom = null`); `0` `kde_eligible` | Disaring dari `35` artikel publik ANTARA Sumut & Detik Sumut: `6` artikel duplikat ditautkan pada `additional_source_urls`, `1` artikel luar Medan (`d-8549491` Kec. Sunggal, Kab. Deli Serdang) dikeluarkan, `1` artikel peresmian UPT (`ANTARA 560100`) | `needs_review` |
| `medan-damkarmat-upt-candidates` | `public/data/damkarmat_station_candidates.json` | `6` pos (`UPT-01` s.d. `UPT-06`): `4` `approximate` (`UPT-01` Jl. Jamin Ginting / Simpang Selayang, `UPT-02` Jl. Tritura / Amplas, `UPT-05` Jl. Gaperta, `UPT-06` Jl. Letda Sujono) + `2` `district_only` (`UPT-03`, `UPT-04`, `geom = null`); `0` terverifikasi | `ANTARA 560100` (`event_date: 2024-01-26`, `published_at: 2024-01-27T00:32:42+07:00`), artikel Portal Pemko Medan (`2024-01-26T18:00:00+07:00`), serta audit regulasi JDIH BPK RI: `Perwali Medan No. 25 Tahun 2018` (`BD.2018/ No. 25`, `2018-02-14`, masih tercatat `Berlaku` di JDIH BPK RI sebagai konteks pembentukan historis dengan nomenklatur lama *Dinas P2K*, bukan bukti bangunan pos fisik); `jdih.medan.go.id` HTTP 403 Cloudflare; `Perwali Medan No. 12 Tahun 2023` di JDIH BPK RI tercatat mengatur *Percepatan Penurunan Stunting* (bukan UPT Damkarmat); `Perwali No. 39 Tahun 2024` (MERCY) & `Perda No. 6 Tahun 2025` dicatat sebagai rujukan regulasi terkini | `needs_review` |

---

## 4. Pembatasan Akses & Blocker Sumber (`blockers`: 4 Entri)

| ID Register | Sumber | URL | Status & Mitigasi |
|---|---|---|---|
| `SRC-STATION-UPT` | Portal Berita & Infografis Pos UPT Pemko Medan | `https://p2k.medan.go.id/berita/Infografis-Letak-Pos-Damkarmat-Kota-Medan.html` | `blocked` - HTTP 403 Cloudflare anti-bot challenge (`challenges.cloudflare.com`, diperiksa ulang `2026-11-27`); tidak dilakukan bypass. Kandidat UPT dicatat terpisah pada `damkarmat_station_candidates.json`. |
| `SRC-BOUNDARY-GEOPORTAL` | Geoportal Kota Medan (Katalog Batas Kelurahan/Kecamatan) | `https://geoportal.medan.go.id/main/katalog` | `blocked` - HTTP 403 Cloudflare anti-bot challenge; digantikan sementara oleh batas 21 kecamatan OpenStreetMap (ODbL 1.0). |
| `SRC-POP-BPS-PORTAL` | Portal Tabel Statistik Langsung BPS Kota Medan | `https://medankota.bps.go.id/id/statistics-table/2/MzEjMg%3D%3D/undefined` | `blocked` - Proteksi TSPD HTTP 520 & Cloudflare; diatasi penuh oleh tabel resmi BPS/Disdukcapil 2022 - 2025 pada Satu Data Medan. |
| `SRC-ROADS-GEOFABRIK` | Ekstrak Jaringan Jalan Sumatra OSM (`sumatra-latest.osm.pbf`) | `https://download.geofabrik.de/asia/indonesia/sumatra/sumatra-latest.osm.pbf` | File mentah 270 MB disimpan di `data/raw/` (`gitignored`); jaringan jalan terpotong Wilayah Kota Medan tersedia pada `data/interim/medan_roads_utm.gpkg`, `public/data/medan_road_graph.json`, dan `public/data/station-coverage.provisional.json`. |

---

## 5. Keluaran Provisional Analisis & Staging Supabase

- **Station Coverage (`station-coverage.provisional.json`):** berstatus `provisional` - baseline resmi hanya memakai `1` pos terverifikasi (`Mako 0.0`) di atas jaringan jalan OSM (`EPSG:32647`); skenario sensitivitas eksploratif memodelkan `MAKO-00` + `4` kandidat `approximate` (`UPT-01, UPT-02, UPT-05, UPT-06`), sementara `UPT-03` dan `UPT-04` (`district_only`, `geom = null`) tetap dikecualikan.
- **Priority Planner (`priority-planner.provisional.json`):** berstatus `provisional` - indeks komposit 3 faktor pada `21` kecamatan menggunakan agregat kebakaran resmi 2023 (`district_aggregate`), kepadatan penduduk BPS 2025, dan gap jarak 5 km Mako 0.0.
- **Supabase Staging Bundle (`data/processed/supabase_staging_bundle.json`):** disiapkan dengan `staging_only: true` dan `remote_db_modified: false`, berisi `38` baris `data_sources`, `193` baris `fire_incident_aggregates`, `7` baris `fire_stations`, `27` baris `fire_incidents`, `5` `app_data_snapshots`, dan `4` `schema_recommendations` (belum ada migrasi remote yang dijalankan).
