# Data Quality Assurance (QA) Report

Inspection date: `2026-11-19`
Validator script: `scripts/build_processed_data.py`

## 1. Granularity & Spatial Accuracy Findings

- **2024 (`269` events) & 2025 (`251` events) Fire Recaps**: Both official Satu Data Medan Excel files contain strictly monthly counts across 8 fire object categories (`Rumah`, `Ruko`, `Travo/Kabel Listrik`, `Gudang/Pabrik`, `Kendaraan/Alat Transportasi`, `Lahan`, `Fasilitas Umum`, `Lain-Lain`). Neither file includes kecamatan, street addresses, or coordinates (`location_accuracy = unknown`, `verification_status = unlocated`).
- **2023 District Fire Recap (`219` events)**: Covers all 21 Kecamatan (`location_accuracy = district_only`), suitable for district-level choropleth and ranking, NOT suitable for point KDE.
- **Verified Station Point (`1` point)**: `Mako 0.0` at `Jl. Candi Borobudur No. 2` (`3.589536437471534, 98.67144703626451`) verified inside Medan extent (`lat 3.45..3.85, lon 98.55..98.78`) from official Damkarmat Knowledge dataset.

## 2. Anomalies Caught in Raw Official Spreadsheets

1. **Whitespace inconsistency**: `Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx` stores `"Medan  Kota"` with a double space, plus trailing spaces on `"Medan Denai "`, `"Maret "`, `"MEI "`, `"JULI "`, `"November "`, and non-breaking dash tokens (`\xa0-`). Normalized in `scripts/build_processed_data.py` and UI helpers without altering event counts.
2. **Cross-table 2023 district variance (+/-1 across 8 districts)**: Although both 2023 district files sum citywide to `219`, 8 individual districts differ by `+/-1` incident between `Rekapitulasi 2023` and `Skala dan Kecamatan 2023` (four `+1` and four `-1`, canceling out in the total): `Medan Kota` (6 vs 5), `Medan Tembung` (15 vs 14), `Medan Petisah` (11 vs 10), `Medan Helvetia` (9 vs 8), `Medan Baru` (5 vs 6), `Medan Timur` (16 vs 17), `Medan Sunggal` (9 vs 10), and `Medan Labuhan` (12 vs 13). Preserved transparently via `scale_discrepancy`.
3. **Cross-table 2023 scale split variance (`30/189` vs `25/194`)**: `Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Kecamatan_Tahun_2023.xlsx` reports `30` Besar + `189` Kecil (`219`), whereas `Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Luas_Lokasi_Tahun_2023.xlsx` reports `25` Besar + `194` Kecil (`219`). Both breakdowns are retained separately without silently picking one.
4. **Mixed unit formatting in 2023 area & loss tables**:
   - `Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Kecamatan_Tahun_2023.xlsx` mixes unscaled integer meters (`968`, `3963`) with truncated decimal-formatted strings (`1.84`, `5.53`, `4.33`, `5.46`, and total `77.03`, whereas the 12 monthly rows in `Skala_dan_Luas_Lokasi_Tahun_2023.xlsx` sum to `77,030 m2` while its total row also prints `77.03`). Kept strictly as `raw_area_reported` with `area_anomaly_flag`.
   - `Jumlah_Kebakaran_Dirinci_Menurut_Korban_Jiwa_Dan_Material_Tahun_2023.xlsx` reports `Maret` loss as `776` compared to `57.589.000` across the other 11 months against the reported `58.365.000` annual total (`58.365.000 - 57.589.000 = 776.000`), and the spreadsheet header omits the currency unit. Preserved as `raw_material_loss` with `loss_anomaly_flag`.
5. **2016-2022 annual vs outside-Medan scope discrepancies**: `Jumlah_Kebakaran_Di_Kota_Medan_Tahun_2016_-_2022.xlsx` covers *Kota Medan* (`1,588` events total), whereas the `Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi` monthly files differ in `2019` (`275` vs `341`), `2020` (`227` vs `228`, while `Rekapitulasi_Kejadian_Kebakaran_Tahun_2020.xlsx` totals `264`), and `2021` (`207` vs `208`). Preserved in `annual_series` with `comparison_total_with_outside_medan`, `comparison_rekap_total`, and `consistency_flag`.
6. **2023 sex-ratio population Excel formatting defect**: `Jumlah_Penduduk_Menurut_Jenis_Kelamin_Rasio_Jenis_Kelamin_Dan_Kecamatan_Di_Kota_Medan_Tahun_2023.xlsx` stored several thousand-separated counts as truncated decimals (for example `'49.52'` instead of `'49,520'`). Excluded from primary joins in favor of clean integer tables `Jumlah_Penduduk_Kepadatan_Penduduk_dan_Distribusi_Penduduk_Kota_Medan_Menurut_Kecamatan_Tahun_2025.xlsx` (`2,498,293` total, sum verified across all 21 districts = `2,498,293`) and `JUMLAH_PENDUDUK_KOTA_MEDAN_BERDASARKAN_KECAMATAN_2022-2024.xlsx`.

## 3. Spatial Geometry Validation (`medan_districts_osm.geojson`)

- All 21 Kecamatan polygons downloaded from OpenStreetMap Nominatim (`admin_level=7`) were checked for closed polygon rings (`ring[0] == ring[-1]`, `>= 4` vertices) and full containment inside Kota Medan extent (`lat 3.45..3.85, lon 98.55..98.78`).
- District names join 21/21 cleanly with BPS area codes (`12.71.01` to `12.71.21`), 2023 fire counts, and 2024/2025 population counts.

## 4. Documented External Access Blockers

- `p2k.medan.go.id` (UPT station infographic & daily fire reports) and `geoportal.medan.go.id` returned `HTTP 403` Cloudflare anti-bot challenges.
- `medankota.bps.go.id` triggered Akamai TSPD (`520`) / Cloudflare protection (superseded by official Satu Data Medan BPS/Disdukcapil files).
- Automated anti-bot bypassing was deliberately avoided; team members must obtain UPT infographic images and official Geoportal shapefiles manually in a desktop browser if required.
