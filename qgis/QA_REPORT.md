# Laporan Quality Assurance (QA) Proyek QGIS - FireReach Medan

**Diperbarui:** 2026-11-27
**Environment:** QGIS Desktop 3.44.13 LTR (`C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat`)
**Paket Portabel:** [FireReach_Medan_QGIS_Pack.zip](../FireReach_Medan_QGIS_Pack.zip) (`22` entri, `3.096.932` byte)

---

## 1. Ringkasan Validasi 3 Proyek QGIS (Portabilitas & Integritas Spasial)

Validasi dijalankan dengan mengekstrak `FireReach_Medan_QGIS_Pack.zip` ke direktori sementara di luar repositori lalu memuat ulang seluruh proyek melalui PyQGIS (`scripts/build_qgis_pack.py`):

| Proyek QGIS | CRS Proyek | Jumlah Layer | Absolute Paths | Simbologi `.qml` | Print Layout PNG | Hasil Ekspor Validasi |
|---|---|---|---|---|---|---|
| `hotspot-analysis/medan_hotspot_template.qgz` | `EPSG:32647` | `5` | `False` (0 path absolut) | `hotspot_kde_4kelas.qml` | `exports/peta_agregat_kebakaran_medan_2023_template_kde.png` | `PASS` (`259.575` byte @ 100 dpi) |
| `station-coverage/station_coverage.qgz` | `EPSG:32647` | `6` | `False` (0 path absolut) | `network_service_area.qml`, `euclidean_buffers.qml`, `mako_station.qml`, `candidate_upt_stations.qml` | `exports/peta_jangkauan_pos_damkarmat_medan_mako00.png` | `PASS` (`313.254` byte @ 100 dpi) |
| `priority-analysis/priority_analysis.qgz` | `EPSG:32647` | `3` | `False` (0 path absolut) | `priority_tier_4kelas.qml` | `exports/peta_prioritas_layanan_kebakaran_medan_provisional.png` | `PASS` (`216.035` byte @ 100 dpi) |

Catatan pemeriksaan otomatis pada setiap layer:
- Seluruh layer berstatus `layer.isValid() == True`.
- Seluruh fitur melewati pemeriksaan geometri (`isGeosValid()`) dengan CRS `EPSG:32647` atau `EPSG:4326` dalam batas amplop Kota Medan & jaringan jalan penyangga.
- Batas 21 kecamatan telah disalin ke folder lokal `./layers/medan_districts_osm.geojson` pada masing-masing proyek sehingga tidak ada lagi rujukan keluar seperti `../../public/data/`.

---

## 2. Pemisahan Data Terverifikasi vs Kandidat (`needs_review`)

1. **Hotspot Analysis (`medan_hotspot_template.qgz`):** memuat poligon agregat kebakaran resmi Damkarmat 2023 (`219` kejadian di `21` kecamatan, bukan KDE), titik `Mako 0.0` terverifikasi, serta dua layer eksploratif terpisah: `Titik Insiden Publik OSM (22 Lokasi Ruas)` dan `KDE Eksploratif Publik (22 Titik OSM, BW 1.500 m)` (kernel Quartic, pixel `100` m, `34` zona Quantile 4 kelas; `12` insiden `district_only` tanpa koordinat dikecualikan). KDE resmi dari titik individual Damkarmat tetap belum tersedia; KDE eksploratif bukan statistik resmi lengkap dan bukan prediksi kebakaran.
2. **Station Coverage (`station_coverage.qgz`):**
   - Layer terverifikasi: `Mako 0.0 Damkarmat Medan (Terverifikasi)` (`1` titik `exact_verified`), `Buffer Jarak Lurus Euclidean (2, 3, 5 km)`, dan `Service Area Jaringan Jalan OSM (2, 3, 5 km)`.
   - Layer kandidat terpisah: `Kandidat UPT Perkiraan OSM (needs_review, Terpisah)` disaring dengan ekspresi `"verification_status" = 'needs_review'` (`4` titik perkiraan OSM `UPT-01, UPT-02, UPT-05, UPT-06`). `UPT-03` dan `UPT-04` berstatus `district_only` (`geom = null`) sehingga tidak diplot.
3. **Priority Analysis (`priority_analysis.qgz`):** indeks komposit 3 faktor memakai baseline resmi `Mako 0.0`, kepadatan penduduk BPS 2025 (`2.498.293` jiwa), dan total kebakaran resmi 2023 (`219` kejadian) tanpa menyertakan kandidat `needs_review`.

---

## 3. Reproduksibilitas

Untuk membangun ulang proyek QGIS dan memvalidasi paket portabel dari awal:

1. `& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" qgis/station-coverage/run_coverage_pipeline.py`
2. `& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" qgis/hotspot-analysis/build_qgis_project.py`
3. `& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" qgis/station-coverage/build_station_coverage_qgis.py`
4. `& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" qgis/priority-analysis/build_priority_qgis.py`
5. `& "C:\Program Files\QGIS 3.44.13\bin\python-qgis-ltr.bat" scripts/build_qgis_pack.py`
