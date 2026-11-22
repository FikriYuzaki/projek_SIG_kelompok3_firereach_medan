# Fire Station Coverage (`station-coverage`)

- **Owner Awal**: Adriel (diselesaikan terintegrasi pada branch `develop`)
- **Status Registry**: `in-development`
- **Task Brief**: `docs/tasks/adriel.md`
- **Pipeline QGIS**: `qgis/station-coverage/`
- **Output Provisional**: `/data/station-coverage.provisional.json`

## Catatan Metodologi

1. Analisis jaringan jalan dijalankan pada CRS metrik `EPSG:32647` menggunakan jaringan jalan OpenStreetMap dari Geofabrik Sumatra PBF (`© OpenStreetMap contributors`, ODbL 1.0) dengan pengecualian segmen `access=private/no` dan `motor_vehicle=private/no`.
2. Seluruh pos `DEMO-*` (misalnya `DEMO-UPT-1`) atau pos berstatus selain `verified` ditolak secara eksplisit oleh `validateStationRecords()`.
3. Saat ini baru 1 pos terverifikasi yang tersedia (`MAKO-00` di Jl. Candi Borobudur No. 2), sehingga hasil berstatus `PROVISIONAL` dan konversi menit pada kecepatan `35 km/jam` merupakan skenario estimasi teoretis, bukan waktu respons operasional Damkarmat.
