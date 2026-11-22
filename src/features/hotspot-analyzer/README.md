# Fire Hotspot Analyzer (`hotspot-analyzer`)

- **Owner**: Adeptri (diintegrasikan ke `develop`)
- **Status Registry**: `in-development`
- **Task Brief**: `docs/tasks/adeptri.md`
- **DEMO Contract Fixture**: `data/fixtures/demo/hotspot-analyzer.demo.json` (salinan runtime di `/data/demo/hotspot-analyzer.demo.json`)
- **Output Terverifikasi Target**: `/data/hotspot-analyzer.verified.geojson`
- **Pipeline QGIS**: `qgis/hotspot-analysis/`

## Ringkasan Integrasi

1. Modul memprioritaskan `/data/hotspot-analyzer.verified.geojson` apabila terdaftar tersedia di `/data/manifest.json` dan lolos validasi kontrak (`isDemo === false`, `dataLabel` bukan `DEMO`, `FeatureCollection` valid, metadata lengkap, dan 4 kelas kepadatan valid).
2. Jika output resmi belum tersedia atau gagal validasi, UI otomatis menampilkan fixture `DEMO` dengan penanda visual yang eksplisit dan tidak pernah mengubah status fixture menjadi `TERVERIFIKASI`.
3. Validasi input KDE menolak seluruh data `approximate`, `district_only`, `unknown`, `unlocated`, `DEMO`, ID kosong/duplikat, tanggal tidak valid, geometri non-Point/malformed, serta titik di luar poligon batas administrasi Kota Medan (`public/data/medan_districts_osm.geojson`, fallback OpenStreetMap ODbL).
