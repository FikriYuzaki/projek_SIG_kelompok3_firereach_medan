# Laporan Quality Assurance (QA) Data - FireReach Medan

**Diperbarui:** 2026-11-27

**Pipeline build:** `scripts/build_processed_data.py`, `scripts/build_road_routing_graph.py`, & validasi staging `scripts/import_supabase_staging.mjs --dry-run`

---

## 1. Sembilan Temuan Kualitas Data Resmi & Pembanding (`data_quality_anomalies`)

| ID QA | Periode | Kategori | Ringkasan Temuan | Penanganan di Pipeline & UI |
|---|---|---|---|---|
| `QA-2023-WHITESPACE` | 2023 - 2025 | `normalisasi` | Spasi ganda `'Medan  Kota'`, spasi ekor (`'Medan Denai '`, `'Maret '`, `'MEI '`, `'November '`), dan sel kosong `'\xa0-'`. | Dinormalisasi saat parsing menjadi 21 nama kecamatan dan 12 nama bulan baku tanpa mengubah angka kejadian. |
| `QA-2023-DIST-SCALE-DIFF` | 2023 | `perlu_review` | Selisih `+/-1` kejadian di 8 kecamatan antara file objek vs file skala kecamatan (4 berselisih `+1` dan 4 berselisih `-1`; total kota tetap `219`). | Disimpan eksplisit pada atribut `scale_discrepancy` per kecamatan dan ditampilkan pada tab QA. |
| `QA-2023-SCALE-SPLIT-DIFF` | 2023 | `perlu_review` | Rasio skala kebakaran 2023 berbeda antara rekap kecamatan (`30` Besar / `189` Kecil) dan rekap bulanan (`25` Besar / `194` Kecil). | Kedua rincian disimpan terpisah (`scale_besar/kecil` vs `scale_besar_monthly/kecil_monthly`) tanpa membuang salah satu sumber. |
| `QA-2023-AREA-FORMAT` | 2023 | `anomali_satuan` | Kolom luas lokasi kecamatan mencampur bilangan meter (`968`, `3963`) dan desimal terpotong (`1.84`, `5.53`, `4.33`, `5.46`; total `77.03` vs jumlah bulanan `77.030`). | Nilai asli dipertahankan sebagai string pada `raw_area_reported` dengan `area_anomaly_flag = true`. |
| `QA-2023-LOSS-OUTLIER` | 2023 (Maret) | `anomali_satuan` | Kerugian bulan Maret tercatat `'776'` (selisih tahunan `58.365.000 - 57.589.000 = 776.000`) dan header tidak mencantumkan satuan rupiah. | Nilai `'776'` dipertahankan apa adanya pada `raw_material_loss` bersama `loss_anomaly_flag = true`. |
| `QA-2016-2022-SCOPE` | 2019, 2020, 2021 | `perbedaan_cakupan` | Arsip Kota Medan berbeda dari arsip `+Di Luar Kota Medan`: 2019 (`275` vs `341`), 2020 (`227` vs `228` vs `264` di rekap bulanan), 2021 (`207` vs `208`). | Nilai pembanding disimpan pada `comparison_total_with_outside_medan` & `comparison_rekap_total` dengan `consistency_flag = true`. |
| `QA-BPBD-VS-DAMKAR-SCOPE` | 2021 - 2023 | `perbedaan_cakupan` | Rekapitulasi BPBD mencatat `108` kebakaran (2021), `138` (2022), dan `87` bulanan (2023) dibanding Damkarmat (`207`, `216`, `219`). | Dataset BPBD dipisahkan penuh di bawah `bpbd_comparison` dan mode UI khusus pembanding BPBD (`Pembanding BPBD (Terpisah)`). |
| `QA-BPBD-2022-TOTAL-ROW` | 2022 (BPBD) | `perlu_review` | Baris Kecamatan Medan Tuntungan mencatat `1` kejadian tanah longsor (`total_disasters = 187`), namun baris `JUMLAH` di spreadsheet mencetak `0`. | Rincian 21 kecamatan dipertahankan jujur (`landslide_events = 1` di Medan Tuntungan) dan catatan anomali baris jumlah didokumentasikan eksplisit. |
| `QA-NONFIRE-2024-OCT-NOV` | 2024 (Non-Kebakaran) | `perlu_review` | Operasi penyelamatan non-kebakaran 2024: Oktober mencatat `62` di kolom total kiri vs `61` di jumlah kategori kanan (`+1`), November mencatat `73` vs `74` (`-1`), total setahun identik `691`. | Kedua kolom dipertahankan (`total_rescues` vs `category_sum_total`) beserta `left_vs_category_discrepancy`, serta dipisahkan dari kejadian kebakaran. |

---

## 2. Validasi Geospasial Point-in-Polygon (PIP) & Anti-Fabrication

1. **Batas Administrasi (`21` Kecamatan Kota Medan):** Seluruh `21` kode `12.71.01` - `12.71.21` cocok 1:1 dengan poligon OpenStreetMap Nominatim dalam `EPSG:4326`.
2. **Pos Terverifikasi (`1/1`):** Titik `Mako 0.0` (`3.589536437471534, 98.67144703626451`) lolos uji PIP di dalam poligon Kecamatan `Medan Petisah`.
3. **Kandidat Kejadian Independen (`27` record):**
   - `17/17` titik `approximate` (perkiraan ruas jalan / landmark OSM Nominatim) lolos uji PIP `build_processed_data.py` berada di dalam poligon `district_name` masing-masing.
   - `10/10` record `district_only` tetap bernilai `geom = null` (nol titik centroid kecamatan yang dibuat-buat).
   - Seluruh `27` record memiliki `kde_eligible = false` dan `verification_status = "needs_review"`.
