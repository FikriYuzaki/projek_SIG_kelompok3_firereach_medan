# Data Quality Assurance (QA) Report

Inspection date: `2026-11-19`
Validator script: `scripts/build_processed_data.py`

## 1. Granularity & Spatial Accuracy Findings

- **2024 (`269` events) & 2025 (`251` events) Fire Recaps**: Both official Satu Data Medan Excel files contain strictly monthly counts across 8 fire object categories (`Rumah`, `Ruko`, `Travo/Kabel Listrik`, `Gudang/Pabrik`, `Kendaraan/Alat Transportasi`, `Lahan`, `Fasilitas Umum`, `Lain-Lain`). Neither file includes kecamatan, street addresses, or coordinates (`location_accuracy = unknown`, `verification_status = unlocated`).
- **2023 District Fire Recap (`219` events)**: Covers all 21 Kecamatan (`location_accuracy = district_only`), suitable for district-level choropleth and ranking, NOT suitable for point KDE.
- **Verified Station Point (`1` point)**: `Mako 0.0` at `Jl. Candi Borobudur No. 2` (`3.589536437471534, 98.67144703626451`) verified inside Medan extent (`lat 3.45..3.85, lon 98.55..98.78`) from official Damkarmat Knowledge dataset.

## 2. Anomalies Caught in Raw Official Spreadsheets

1. **Whitespace inconsistency**: `Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx` stores `"Medan  Kota"` with a double space. Normalized in `scripts/build_processed_data.py`.
2. **Cross-table 2023 district variance (+/-1)**: Although both 2023 district files sum citywide to `219`, 5 individual districts differ by 1 incident between `Rekapitulasi 2023` and `Skala dan Kecamatan 2023`: `Medan Kota` (6 vs 5), `Medan Tembung` (15 vs 14), `Medan Sunggal` (9 vs 10), `Medan Labuhan` (12 vs 13), and `Medan Timur` (16 vs 17). Preserved transparently via `scale_discrepancy`.
3. **Mixed unit formatting in 2023 area & loss tables**:
   - `Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Kecamatan_Tahun_2023.xlsx` mixes unscaled integer meters (`968`, `3963`) with truncated decimal-formatted strings (`1.84`, `5.53`, `4.33`, `5.46`, and total `77.03` instead of ~77,030 m2). Kept strictly as `raw_area_reported` without fabricating corrected numbers.
   - `Jumlah_Kebakaran_Dirinci_Menurut_Korban_Jiwa_Dan_Material_Tahun_2023.xlsx` reports `Maret` loss as `776` compared to millions in every other month (total `58.365.000`). Preserved as `raw_material_loss`.
4. **2020 annual scope discrepancy**: `Rekapitulasi_Kejadian_Kebakaran_Tahun_2020.xlsx` totals `264` events (Jan-Dec), whereas `Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan...2020.xlsx` totals `228` and `2016-2022.xlsx` states `227` (reflecting inside-Medan vs outside-Medan mutual aid scope).
5. **2023 sex-ratio population Excel formatting defect**: `Jumlah_Penduduk_Menurut_Jenis_Kelamin_Rasio_Jenis_Kelamin_Dan_Kecamatan_Di_Kota_Medan_Tahun_2023.xlsx` stored several thousand-separated counts as truncated decimals (for example `'49.52'` instead of `'49,520'`). Excluded from primary joins in favor of clean integer tables `Jumlah_Penduduk_Kepadatan_Penduduk_dan_Distribusi_Penduduk_Kota_Medan_Menurut_Kecamatan_Tahun_2025.xlsx` (`2,498,293` total, sum verified across all 21 districts = `2,498,293`) and `JUMLAH_PENDUDUK_KOTA_MEDAN_BERDASARKAN_KECAMATAN_2022-2024.xlsx`.

## 3. Spatial Geometry Validation (`medan_districts_osm.geojson`)

- All 21 Kecamatan polygons downloaded from OpenStreetMap Nominatim (`admin_level=7`) were checked for closed polygon rings (`ring[0] == ring[-1]`, `>= 4` vertices) and full containment inside Kota Medan extent (`lat 3.45..3.85, lon 98.55..98.78`).
- District names join 21/21 cleanly with BPS area codes (`12.71.01` to `12.71.21`), 2023 fire counts, and 2024/2025 population counts.

## 4. Documented External Access Blockers

- `p2k.medan.go.id` (UPT station infographic & daily fire reports) and `geoportal.medan.go.id` returned `HTTP 403` Cloudflare anti-bot challenges.
- `medankota.bps.go.id` triggered Akamai TSPD (`520`) / Cloudflare protection (superseded by official Satu Data Medan BPS/Disdukcapil files).
- Automated anti-bot bypassing was deliberately avoided; team members must obtain UPT infographic images and official Geoportal shapefiles manually in a desktop browser if required.
