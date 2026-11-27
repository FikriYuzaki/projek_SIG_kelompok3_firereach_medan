# Fire Incident Explorer (`incident-explorer`)

- **Pemilik**: Fikri
- **Status Registry**: `active` (`2026-11-27-prod`)
- **Panduan Tugas Awal (Histori)**: `docs/tasks/fikri.md`

## Output & Kemampuan Aktual

1. Membaca rekapitulasi kejadian kebakaran resmi Kota Medan (`2016-2025` seri tahunan, `2023` 21 kecamatan dan dampak bulanan, `2024` dan `2025` bulanan), data pembanding BPBD (`2021-2023`), serta penyelamatan non-kebakaran (`2023-2025`) dari `/data/fire_incidents_summary.json` (atau snapshot Supabase tervalidasi `2026-11-27-prod`) bersama batas 21 kecamatan OSM (`/data/medan_districts_osm.geojson`).
2. Menyediakan katalog terpisah **Kandidat Insiden Kebakaran Sumber Publik (2024-2026)** dari `/data/public_incident_candidates.json` (`34` kandidat unik: **22** berlokasi ruas/landmark OSM berstatus `approximate` dengan koordinat perkiraan, dan **12** berstatus `district_only` dengan `geom = null` tanpa koordinat titik), serta daftar `6` kandidat pos UPT Damkarmat (`/data/damkarmat_station_candidates.json`).
3. Peta choropleth 21 kecamatan (2023), penanda resmi `MAKO-00` (`3.589536, 98.671447`), serta pemisahan tegas catatan `geom = null` pada tab `Belum Terlokasi & Log QA` (termasuk tabel selisih `+/-1` delapan kecamatan 2023 dan log anomali data resmi).
4. Tab **Simulasi Respons Damkarmat** menggunakan routing graf jalan OSM `EPSG:32647` (`/data/medan_road_graph.json`), animasi Canvas 2D dengan fallback SVG 2D di atas Leaflet, serta kontrol audio Web Audio (default mute).

## Keterbatasan Data

- Data titik individual resmi dari Dinas Damkarmat masih tercatat `0` titik pada mode utama; koordinat pada mode `Kandidat Publik` berasal dari media publik/portal (`p2k.medan.go.id`, `ANTARA Sumut`, `Detik Sumut`) yang dipadankan ke ruas jalan atau landmark OSM (`needs_review`, bukan sensus kebakaran menyeluruh).
- Tidak ada runtime fallback `DEMO` pada modul produksi; fixture di `data/fixtures/demo/incident-explorer-sample.demo.json` hanya dipakai oleh pengujian kontrak unit.
