# Fire Incident Explorer (`incident-explorer`)

- **Pemilik**: Fikri
- **Status**: `in-development`
- **Panduan Tugas**: `docs/tasks/fikri.md`

## Kemampuan Saat Ini

1. Membaca rekapitulasi kejadian kebakaran resmi Kota Medan (2023 tingkat 21 kecamatan & dampak bulanan, 2024 dan 2025 tingkat bulanan, serta seri historis 2016-2025) dari `/public/data/fire_incidents_summary.json` dan batas kecamatan OSM (`public/data/medan_districts_osm.geojson`).
2. Integrasi siap-pakai dengan Supabase `public.fire_incidents` (`fetchSupabaseIncidents`) yang tetap aman berjalan pada `Mode Lokal` bila kredensial publik belum diatur serta melakukan fallback otomatis bila koneksi gagal.
3. Filter aktif untuk periode/granularitas (`2023-kecamatan`, `2023-dampak`, `2024-bulanan`, `2025-bulanan`, `2016-2025-tahunan`), kecamatan, kategori objek kebakaran, pengurutan hasil (`default`, `desc`, `asc`, `name`), serta pencarian teks.
4. Peta choropleth adaptif 21 kecamatan 2023, marker Mako 0.0 terverifikasi (`3.589536, 98.671447`), serta pemisahan tegas `geom = null` untuk data agregat/unlocated.
5. Tab khusus `Belum Terlokasi & Perlu Review` dengan filter status batch (`unlocated` vs `needs_review`), tabel selisih +/-1 delapan kecamatan 2023, serta Log Anomali Kualitas Data Resmi (`data_quality_anomalies`).
6. Mode opt-in pratinjau kontrak record individual berlabel `DATA DEMO` beserta pratinjau skematis Three.js (dan fallback SVG 2D).
