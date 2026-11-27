# Paket Proyek QGIS FireReach Medan

Paket ini berisi tiga proyek QGIS Desktop mandiri dan portabel untuk analisis spasial kejadian kebakaran serta jangkauan layanan Dinas Pemadam Kebakaran dan Penyelamatan (Damkarmat) Kota Medan. Seluruh proyek memakai path relatif lokal (`./layers/...`) dan dapat dibuka langsung dari folder hasil ekstrak tanpa ketergantungan path mesin lokal atau file mentah PBF.

## Struktur Paket

```text
FireReach_Medan_QGIS_Pack/
├── README_QGIS.md
├── hotspot-analysis/
│   ├── medan_hotspot_template.qgz
│   ├── layers/
│   ├── styles/
│   └── exports/
├── station-coverage/
│   ├── station_coverage.qgz
│   ├── layers/
│   ├── styles/
│   └── exports/
└── priority-analysis/
    ├── priority_analysis.qgz
    ├── layers/
    ├── styles/
    └── exports/
```

## Standar CRS dan Integritas Data

1. **CRS Analisis Metrik (`EPSG:32647` / WGS 84 UTM Zone 47N):** seluruh proyek QGIS, jarak jaringan jalan, buffer, serta luas wilayah dihitung dan disajikan dalam meter/km persegi pada `EPSG:32647`.
2. **CRS Pertukaran Web/PostGIS (`EPSG:4326` / WGS 84):** layer GeoJSON batas kecamatan dan Mako 0.0 memakai `EPSG:4326` dan ditransformasikan otomatis oleh QGIS ke proyek `EPSG:32647`.
3. **Atribusi Peta Dasar & Jaringan Jalan:** batas 21 kecamatan dan jaringan jalan berasal dari OpenStreetMap / Geofabrik (`© OpenStreetMap contributors`, lisensi `ODbL 1.0`) sebagai fallback karena Geoportal Kota Medan terblokir tantangan Cloudflare HTTP 403. Tidak ada koordinat atau data yang diambil dari Google Maps.

## Cara Membuka Proyek di QGIS Desktop

1. Ekstrak seluruh isi arsip `FireReach_Medan_QGIS_Pack.zip` ke satu folder lokal.
2. Buka QGIS Desktop (diuji pada QGIS 3.44.13 LTR).
3. Buka salah satu berkas proyek `.qgz` melalui **Project -> Open...**:
   - `hotspot-analysis/medan_hotspot_template.qgz`: memuat statistik resmi agregat kebakaran tahun `2023` (`219` kejadian pada `21` kecamatan, **bukan** KDE titik individual), titik terverifikasi `Mako 0.0`, serta dua layer eksploratif terpisah: layer titik insiden publik OSM (`22` lokasi perkiraan `approximate`) dan layer KDE eksploratif (`22` titik publik, kernel Quartic, bandwidth `1.500` meter, pixel `100` meter, dan `34` zona Quantile 4 kelas). Dua belas (`12`) insiden `district_only` (`geom = null`) dikecualikan karena tidak memiliki koordinat titik. Output KDE eksploratif tersebut **bukan statistik resmi lengkap** dan **bukan prediksi kebakaran**; dataset titik individual resmi Damkarmat yang terverifikasi penuh belum tersedia.
   - `station-coverage/station_coverage.qgz`: analisis jangkauan `Mako 0.0` berbasis jaringan jalan OSM (2, 3, 5 km dengan asumsi kecepatan skenario `35 km/jam`) dibandingkan dengan buffer Euclidean, serta layer terpisah 4 kandidat UPT `approximate` (`UPT-01`, `UPT-02`, `UPT-05`, `UPT-06`) berstatus `needs_review`. `UPT-03` dan `UPT-04` berstatus `district_only` (`geom = null`) dan tidak diplot sebagai titik.
   - `priority-analysis/priority_analysis.qgz`: peta indeks prioritas layanan `21` kecamatan (`area_code` `12.71.01` hingga `12.71.21`) berstatus `PROVISIONAL` dengan bobot `40%` beban kebakaran 2023, `35%` gap jangkauan 5 km `Mako 0.0`, dan `25%` paparan penduduk BPS 2025.
4. Untuk mengekspor peta siap cetak, buka **Project -> Layouts** lalu pilih Print Layout A4 Landscape yang tersedia di masing-masing proyek.
