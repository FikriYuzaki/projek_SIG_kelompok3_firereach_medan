# Pipeline QGIS Fire Service Priority Planner (`priority-planner`)

- **Owner Awal**: Olo
- **Status Data Saat Ini**: `PROVISIONAL` (memakai agregat kebakaran kecamatan tahun 2023 bukan KDE, kepadatan penduduk BPS 2025, dan gap jangkauan jaringan jalan 5 km dari 1 stasiun terverifikasi Mako 0.0).
- **Unit Analisis**: 21 kecamatan Kota Medan (`area_code` `12.71.01` sampai `12.71.21`).

## Metodologi Skor Komposit

`composite_score = 0.40 * hotspot_score + 0.35 * coverage_gap_score + 0.25 * population_exposure_score`

1. `hotspot_score` (40%): angka kejadian kebakaran tahun 2023 (`219` kejadian) per `10.000` penduduk yang dinormalisasi Min-Max lintas 21 kecamatan (bukan hasil KDE titik).
2. `coverage_gap_score` (35%): rasio wilayah kecamatan di luar cakupan service area jaringan jalan `5 km` Mako 0.0 (`1 - coverage_ratio`) yang dinormalisasi Min-Max.
3. `population_exposure_score` (25%): kepadatan penduduk BPS tahun 2025 (`jiwa/km2`) yang dinormalisasi Min-Max sebagai indikator paparan, bukan angka korban maupun prediksi.

Klasifikasi tier (`Rendah`, `Sedang`, `Tinggi`, `Sangat Tinggi`) dihitung menggunakan kuantil 4 kelas atas `composite_score`.

## Berkas

- `priority_core.py`: logika murni Python untuk validasi join 21 kecamatan, normalisasi Min-Max, deteksi outlier IQR, scoring parsial/provisional, dan validasi kontrak JSON.
- `run_priority_pipeline.py`: menghasilkan `public/data/priority-planner.provisional.json` dan `layers/priority_analysis.gpkg` (`EPSG:32647`).
- `build_priority_qgis.py`: membangun proyek relatif `priority_analysis.qgz`, gaya `styles/priority_tier_4kelas.qml`, serta layout `exports/peta_prioritas_layanan_kebakaran_medan_provisional.png`.
