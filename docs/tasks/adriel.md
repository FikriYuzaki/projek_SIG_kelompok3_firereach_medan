# Panduan Tugas: Adriel (`station-coverage`)

- **ID Modul**: `station-coverage`
- **Pemilik**: Adriel
- **Status Registry Awal**: `coming-soon`
- **Path yang Dimiliki**: `src/features/station-coverage/`, `qgis/station-coverage/`
- **Branch yang Disarankan**: `feature/adriel-station-coverage` (dibuat dari `develop`)

## 1. Ruang Lingkup & Tanggung Jawab

Memverifikasi lokasi pos Damkarmat (Mako dan pos UPT), menyiapkan dataset jaringan jalan yang bersih untuk Kota Medan, mengevaluasi area layanan berbasis jaringan jalan di QGIS (`EPSG:32647`), membandingkannya dengan buffer jarak lurus (Euclidean), serta membangun modul `src/features/station-coverage/`.

## 2. Baseline Terverifikasi & Data yang Masih Dibutuhkan

- **Sudah terverifikasi**: Mako 0.0 Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan di `Jl. Candi Borobudur No. 2` (`3.589536, 98.671447`), bersumber dari dataset Knowledge Damkarmat pada Satu Data Medan.
- **Menunggu akuisisi manual**: Alamat UPT/Pos dari `https://p2k.medan.go.id/berita/Infografis-Letak-Pos-Damkarmat-Kota-Medan.html` (akses otomatis terhalang challenge Cloudflare; buka secara manual di browser dan verifikasi setiap koordinat pos melalui pengecekan lapangan/citra udara).
- **Jaringan jalan**: Ekstrak jaringan jalan yang dapat dilalui kendaraan di Kota Medan dari arsip Geofabrik Sumatra (`sumatra-latest.osm.pbf`, `© OpenStreetMap contributors`, ODbL), lalu periksa konektivitas, segmen terputus, serta tag `oneway` dan `access`/`motor_vehicle`.

## 3. Batasan Metodologi

- Bedakan secara jelas antara buffer jarak Euclidean dan area layanan berbasis jaringan jalan.
- Jika mengonversi jarak jaringan jalan menjadi estimasi menit tempuh, nyatakan asumsi kecepatan (`km/h`) secara eksplisit sebagai skenario estimasi, bukan sebagai waktu respons aktual Damkarmat.

## 4. Mulai Paralel Menggunakan Fixture `DEMO`

Bangun UI cakupan layanan, kontrol layer, dan panel disclaimer menggunakan `data/fixtures/demo/station-coverage.demo.json` (`isDemo: true`, `dataLabel: "DEMO"`) sambil menyelesaikan verifikasi koordinat UPT dan topologi jaringan jalan.
