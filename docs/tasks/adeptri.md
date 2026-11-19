# Panduan Tugas: Adeptri (`hotspot-analyzer`)

- **ID Modul**: `hotspot-analyzer`
- **Pemilik**: Adeptri
- **Status Registry Awal**: `coming-soon`
- **Path yang Dimiliki**: `src/features/hotspot-analyzer/`, `qgis/hotspot-analysis/`
- **Branch yang Disarankan**: `feature/adeptri-hotspot-analyzer` (dibuat dari `develop`)

## 1. Ruang Lingkup & Tanggung Jawab

Menganalisis konsentrasi spasial historis kejadian kebakaran di Kota Medan menggunakan Kernel Density Estimation (KDE) di QGIS Desktop (`EPSG:32647`) serta memvisualisasikan zona hotspot terverifikasi pada `src/features/hotspot-analyzer/`.

## 2. Aturan Data & Batasan Metodologi

1. Gunakan hanya data titik kejadian individual dengan nilai `location_accuracy` berupa `exact_verified` atau `address_geocoded_verified` (ditambah `approximate` yang terverifikasi hanya jika terdokumentasi). Jangan pernah memasukkan data agregat `district_only` ke dalam perhitungan KDE titik.
2. Catat metadata KDE secara lengkap di `hotspot_analyses`: periode data, fungsi kernel, bandwidth/radius (`m`), ukuran piksel (`m`), CRS (`EPSG:32647`), extent, dan metode klasifikasi.
3. Beri label hasil secara jujur sebagai konsentrasi historis kejadian kebakaran, bukan sebagai prediksi kejadian di masa depan.

## 3. Mulai Paralel Menggunakan Fixture `DEMO`

Sambil menunggu data titik kejadian individual ter-geocode dari Fikri, mulai bangun UI `hotspot-analyzer`, legenda kepadatan, dan tampilan parameter menggunakan `data/fixtures/demo/hotspot-analyzer.demo.json` (bertanda `"isDemo": true`, `"dataLabel": "DEMO"`).

## 4. Kriteria Penerimaan Sebelum Promosi Status

- Proyek QGIS dan log parameter tersimpan di bawah folder `qgis/hotspot-analysis/`.
- Output poligon hotspot tervalidasi dalam `EPSG:4326` beserta metadatanya sesuai dengan skema di `docs/DATABASE_DESIGN.md`.
- Siklus hidup `mount()` dan `unmount()` bersih tanpa layer Leaflet atau objek grafik yang tertinggal.
- Lulus `npm run lint`, `npm run test`, `npm run build`, serta pengujian khusus modul.
