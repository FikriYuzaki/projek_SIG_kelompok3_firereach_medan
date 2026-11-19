# Panduan Tugas: Fikri (`incident-explorer` & Fondasi Platform)

- **ID Modul**: `incident-explorer`
- **Pemilik**: Fikri
- **Status Registry Awal**: `in-development`
- **Path yang Dimiliki**: `src/features/incident-explorer/`, `src/core/`, `src/router/`, `src/components/`, `src/styles/`, `docs/`, `supabase/`
- **Branch yang Disarankan**: `feature/fikri-incident-explorer` (dibuat dari `develop`)

## 1. Fondasi yang Sudah Terpasang

- Shell aplikasi Vite Vanilla JS (`src/core/layout.js`, `src/router/`), feature registry (`src/core/feature-registry.js`), serta layanan bersama Leaflet, Chart, Supabase, dan DataStatus.
- Dataset resmi terverifikasi yang sudah diproses ke `public/data/`:
  - Ringkasan kejadian dan skala kebakaran tahun 2023 tingkat kecamatan pada 21 Kecamatan (`219` kejadian)
  - Ringkasan kejadian kebakaran bulanan tahun 2024 (`269` kejadian)
  - Ringkasan kejadian kebakaran bulanan tahun 2025 (`251` kejadian)
  - Deret historis tahun 2016-2022 + koordinat resmi Mako 0.0 (`Jl. Candi Borobudur No. 2`, `3.589536, 98.671447`)

## 2. Langkah Pengembangan Berikutnya untuk Fikri

1. Kumpulkan dan verifikasi catatan kejadian individual (alamat jalan + tanggal + objek/penyebab) dari Damkarmat atau laporan harian resmi, atau lakukan standarisasi geocoding untuk catatan yang hanya memuat alamat dengan label `location_accuracy` yang eksplisit (`address_geocoded_verified` vs `needs_review`).
2. Pisahkan data yang belum memiliki koordinat terverifikasi (`geom === null` atau `district_only`) di panel kejadian belum terlokasi atau perlu peninjauan, tanpa membuat titik koordinat rekayasa.
3. Muat data kejadian yang sudah terkurasi ke tabel Supabase `public.fire_incidents` setelah database proyek tersedia dan disetujui untuk migrasi.
4. Jalankan `npm run lint`, `npm run test`, `npm run build`, dan `npm run test:e2e` sebelum mengusulkan kenaikan status modul menjadi `ready-for-review` dan `active`.
