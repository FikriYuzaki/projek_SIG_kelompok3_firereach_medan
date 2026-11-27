# Kamus Data & Kontrak Skema - FireReach Medan

**Diperbarui:** 2026-11-27

**CRS Exchange Web / PostGIS:** `EPSG:4326` (WGS 84)

**CRS Metrik Analisis Spasial:** `EPSG:32647` (WGS 84 / UTM zone 47N)

---

## 1. Enumerasi Standar Lintas Dataset

| Field | Nilai yang Diizinkan | Keterangan |
|---|---|---|
| `granularity` | `individual`, `district_aggregate`, `monthly_aggregate`, `annual_aggregate`, `policy_table`, `station_point`, `polygon`, `network` | Di Supabase staging `public.data_sources`, `annual_aggregate` dipetakan aman ke `policy_table` dengan catatan `[original_granularity: annual_aggregate]`. |
| `location_accuracy` | `exact_verified`, `address_geocoded_verified`, `approximate`, `district_only`, `unknown` | Hanya `exact_verified` dan `address_geocoded_verified` yang boleh masuk KDE default (`kde_eligible = true`). |
| `verification_status` | `verified`, `needs_review`, `unlocated`, `fallback_osm` | Seluruh kandidat media independen & UPT wajib bernilai `needs_review`. |
| `occurred_time_precision` | `exact_minute`, `approximate_window`, `date_only_unknown_time` | Melarang pembuatan waktu palsu `00:00` atau `T00:00:00+07:00` ketika jam kejadian tidak tercatat pada sumber. |
| `dataLabel` | `UNVERIFIED_CANDIDATES`, `DEMO` | Membedakan secara eksplisit kandidat media terbuka (`isDemo: false`) dari fixture sintetis (`isDemo: true`). |

---

## 2. `public/data/manifest.json`

| Bagian | Tipe & Jumlah | Field Utama |
|---|---|---|
| `verified_outputs` | Object (3 modul) | `hotspot-analyzer` (`available: false`, `pending_verified_points`), `station-coverage` (`provisional`), `priority-planner` (`provisional`). |
| `datasets` | Array (`17` entri) | `id`, `title`, `publisher`, `period`, `granularity`, `location_accuracy`, `record_count`, `status`, opsional `dataset_group`, opsional `license`, `sha256`, `url`. |
| `independent_enrichment` | Object (`2` entri) | `scope_note` dan `datasets[]` (`medan-fire-incident-candidates`, `medan-damkarmat-upt-candidates`) dengan `record_count`, `accuracy_summary`, `status: "needs_review"`, `path`, `sha256`. |
| `blockers` | Array (`4` entri) | `source`, `url`, `reason`. |

---

## 3. `public/data/fire_incidents_summary.json`

| Kunci Tingkat Atas | Jumlah / Struktur | Keterangan Kontrak |
|---|---|---|
| `summary_totals` | Object (`18` metrik ringkas) | Memuat `year_2023` (`219`), `year_2024` (`269`), `year_2025` (`251`), `district_count` (`21`), `individual_geocoded_count` (`0`), `verified_station_count` (`1`), `population_2025_total` (`2.498.293`), `monthly_2016_2021_total` (`1.372`), `bpbd_fire_2021` (`108`), `bpbd_fire_2022` (`138`), `bpbd_fire_2023` (`87`), `non_fire_rescues_2023_2025_total` (`2.218`), `spm_response_time_minutes` (`13.1`), `independent_candidate_incidents_total` (`27`), `independent_candidate_incidents_approximate` (`17`), `independent_candidate_incidents_district_only` (`10`), `candidate_station_count` (`6`). |
| `district_2023` | Array (`21` kecamatan) | Agregat resmi 2023 per kecamatan (`area_code`, `district_name`, `categories` 8 objek, `total_incidents`, `scale_besar`, `scale_kecil`, `scale_discrepancy`, `raw_area_reported`, `area_anomaly_flag`). |
| `monthly_2024` & `monthly_2025` | Masing-masing `12` bulan | Agregat bulanan resmi Damkarmat menurut 8 kategori objek (`geom = null`). |
| `monthly_2023_impact` | Array (`12` bulan) | Korban jiwa (`injured`, `fatalities`), `scale_besar_monthly`, `scale_kecil_monthly`, `raw_material_loss`, `loss_anomaly_flag`, `raw_area_reported_monthly`. |
| `annual_series` | Array (`10` tahun: `2016 - 2025`) | Total resmi Kota Medan per tahun beserta `comparison_total_with_outside_medan`, `comparison_rekap_total`, dan `consistency_flag` untuk perbedaan 2019, 2020, 2021. |
| `monthly_2016_2021` | Array (`72` baris) | Agregat bulanan Damkarmat Januari 2016 - Desember 2021 (`total_incidents` berjumlah `1.372`). |
| `bpbd_comparison` | Object (`district_2022` [21], `monthly_2022` [12], `monthly_2023` [12]) | Seri pembanding BPBD: `fire_incidents`, `fire_incidents_2021` (pada `district_2022`), `flood_events`, `wind_events`, `landslide_events`, `total_disasters`, `granularity`, `verification_status`. `monthly_2022` (`138` kebakaran / `187` bencana) + `monthly_2023` (`87` kebakaran / `116` bencana) berjumlah `24` baris (`225` kebakaran / `303` bencana). |
| `damkarmat_spm` | Array (`2` indikator) | Indikator resmi SPM Damkarmat (`unit: "%"` -> `100%` target & realisasi; `unit: "menit"` -> target `15.00`, realisasi `13.10`). |
| `non_fire_rescues` | Object (`monthly_series` [36], `combined_total`: `2218`) | Operasi penyelamatan non-kebakaran (`is_fire_incident` implisit `false`, `total_rescues`, `category_sum_total`, `left_vs_category_discrepancy`, `dominant_rescue_type`, `dominant_rescue_count`). |
| `verified_stations` | Array (`1` pos: `MAKO-00`) | Titik resmi Mako 0.0 Damkarmat pada Jl. Candi Borobudur No. 2 (`3.589536437471534, 98.67144703626451`). |
| `candidate_stations` & `independent_incident_candidates` | Ringkasan + seluruh record kandidat | Mirror terstruktur dari dua katalog JSON kandidat agar dapat dibaca Explorer dalam satu siklus pemuatan tanpa fetch tak terduga. |
| `unlocated_register` | Array (`4` batch) | Daftar dataset resmi bergranularitas agregat (`UNLOC-2025-MONTHLY`, `UNLOC-2024-MONTHLY`, `DIST-2023-KECAMATAN`, `UNLOC-2016-2022-ANNUAL`). |
| `data_quality_anomalies` | Array (`9` temuan QA) | Dokumentasi anomali sumber resmi, BPBD, dan non-kebakaran (`anomaly_id`, `period`, `severity`, `summary`, `resolution`, `source_files`). |

