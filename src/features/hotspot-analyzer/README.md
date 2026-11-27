# Fire Hotspot Analyzer (`hotspot-analyzer`)

- **Pemilik**: Adeptri
- **Status Registry**: `active` (`2026-11-27-prod`)
- **Panduan Tugas Awal (Histori)**: `docs/tasks/adeptri.md`
- **Pipeline QGIS**: `qgis/hotspot-analysis/`
- **Output Aktual**: `/data/hotspot-analyzer.exploratory.geojson`

## Output & Metodologi Aktual

1. Memuat hasil analisis Kernel Density Estimation (KDE) eksploratif pada `/data/hotspot-analyzer.exploratory.geojson` (`EPSG:32647` dianalisis lalu diekspor ke `EPSG:4326`), menghasilkan `34` zona kepadatan 4 kelas (Quantile breaks `P25`, `P50`, `P75`) dengan kernel Quartic (`bandwidth = 1.500 m`, resolusi `100 m`).
2. Masukan titik KDE terdiri atas **22 titik insiden publik berkoordinat** (ruas jalan atau landmark OSM berstatus `approximate` periode 2024-2026) yang seluruhnya tervalidasi berada di dalam poligon Kota Medan; **12** catatan `district_only` (`geom = null`) dikecualikan secara otomatis.
3. Validasi kontrak modul menolak titik `district_only`, `unknown`, `unlocated`, `DEMO`, ID kosong atau duplikat, geometri non-Point/malformed, serta titik di luar batas 21 kecamatan Kota Medan.

## Keterbatasan Data

- Hasil KDE ini berstatus **eksploratif** berdasarkan laporan publik berkoordinat perkiraan OSM (`needs_review`), **bukan** statistik resmi lengkap Dinas Damkarmat dan **bukan** prediksi kejadian kebakaran masa depan.
- Tidak ada runtime fallback `DEMO`; berkas `data/fixtures/demo/hotspot-analyzer.demo.json` hanya dipakai oleh pengujian kontrak di `tests/unit/`.
