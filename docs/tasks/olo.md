# Panduan Tugas: Olo (`priority-planner`)

- **ID Modul**: `priority-planner`
- **Pemilik**: Olo
- **Status Registry Awal**: `coming-soon`
- **Path yang Dimiliki**: `src/features/priority-planner/`, `qgis/priority-analysis/`
- **Branch yang Disarankan**: `feature/olo-priority-planner` (dibuat dari `develop`)

## 1. Ruang Lingkup & Tanggung Jawab

Menggabungkan intensitas kejadian kebakaran historis atau hasil hotspot, metrik kesenjangan jangkauan pos pemadam, serta indikator jumlah dan kepadatan penduduk kecamatan dari sumber resmi menjadi peringkat prioritas yang transparan untuk 21 Kecamatan di Kota Medan melalui `src/features/priority-planner/`.

## 2. Input Resmi yang Sudah Tersedia Saat Ini

- Batas administratif 21 Kecamatan (`data/processed/medan_districts_osm.geojson`, fallback OSM yang sudah diselaraskan dengan kode `12.71.01` sampai `12.71.21`).
- Jumlah penduduk, kepadatan (`jiwa/km2`), dan persentase distribusi penduduk per Kecamatan tahun 2025 (total `2.498.293` jiwa) dari Satu Data Medan (`01kgkf1fvm5np4c0kfkw8sszxn`), serta deret Kecamatan tahun 2022-2024 (`01m2etk7qn2km32j516b52mbqp`).
- Jumlah dan skala kejadian kebakaran per Kecamatan tahun 2023 (`219` kejadian pada 21 Kecamatan) dari Satu Data Medan (`01m36hh29wv44bcyk299ek5w7e`, `01k4rsar3ydj4x7k56yn2crg5g`).

## 3. Mulai Paralel Tanpa Menunggu Modul Lain

Tidak perlu menunggu output spasial final dari Adeptri dan Adriel. Kembangkan UI skoring, rincian bobot faktor, tabel peringkat, dan peta choropleth menggunakan `data/fixtures/demo/priority-planner.demo.json` (`isDemo: true`, `dataLabel: "DEMO"`).

## 4. Batasan Metodologi

- Pertahankan `kecamatan` sebagai unit analisis yang konsisten kecuali seluruh indikator telah terverifikasi pada tingkat `kelurahan`.
- Dokumentasikan arah normalisasi (kepadatan kebakaran lebih tinggi -> prioritas lebih tinggi; kesenjangan jangkauan lebih tinggi -> prioritas lebih tinggi; kepadatan penduduk lebih tinggi -> paparan lebih tinggi), nilai bobot beserta alasannya, versi metode, dan periode data.
- Simpan `hotspot_score`, `coverage_gap_score`, `population_exposure_score`, `composite_score`, serta `priority_reason` yang mudah dipahami untuk setiap zona.
