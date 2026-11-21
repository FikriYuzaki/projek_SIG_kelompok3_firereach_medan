# Pipeline QGIS Fire Station Coverage (`station-coverage`)

- **Owner Awal**: Adriel
- **Status Data Saat Ini**: `PROVISIONAL` (1 stasiun terverifikasi: `MAKO-00` di Jl. Candi Borobudur No. 2; pos UPT lainnya masih menunggu akses/verifikasi manual).
- **CRS Pengolahan Metrik**: `EPSG:32647` (WGS 84 / UTM Zone 47N).
- **CRS Output Web**: `EPSG:4326`.

## Sumber & Pengolahan Jaringan Jalan

1. `extract_medan_roads.py` mengekstrak jalan Kota Medan (+ buffer sekitar 3 km) dari Geofabrik Sumatra OSM PBF (`© OpenStreetMap contributors`, ODbL 1.0, tanggal akses `2026-11-21`).
2. Hanya kelas `highway` drivable yang disertakan (`motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `unclassified`, `residential`, `service` termasuk link), sementara segmen dengan `access=private/no` dan `motor_vehicle=private/no` dikeluarkan serta arah `oneway` dipertahankan (`F`, `B`, `BOTH`).
3. `run_coverage_pipeline.py` menghitung buffer Euclidean (`2.000 m`, `3.000 m`, `5.000 m`) dan Service Area jaringan jalan (`native:serviceareafromlayer`) pada kecepatan skenario teoretis `35 km/jam` (bukan waktu respons operasional aktual Damkarmat), lalu mengekspor ke `public/data/station-coverage.provisional.json` dan `layers/station_coverage_analysis.gpkg`.
4. `build_station_coverage_qgis.py` membangun proyek relatif `station_coverage.qgz` serta mengekspor `exports/peta_jangkauan_pos_damkarmat_medan_mako00.png`.
