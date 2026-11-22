# Pipeline Analisis Kernel Density Estimation (KDE) Kota Medan

- **Penanggung Jawab**: Adeptri (diambil alih dan disempurnakan langsung pada branch `develop`)
- **Modul Web Terkait**: `hotspot-analyzer` (`src/features/hotspot-analyzer/`)
- **Status Data Saat Ini**: `in-development` (menggunakan fixture kontrak `DEMO` di `/data/demo/hotspot-analyzer.demo.json` karena dataset titik kebakaran individual terverifikasi belum tersedia).
- **Kebijakan Integritas Spasial**: Dilarang mengarang koordinat kejadian kebakaran, menggunakan data agregat kecamatan sebagai titik input KDE, atau mengklaim output `DEMO` sebagai data terverifikasi.

---

## 1. Struktur Berkas `qgis/hotspot-analysis/`

| Berkas | Fungsi |
|---|---|
| `kde_core.py` | Logika murni Python (tanpa ketergantungan PyQGIS): validasi input ketat, Point-in-Polygon (Polygon, MultiPolygon, holes, titik batas), klasifikasi Quantile 4 kelas dari distribusi raster aktual, dan validasi kontrak output. |
| `run_kde_pipeline.py` | Adapter PyQGIS/GDAL reproducible untuk mengeksekusi validasi CRS & input, `qgis:heatmapkerneldensityestimation` di `EPSG:32647`, pemotongan raster ke batas Kota Medan, klasifikasi Quantile via `kde_core.py`, poligonisasi, dan ekspor GeoJSON `EPSG:4326`. |
| `kde_pipeline_config.json` | Konfigurasi parameter standar KDE, CRS, aturan filter input, batas wilayah, dan kontrak output. |
| `medan_hotspot_template.qgz` | Proyek template QGIS Desktop (`EPSG:32647`, path relatif portabel) berisi layer nyata yang tersedia: batas 21 kecamatan (OSM fallback), agregat 2023 per kecamatan (bukan KDE), titik Mako 0.0 terverifikasi, serta grup template untuk output KDE di masa depan. |
| `build_qgis_project.py` | Skrip generator PyQGIS untuk membangun ulang `medan_hotspot_template.qgz` dan mengekspor layout PNG secara reproducible. |
| `layers/mako_damkarmat_verified.geojson` | Titik resmi Mako 0.0 Dinas Damkarmat Kota Medan dari `fire_incidents_summary.json` (`exact_verified`). |
| `styles/hotspot_kde_4kelas.qml` | Berkas gaya simbologi QGIS 4 kelas (`Rendah`, `Sedang`, `Tinggi`, `Sangat Tinggi`) untuk layer poligon KDE terverifikasi. |
| `exports/peta_agregat_kebakaran_medan_2023_template_kde.png` | Ekspor PNG Print Layout A4 Landscape dari template proyek QGIS (diberi label eksplisit sebagai peta agregat kecamatan 2023, **bukan** peta KDE). |

---

## 2. Validasi Input Wajib Sebelum KDE

Seluruh record input diperiksa secara eksplisit di `kde_core.validate_kde_input_features()` tanpa mengubah data mentah:

| Atribut / Geometri | Syarat Validasi Wajib |
|---|---|
| `incident_id` | String/integer non-kosong dan unik di seluruh dataset input (duplikat ditolak). |
| `incident_date` | Tanggal kalender ISO valid (`YYYY-MM-DD` atau ISO-8601 datetime). |
| `verification_status` | Wajib bernilai `"verified"`. |
| `location_accuracy` | Hanya `"exact_verified"` atau `"address_geocoded_verified"`. Nilai `"approximate"`, `"district_only"`, `"unknown"`, atau `"unlocated"` ditolak. |
| `isDemo` / `dataLabel` | `isDemo` bukan `true` dan `dataLabel` (setelah normalisasi spasi dan kapitalisasi) bukan `"DEMO"`. |
| `geometry` | Harus GeoJSON `Point` (`type: "Point"`, `coordinates: [lon, lat]` dengan angka `finite` dalam rentang WGS 84). |
| CRS & Batas Wilayah | CRS layer diperiksa dan ditransformasikan ke `EPSG:4326` sebelum uji Point-in-Polygon terhadap batas administrasi Kota Medan (`public/data/medan_districts_osm.geojson`). |

Jika boundary tidak valid atau kosong, analisis langsung dihentikan dengan pesan error yang jelas.

---

## 3. Catatan Atribusi & Batasan Wilayah

Berkas `public/data/medan_districts_osm.geojson` merupakan **fallback OpenStreetMap Nominatim** (`© OpenStreetMap contributors`, lisensi ODbL 1.0), **bukan** batas administrasi resmi Pemerintah Kota Medan. Atribusi ini tetap dipertahankan baik di output GeoJSON, proyek QGIS, maupun UI aplikasi web.

---

## 4. Parameter Analisis & Klasifikasi Quantile

| Parameter | Nilai Standar | Keterangan |
|---|---|---|
| **CRS Pengolahan** | `EPSG:32647` | WGS 84 / UTM Zone 47N (satuan meter). |
| **CRS Output Web** | `EPSG:4326` | WGS 84 (GeoJSON untuk Leaflet dan PostGIS). |
| **Bentuk Kernel** | `Quartic` (`KERNEL = 0`) | `qgis:heatmapkerneldensityestimation`. |
| **Bandwidth / Radius** | `1.000` meter | Radius pengaruh kepadatan spasial. |
| **Ukuran Piksel** | `100` meter (`100 x 100 m`) | Resolusi raster KDE. |
| **Klasifikasi** | **Quantile (4 kelas)** | Menghitung persentil empiris **25%, 50%, 75%** (`linear_type7`) dari distribusi nilai piksel KDE positif di dalam batas Kota Medan. Nilai NoData dan background nol/negatif (`<= 0`) dikeluarkan agar tidak mengacaukan kuantil. |

Empat kelas standar:
1. `1`: `Rendah` (`<= P25`)
2. `2`: `Sedang` (`P25 < x <= P50`)
3. `3`: `Tinggi` (`P50 < x <= P75`)
4. `4`: `Sangat Tinggi` (`> P75`)

---

## 5. Cara Menjalankan

### A. Unit Test Logika Murni (Tanpa Instalasi QGIS)

```bash
python -m unittest discover -s tests/python -v
```

### B. Membangun Template QGIS `.qgz` dan Ekspor PNG (Lingkungan QGIS Windows)

```powershell
& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" qgis/hotspot-analysis/build_qgis_project.py
```

### C. Menjalankan Pipeline KDE Penuh Setelah Titik Resmi Tersedia

```powershell
& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" qgis/hotspot-analysis/run_kde_pipeline.py `
  --input path\ke\verified_incidents.geojson `
  --boundary public/data/medan_districts_osm.geojson `
  --config qgis/hotspot-analysis/kde_pipeline_config.json `
  --output public/data/hotspot-analyzer.verified.geojson `
  --period "2023-2025" `
  --source "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan" `
  --update-manifest public/data/manifest.json
```
