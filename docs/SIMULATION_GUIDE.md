# Panduan Simulasi Respons Damkarmat - FireReach Medan

**Lokasi di Aplikasi:** `/incident-explorer` -> tab **Simulasi Respons Damkarmat** (`#tab-simulation`)

> **DISCLAIMER WAJIB:** Fitur ini adalah **SIMULASI SKENARIO EDUKATIF & EKSPLORATIF**, bukan layanan panggilan darurat 112/113 dan bukan sistem pengerahan armada Dinas Pemadam Kebakaran dan Penyelamatan (Damkarmat) Kota Medan yang sebenarnya. Aplikasi tidak memiliki data real-time berikut: posisi armada/truk saat ini, status ketersediaan kendaraan & personel, antrean panggilan darurat, maupun kondisi lalu lintas aktual.

---

## 1. Alur Penggunaan

1. Buka halaman `/incident-explorer`, lalu pilih tab **Simulasi Respons Damkarmat** (atau klik tombol **Buka Simulasi Respons** pada panel samping kanan).
2. Pilih **Cakupan Pos Skenario**:
   - `Pos Terverifikasi + 4 Kandidat OSM (Mako 0.0 + UPT I, II, V, VI)`: memilih pos terdekat antara Mako 0.0 (`verified`) dan 4 kandidat UPT berkoordinat perkiraan OSM (`needs_review`).
   - `Hanya Pos Terverifikasi (Mako 0.0 saja)`: membatasi simulasi ke pos yang telah terverifikasi penuh.
   - `UPT-03` dan `UPT-04` berstatus `district_only` (`geom = null`) sehingga selalu dikecualikan dari pemilihan pos dan routing jalan.
3. Tentukan titik kejadian kebakaran simulasi:
   - Klik langsung pada peta wilayah Kota Medan (ketika **Mode Klik Peta: Aktif**), atau
   - Gunakan dropdown **Titik Uji Cepat (Aksesibilitas Keyboard)** + tombol **Pilih Titik** (termasuk 1 titik uji di luar Kota Medan yang harus ditolak sistem).
4. Klik **Mulai Simulasi** untuk menjalankan pergerakan armada sepanjang rute jalan, fase pemadaman (pancar air, reduksi api, dan pengurangan asap), **Jeda** / **Lanjutkan**, atau **Reset**.
5. Kontrol **Suara** berstatus default **Nonaktif (Mute)** dan tidak memutar audio otomatis (`no autoplay`) hingga pengguna menyalakannya secara eksplisit.

---

## 2. Metodologi Spasial & Asumsi Skenario

- **Validasi Batas Kota Medan:** Koordinat target dicek dengan Point-in-Polygon terhadap 21 poligon kecamatan Kota Medan (`public/data/medan_districts_osm.geojson`). Titik di luar batas kota ditolak dengan pesan jelas tanpa membuat rute palsu.
- **Graf Jaringan Jalan (`public/data/medan_road_graph.json`):** Diturunkan dari `data/interim/medan_roads_utm.gpkg` (OpenStreetMap via Geofabrik Sumatra) pada proyeksi metrik `EPSG:32647`, mencakup `8.581` simpul dan `9.720` ruas berarah (`1.579,7 km`) untuk 11 kelas jalan kendaraan dengan atribut `oneway` dipertahankan.
- **Algoritma Rute:** Pencarian rute terpendek memakai algoritma **Dijkstra berarah** (`src/features/incident-explorer/response-router.js`) yang membandingkan panjang rute aktual (`meter`) dari kandidat pos yang memenuhi syarat ke simpul graf terdekat dengan titik target.
- **Estimasi Waktu Skenario:** Dihitung dari panjang rute jaringan menggunakan asumsi skenario konstan **`35 km/jam`** (`(distanceKm / 35) * 60` menit), bukan waktu respons operasional lapangan Damkarmat.

---

## 3. Aksesibilitas, Audio & Fallback

- **Audio Prosedural (`response-audio.js`):** Dibangun murni dengan Web Audio API (`OscillatorNode` + noise buffer tersaring) tanpa dependensi aset audio eksternal, default **mute**, berhenti otomatis saat **Jeda**, **Reset**, selesai, atau meninggalkan halaman, dan tetap berfungsi tanpa galat jika `AudioContext` tidak didukung browser.
- **Panggung Animasi & Fallback 2D (`response-simulation.js`):** Memakai Canvas 2D bertoken warna `DESIGN.md` (`#F4F2EC`, `#356067`, `#B84A35`, `#D58A43`, `#202A2D`). Apabila konteks Canvas 2D tidak tersedia, UI otomatis beralih ke mode SVG statis (`data-render-mode="fallback-2d"`), dan animasi mengikuti preferensi `prefers-reduced-motion` serta menjeda loop ketika tab browser tidak aktif (`visibilitychange`).
