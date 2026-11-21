# Analisis Kernel Density Estimation (KDE) — Kota Medan

- **Penanggung Jawab**: Adeptri
- **Modul Terkait**: `hotspot-analyzer` (`src/features/hotspot-analyzer/`)

## 1. Standar Parameter Spasial (QGIS Desktop)
- **CRS Pengolahan (Metrik)**: `EPSG:32647` (WGS 84 / UTM Zone 47N)
- **CRS Output Web (GeoJSON)**: `EPSG:4326` (WGS 84)
- **Fungsi Kernel**: Quartic (Biweight)
- **Radius / Bandwidth**: `1000` meter
- **Ukuran Piksel (Pixel Size)**: `100` meter
- **Metode Klasifikasi Zona**: Quantile (4 kelas: Rendah, Sedang, Tinggi, Sangat Tinggi)

## 2. Aturan Penyaringan Data Input
- Hanya menggunakan titik insiden individual dengan status `verified` dan nilai `location_accuracy` berupa `exact_verified` atau `address_geocoded_verified`.
- Data agregat kecamatan (`district_only`) dan record `DEMO` dilarang masuk ke perhitungan KDE.

## 3. Alur Kerja di QGIS Desktop (Saat Data Titik Terverifikasi Tersedia)
1. Muat layer titik kebakaran terverifikasi (`EPSG:4326`), lalu lakukan **Reproject Layer** ke `EPSG:32647`.
2. Jalankan tool **Heatmap (Kernel Density Estimation)** di Processing Toolbox dengan radius `1000 m`, pixel size `100 m`, dan kernel `Quartic`.
3. Klasifikasikan raster hasil KDE menggunakan **Reclassify by Table**, lalu konversi menjadi poligon dengan **Polygonize (Raster to Vector)**.
4. Hitung luas tiap zona (`area_km2`) di Field Calculator (`$area / 1000000`), simpan proyek QGIS (`.qgz`) di folder ini, dan ekspor poligon final ke `EPSG:4326`.