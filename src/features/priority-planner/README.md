# Fire Service Priority Planner (`priority-planner`)

- **Pemilik**: Olo
- **Status Registry**: `active` (`2026-11-27-prod`)
- **Panduan Tugas Awal (Histori)**: `docs/tasks/olo.md`
- **Pipeline QGIS**: `qgis/priority-analysis/`
- **Output Aktual**: `/data/priority-planner.provisional.json`

## Output & Metodologi Aktual

1. Mengevaluasi **21 kecamatan** Kota Medan (`area_code` `12.71.01` sampai `12.71.21`) menggunakan metode **`priority-v2.0-integrated`**.
2. Indeks komposit menggabungkan tiga indikator ternormalisasi Min-Max (`0..1`): beban kejadian kebakaran historis 2023 per 10.000 penduduk (`40%`), kesenjangan jangkauan layanan jaringan jalan 5 km (`35%`, mendukung perbandingan skenario baseline `MAKO-00` dan skenario multi-pos 5 stasiun), serta kepadatan paparan penduduk BPS 2025 (`25%`), dilengkapi diagnostik tumpang tindih KDE eksploratif.
3. Mendukung simulasi pembobotan *what-if* secara langsung di browser (wajib berjumlah `100%`) tanpa mengubah skor baku pada dataset sumber.

## Keterbatasan Data

- Seluruh peringkat dan skor prioritas tetap berstatus **provisional** karena bergantung pada cakupan provisional `station-coverage` serta beban agregat kebakaran resmi tahun 2023.
- Hasil indeks ini adalah alat bantu evaluasi spasial multi-kriteria, **bukan** model prediksi risiko atau peramalan kebakaran masa depan.
- Fixture `data/fixtures/demo/priority-planner.demo.json` hanya digunakan untuk pengujian kontrak di `tests/unit/`.
