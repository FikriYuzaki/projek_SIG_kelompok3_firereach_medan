# Fire Service Priority Planner (`priority-planner`)

- **Owner Awal**: Olo (diselesaikan terintegrasi pada branch `develop`)
- **Status Registry**: `in-development`
- **Task Brief**: `docs/tasks/olo.md`
- **Pipeline QGIS**: `qgis/priority-analysis/`
- **Output Provisional**: `/data/priority-planner.provisional.json`

## Catatan Metodologi

1. Unit analisis mencakup tepat 21 kecamatan Kota Medan (`12.71.01` sampai `12.71.21`).
2. Bobot standar 3 faktor berjumlah 100%: intensitas kejadian kebakaran historis 2023 per 10.000 penduduk (`40%`, bukan KDE), kesenjangan jangkauan layanan jaringan jalan 5 km (`35%`, provisional Mako 0.0), dan kepadatan paparan penduduk BPS 2025 (`25%`).
3. Seluruh indikator dinormalisasi dengan metode Min-Max `(x - min) / (max - min)` dalam rentang `0..1`, serta mendukung simulasi what-if bobot di browser tanpa memodifikasi metadata standar.