4. **Kandidat Pos UPT Wilayah I - VI (`6` pos) & Audit Regulasi 2026-11-27:**
   - `4/4` titik `approximate` (`UPT-01` Jl. Jamin Ginting / Simpang Selayang di `Medan Tuntungan`, `UPT-02` Jl. Tritura / Amplas di `Medan Amplas`, `UPT-05` Jl. Gaperta di `Medan Helvetia`, `UPT-06` Jl. Letda Sujono di `Medan Tembung`) lolos uji PIP berada di dalam poligon kecamatannya dan diharmonisasikan 1:1 antara `public_station_candidates.json`, `independent_enrichment_input.json`, dan `damkarmat_station_candidates.json`.
   - `2/2` pos tanpa titik ruas terverifikasi (`UPT-03` KIM Mabar / Medan Deli, `UPT-04` Medan Belawan) tetap bernilai `geom = null` (`district_only`, tidak digambar sebagai marker peta).
   - **Audit dasar hukum (`legal_basis_audit`):** `Perwali Medan No. 25 Tahun 2018` (`BD.2018/ No. 25`) pada JDIH BPK RI tercatat `Berlaku` sebagai konteks historis nomenklatur lama (*Dinas P2K*), sementara `jdih.medan.go.id` HTTP 403 Cloudflare; `Perwali Medan No. 12 Tahun 2023` pada JDIH BPK RI ternyata tentang *Percepatan Penurunan Stunting* (bukan UPT Damkarmat); `Perwali No. 39 Tahun 2024` & `Perda No. 6 Tahun 2025` dicatat sebagai rujukan regulasi terkini; dan `p2k.medan.go.id` tetap HTTP 403 Cloudflare pada pemeriksaan ulang `2026-11-27`.

---

## 3. Audit Deduplikasi Media & Ketepatan Timestamp Sumber Independen

- **Inventaris 35 Artikel Publik (`ANTARA Sumut` & `Detik Sumut`):**
  - `27` kejadian unik tersimpan pada `public/data/public_incident_candidates.json` (`2024`: 8, `2025`: 12, `2026`: 7).
  - `6` artikel duplikat/lanjutan digabungkan ke 4 kejadian terkait melalui `additional_source_urls` (`IND-2026-0127-DELI` [3 tautan duplikat], `IND-2025-0723-LABUHAN` [1], `IND-2025-1113-BELAWAN` [1], `IND-2026-0620-JOHOR` [1]).
  - `1` artikel di luar batas Kota Medan (`https://www.detik.com/sumut/berita/d-8549491/...`, Desa Purwodadi, Kec. Sunggal, Kab. Deli Serdang) dikeluarkan dari himpunan kandidat Kota Medan.
  - `1` artikel referensi kelembagaan (`ANTARA 560100`) digunakan khusus untuk dokumentasi peresmian `UPT-05` & `UPT-06`.
- **Audit Ketepatan Waktu & Regulasi (Pasca Audit Cleanup 2026-11-23):**
  - **Tanpa Placeholder `00:00`:** `build_processed_data.py` menguji seluruh `station_reference_articles` dan `records` sehingga tidak ada nilai `T00:00:00+07:00` atau `00:00` palsu.
  - **ANTARA `560100`:** Tanggal peristiwa peresmian (`event_date: "2024-01-26"`) dipisahkan tegas dari timestamp publikasi artikel (`published_at: "2024-01-27T00:32:42+07:00"` sebagaimana JSON-LD sumber resmi ANTARA).
  - **JDIH BPK Perwali No. 25 Tahun 2018:** Tanggal penetapan, pengundangan, dan berlakunya diperiksa langsung pada laman JDIH BPK RI (`2018-02-14`, `BD.2018/ No. 25`), menggantikan placeholder tanggal `2018-01-01`.

---

## 4. Pemeriksaan Lanjutan, Graf Rute Jalan & Status Staging

- `scripts/build_processed_data.py` menghasilkan keluaran deterministik untuk GeoJSON (`53.157` byte), `fire_incidents_summary.json` (`241.675` byte), manifest `17+2`, katalog kandidat (`45.639` + `16.124` byte), dan `supabase_staging_bundle.json` (`238.339` byte).
- `scripts/build_road_routing_graph.py` menghasilkan `public/data/medan_road_graph.json` (`587.909` byte): `8.581` simpul, `9.720` ruas berarah (`1.579,7 km`) dari `medan_roads_utm.gpkg` dalam `EPSG:32647` dengan jarak snap ke 5 pos berkoordinat `14,9 m` - `142,6 m` (`MAKO-00`, `UPT-01`, `UPT-02`, `UPT-05`, `UPT-06`) yang semuanya terjangkau oleh Dijkstra berarah.
- `scripts/import_supabase_staging.mjs --dry-run` memvalidasi `38` `data_sources`, `193` `fire_incident_aggregates`, `7` `fire_stations`, `27` `fire_incidents`, dan `5` `app_data_snapshots` dalam mode dry-run (`remote_db_modified: false`).
- Audit kesesuaian `source-register.csv` (`38` baris) terhadap `data/raw/` memverifikasi seluruh ukuran byte dan SHA-256 cocok tanpa perbedaan.