---

## 4. `public/data/public_incident_candidates.json`

- **Header Katalog:** `isDemo: false`, `dataLabel: "UNVERIFIED_CANDIDATES"`, `metadata` (`articles_inspected_total: 35`, `primary_incident_articles: 27`, `deduplicated_followup_articles: 6`, `excluded_non_medan_articles: 1`, `non_incident_station_articles: 1`, `disclaimer`), `summary` (`total_candidates: 27`, `approximate_point_count: 17`, `district_only_count: 10`, `kde_eligible_count: 0`, `verified_count: 0`), `excluded_or_deduplicated_articles[]`.
- **Skema Tiap Record (`records[]`):** `source_record_id`, `period_year`, `occurred_on`, `occurred_time_wib` (null jika tidak diketahui), `occurred_time_precision`, `occurred_at`, `reported_at_wib`, `extinguish_window_wib`, `published_at` (ISO-8601 terpisah dari waktu kejadian), `district_name`, `subdistrict_name`, `address_text`, `object_summary`, `object_type`, `dispatched_units_note`, `location_accuracy` (`approximate` | `district_only`), `verification_status` (`needs_review`), `kde_eligible` (`false`), `lat`, `lon`, `geom` (`Point` EPSG:4326 atau `null`), `osm_ref`, `source_name`, `source_url`, `additional_source_urls[]`, `review_notes`.

---

## 5. `public/data/damkarmat_station_candidates.json` & `public/data/medan_road_graph.json`

- **Header & Referensi (`damkarmat_station_candidates.json`):** `isDemo: false`, `dataLabel: "UNVERIFIED_CANDIDATES"`, `summary` (`total_candidates: 6`, `approximate_point_count: 4`, `district_only_count: 2`, `verified_station_count: 0`, `p2k_medan_blocked: true`), `legal_basis_audit`, dan `reference_articles[]`:
  - `ANTARA News Sumut (560100)`: memuat `event_date: "2024-01-26"` dan `published_at: "2024-01-27T00:32:42+07:00"` secara terpisah.
  - `Portal Pemko Medan` (artikel peresmian UPT 1 - VI): memuat `published_at: "2024-01-26T18:00:00+07:00"`.
  - `Perwali Kota Medan No. 25 Tahun 2018 (JDIH BPK RI)`: memuat `published_at / enacted_on / promulgated_on / effective_on = "2018-02-14"` serta `official_gazette: "BD.2018/ No. 25"`; ditandai hanya sebagai konteks pembentukan historis dengan nomenklatur lama (*Dinas P2K*), bukan bukti lokasi bangunan fisik pos.
- **Skema Tiap Pos (`stations[]`):** `station_code` (`UPT-01` s.d. `UPT-06`), `name`, `station_type: "upt"`, `address`, `district_name`, `location_accuracy`, `verification_status: "needs_review"`, `operational_status`, `legal_basis_note`, `retrieved_at`, `limitation_note`, `lat`, `lon`, `geom` (`null` pada `UPT-03` dan `UPT-04`; `Point` perkiraan ruas OSM pada `UPT-01`, `UPT-02`, `UPT-05`, `UPT-06`), `osm_ref`, `source_name`, `source_url`, `evidence_urls[]`, `conflict_notes`.
- **Graf Jalan Simulasi (`public/data/medan_road_graph.json`):** memuat `metadata` (`source`, `working_crs: "EPSG:32647"`, `output_crs: "EPSG:4326"`, `node_count: 8581`, `edge_count: 9720`, `total_length_km: 1579.7`, `station_snap_distances_m`), `nodes` (`[lon, lat]` berindeks), dan `edges` (`[u, v, length_m, oneway_dir, highway_code]`).

---

## 6. `data/processed/supabase_staging_bundle.json`

- **Flag Keamanan:** `staging_only: true`, `remote_db_modified: false` (seluruh `schema_recommendations[*].migration_applied = false`).
- **Tabel Staging (`tables`):** `data_sources` (`38` baris), `fire_incident_aggregates` (`193` baris), `fire_stations` (`7` baris: `1` Mako + `6` kandidat UPT), `fire_incidents` (`27` kandidat), `app_data_snapshots` (`5` snapshot). Blok `separated_non_fire_and_spm` menyimpan `damkarmat_spm` dan `non_fire_rescues` secara terpisah.
