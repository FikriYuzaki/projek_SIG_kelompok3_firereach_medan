# Pipeline Analisis Kernel Density Estimation (KDE) — Kota Medan

- **Penanggung Jawab**: Adeptri
- **Modul Web Terkait**: `hotspot-analyzer` (`src/features/hotspot-analyzer/`)
- **Status Data Saat Ini**: `in-development` (menggunakan fixture kontrak `DEMO` di `/data/demo/hotspot-analyzer.demo.json` hingga dataset titik kebakaran individual terverifikasi dirilis).
- **Kebijakan Integritas Spasial**: Dilarang mengarang, menggeser, atau mensintesis titik kejadian untuk mengisi kekosongan data.

---

## 1. Spesifikasi Format Input

Input wajib berupa tabel/layer titik kejadian kebakaran individual dalam sistem koordinat geografis **`EPSG:4326`** (CSV dengan kolom `longitude,latitude`, GeoJSON `Point`, atau tabel `fire_incidents` dari Supabase) yang memenuhi seluruh kriteria validasi berikut:

| Kolom / Atribut | Tipe Data | Syarat Validasi Wajib |
|---|---|---|
| `incident_id` | `string` / `uuid` | Tidak boleh kosong (unik per kejadian). |
| `incident_date` | `date` (`YYYY-MM-DD`) | Tanggal kejadian valid pada periode analisis. |
| `verification_status` | `string` | Wajib bernilai `"verified"`. Record `needs_review` atau `unlocated` ditolak. |
| `location_accuracy` | `string` | Wajib `"exact_verified"` atau `"address_geocoded_verified"`. Data `"district_only"`, `"approximate"`, atau `"unknown"` ditolak. |
| `isDemo` / `dataLabel` | `boolean` / `string` | Wajib `false` dan bukan `"DEMO"`. |
| `geometry` | `Point (EPSG:4326)` | Koordinat angka `finite` `[longitude, latitude]` yang lulus uji **Point-in-Polygon** di dalam poligon batas administrasi Kota Medan (`public/data/medan_districts_osm.geojson`). |

---

## 2. Parameter Analisis Spasial (Standar Reproducible)

Seluruh parameter disimpan secara terstruktur di `qgis/hotspot-analysis/kde_pipeline_config.json`:

| Parameter | Nilai Standar | Keterangan Metodologis |
|---|---|---|
| **CRS Input** | `EPSG:4326` (WGS 84) | Koordinat geografis titik terverifikasi. |
| **CRS Pengolahan (Metrik)** | `EPSG:32647` (WGS 84 / UTM Zone 47N) | Wajib diproyeksikan ke satuan meter sebelum menghitung radius KDE dan luas zona. |
| **CRS Output Web** | `EPSG:4326` (WGS 84) | Standar GeoJSON untuk rendering peta Leaflet di aplikasi web. |
| **Algoritma KDE** | `qgis:heatmapkerneldensityestimation` | Heatmap (Kernel Density Estimation) bawaan QGIS Processing. |
| **Bentuk Kernel** | `Quartic` (`KERNEL = 0`) | Pembobotan biweight halus di sekitar titik kejadian. |
| **Radius / Bandwidth** | `1000` meter | Radius pencarian pengaruh kepadatan spasial. |
| **Ukuran Piksel** | `100` meter (`100 x 100 m`) | Resolusi raster output KDE. |
| **Klasifikasi Kepadatan** | `Quantile` (4 kelas) | `1`: Rendah, `2`: Sedang, `3`: Tinggi, `4`: Sangat Tinggi. |
| **Batas Klip Wilayah** | `public/data/medan_districts_osm.geojson` | Memotong poligon zona KDE agar tidak keluar dari batas administrasi Kota Medan. |

---

## 3. Langkah Pengolahan di QGIS Desktop (Manual & Otomatis)

### Opsi A — Eksekusi Otomatis via PyQGIS (`run_kde_pipeline.py`)
Setelah berkas titik kebakaran terverifikasi resmi tersedia (misalnya `data/raw/verified_incidents.geojson`), jalankan skrip reproducible di QGIS Python Console atau `qgis_process`:

```bash
python qgis/hotspot-analysis/run_kde_pipeline.py \
  --input data/raw/verified_incidents.geojson \
  --boundary public/data/medan_districts_osm.geojson \
  --config qgis/hotspot-analysis/kde_pipeline_config.json \
  --output public/data/hotspot-analyzer.verified.geojson