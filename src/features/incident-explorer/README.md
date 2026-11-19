# Fire Incident Explorer (`incident-explorer`)

- **Owner**: Fikri
- **Status**: `in-development`
- **Task Brief**: `docs/tasks/fikri.md`

## Kemampuan Saat Ini

1. Membaca rekapitulasi kejadian kebakaran resmi Kota Medan (2023 tingkat 21 kecamatan, serta 2024 dan 2025 tingkat bulanan) dari `/public/data/fire_incidents_summary.json` dan batas kecamatan OSM (`public/data/medan_districts_osm.geojson`).
2. Filter aktif untuk periode/granularitas, kecamatan (khusus 2023), kategori objek kebakaran, serta pencarian teks.
3. Peta choropleth kecamatan 2023 dan marker Mako 0.0 terverifikasi (`3.589536, 98.671447`), tanpa membuat titik kejadian palsu untuk data agregat.
4. Grafik Chart.js yang diperbarui langsung oleh filter, detail inspektor baris dengan pratinjau skematis Three.js (dan fallback 2D), serta tab khusus `Belum Terlokasi & Perlu Review`.
5. Mode opt-in pratinjau kontrak record individual berlabel `DATA DEMO`.
