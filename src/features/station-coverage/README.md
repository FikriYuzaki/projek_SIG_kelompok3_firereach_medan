# Fire Station Coverage (`station-coverage`)

- **Pemilik**: Adriel
- **Status Registry**: `active` (`2026-11-27-prod`)
- **Panduan Tugas Awal (Histori)**: `docs/tasks/adriel.md`
- **Pipeline QGIS**: `qgis/station-coverage/`
- **Output Aktual**: `/data/station-coverage.provisional.json`

## Output & Metodologi Aktual

1. Analisis jangkauan jaringan jalan dijalankan pada CRS metrik `EPSG:32647` menggunakan graf jalan drivable OpenStreetMap Kota Medan (`44.522` segmen dari Geofabrik Sumatra PBF, lisensi `ODbL 1.0`, mengecualikan `access=private/no` dan `motor_vehicle=private/no`) untuk jarak `2 km`, `3 km`, dan `5 km`, dibandingkan dengan buffer Euclidean serta partisi layanan 5 km (`overlap >= 2`, `1 pos`, dan belum terjangkau).
2. Inventaris pos terdiri atas **1 Mako terverifikasi** (`MAKO-00` di Jl. Candi Borobudur No. 2) dan **6 kandidat pos UPT** (`/data/damkarmat_station_candidates.json`, berstatus `needs_review`): **4** kandidat memiliki koordinat perkiraan OSM (`approximate`: `UPT-01`, `UPT-02`, `UPT-05`, `UPT-06`), sedangkan **2** kandidat tidak memiliki geometri (`district_only`, `geom = null`: `UPT-03`, `UPT-04`).
3. Menyediakan filter skenario/ambang, inspeksi pos individual (`per_station_coverage`), serta tabel kecamatan 21 baris.

## Keterbatasan Data

- Seluruh hasil cakupan tetap berstatus **provisional** karena titik koordinat resmi seluruh UPT selain `MAKO-00` belum terpublikasi terbuka dan 2 pos tidak memiliki geometri titik.
- Estimasi menit menggunakan asumsi kecepatan konstan **35 km/jam** sebagai skenario teoretis jaringan jalan, **bukan** waktu respons operasional aktual Damkarmat (tidak memodelkan kemacetan, persinyalan lalu lintas, atau waktu persiapan armada).
- Fixture `data/fixtures/demo/station-coverage.demo.json` hanya digunakan untuk pengujian kontrak di `tests/unit/`.
