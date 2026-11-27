# Production Smoke Test — FireReach Medan

- **Tanggal pengujian:** 24 November 2026
- **Aplikasi:** https://firereach-medan.vercel.app
- **Deployment:** Vercel Production — `READY`
- **Branch:** `main`
- **Commit:** `a7746bf9d5aa68a8691b9aea36fc43b378454f42`
- **Metode:** Playwright Chromium, pengujian browser langsung ke production
- **Sifat pengujian:** Read-only; tidak melakukan perubahan repository, penulisan Supabase, atau deployment.

## 1. Ringkasan hasil

**Kesimpulan: PASS.** Kedua halaman yang diuji berhasil dimuat dan membaca snapshot melalui Supabase. Tidak ditemukan fallback JSON, kesalahan console, page error, request gagal, atau respons HTTP 400 ke atas selama pengujian.

| Pemeriksaan | Hasil | Catatan |
|---|---|---|
| `/station-coverage` | PASS | Halaman termuat penuh dan komponen utama terender |
| `/priority-planner` | PASS | Halaman termuat penuh dan baseline tampil |
| Status koneksi Supabase | PASS | `Koneksi: Terhubung ke Supabase` |
| Status sumber data | PASS | `Sumber Data: Supabase Online` |
| Pembacaan snapshot | PASS | Seluruh request `app_data_snapshots` yang diamati mendapat HTTP 200 |
| Pencegahan fallback | PASS | Tidak ada request ke JSON fallback atau `/data/demo/` |
| Kandidat dan skenario eksploratif | PASS | Enam kandidat tampil sebagai kandidat yang perlu ditinjau; banner nonresmi tampil saat skenario dipilih |
| Responsivitas | PASS | Tidak ada horizontal overflow pada tiga viewport yang diuji |
| Console dan network errors | PASS | Semua hitungan error yang diamati adalah 0 |

## 2. Verifikasi koneksi dan sumber data

Pada `/station-coverage` dan `/priority-planner`, browser menampilkan:

- `Koneksi: Terhubung ke Supabase`
- `Sumber Data: Supabase Online`

Request GET ke tabel `app_data_snapshots` teramati dengan HTTP 200 untuk snapshot berikut:

| Halaman | `snapshot_key` | HTTP |
|---|---|---:|
| `/station-coverage` | `manifest` | 200 |
| `/station-coverage` | `medan_districts_osm` | 200 |
| `/station-coverage` | `station_coverage_provisional` | 200 |
| `/priority-planner` | `manifest` | 200 |
| `/priority-planner` | `medan_districts_osm` | 200 |
| `/priority-planner` | `priority_planner_provisional` | 200 |

Tidak ditemukan request ke:

- `/data/station-coverage.provisional.json`
- `/data/priority-planner.provisional.json`
- `/data/demo/*`

Dengan demikian, pada sesi pengujian ini kedua halaman menggunakan snapshot Supabase dan tidak beralih ke fallback JSON.

## 3. Station Coverage — data dan status kandidat

Status yang ditampilkan:

- `PROVISIONAL (1 POS TERVERIFIKASI)`
- `6 KANDIDAT PUBLIK (4 TITIK OSM, 2 KECAMATAN)`

Hasil pemeriksaan payload dan tabel DOM:

| Kategori | Jumlah | Status/keterangan |
|---|---:|---|
| Pos terverifikasi | 1 | MAKO-00 |
| Kandidat publik | 6 | UPT-01 sampai UPT-06 |
| Kandidat dengan geometri titik perkiraan | 4 | UPT-01, UPT-02, UPT-05, UPT-06 |
| Kandidat `district_only` tanpa koordinat | 2 | UPT-03 dan UPT-04; `lat`, `lon`, dan `geom` bernilai null |
| Kandidat berstatus `needs_review` | 6 dari 6 | Seluruh kandidat masih memerlukan review |

Skenario kandidat hanya ditampilkan sebagai skenario eksploratif. Ketika `candidate_scenario` dipilih, banner muncul dengan keterangan:

`SKENARIO EKSPLORATIF KANDIDAT AKTIF (BUKAN CAKUPAN RESMI)`

Banner tersembunyi sebelum skenario kandidat dipilih. Status dan label ini harus dipertahankan sampai lokasi kandidat diverifikasi melalui proses yang sesuai. Kandidat tidak boleh dipresentasikan sebagai pos resmi atau cakupan operasional terverifikasi.

## 4. Angka cakupan yang teramati

Angka berikut adalah hasil yang dilaporkan dari sesi smoke test. Skenario kandidat bersifat eksploratif dan bukan klaim cakupan resmi.

### Baseline terverifikasi — MAKO-00

| Radius | Cakupan jaringan | Cakupan Euclidean | Segmen jalan |
|---|---:|---:|---:|
| 2 km | 6.2186 km² | 12.5281 km² | — |
| 3 km | 15.8906 km² | 28.2175 km² | — |
| 5 km | 46.1935 km² | 73.1641 km² | 44.522 |

### Skenario eksploratif — MAKO-00 + UPT-01, UPT-02, UPT-05, UPT-06

| Radius | Cakupan jaringan | Tambahan dibanding MAKO-00 |
|---|---:|---:|
| 2 km | 22.0399 km² | +15.8213 km² |
| 3 km | 52.1240 km² | +36.2334 km² |
| 5 km | 115.4572 km² | +69.2637 km² |

Dua kandidat `district_only` tidak memiliki koordinat dan tidak termasuk sebagai titik geometri pada skenario peta yang diamati.

### Inventaris, peta, dan popup

- Tabel inventaris menampilkan 7 baris: 1 pos terverifikasi dan 6 kandidat.
- Dua kandidat tanpa geometri ditandai dengan `geom = null`.
- Tabel cakupan menampilkan 21 kecamatan.
- Terdapat 32 layer path interaktif pada peta.
- Memilih baris MAKO-00 membuka popup dengan detail pos terverifikasi dan koordinat `3.589536, 98.671447`.
- Memilih baris UPT-01 membuka popup kandidat publik yang perlu review, dengan koordinat perkiraan `3.513445, 98.621472`.

## 5. Priority Planner — pemeriksaan baseline

Hasil yang diamati pada `/priority-planner`:

- Status: `PROVISIONAL (21 KECAMATAN)`.
- Atribut status mode: `data-status-mode="provisional"`.
- Seluruh 21 kecamatan tampil.
- Peringkat pertama: Medan Belawan, skor `0.750`.
- Bobot yang tampil: `40% / 35% / 25%`.
- Payload live Supabase `priority_planner_provisional` identik dengan file baseline lokal yang dibandingkan pada pengujian (`matchesLocalBaseline: true`, tanpa selisih).

Pemeriksaan ini tidak mengubah atau mempromosikan status Priority Planner dari provisional.

## 6. Pemeriksaan responsivitas

| Viewport | Hasil overflow horizontal | Ukuran peta teramati |
|---|---:|---:|
| Desktop — 1440 × 900 | 0 px | 648 × 440 px |
| Tablet — 768 × 1024 | 0 px | 694 × 390 px |
| Mobile — 375 × 812 | 0 px | 309 × 320 px |

Elemen `.table-scroll` aktif pada seluruh viewport yang diuji.

## 7. Error dan kegagalan

| Indikator | Jumlah |
|---|---:|
| Console errors | 0 |
| Page errors | 0 |
| Failed requests | 0 |
| Respons HTTP 400 atau lebih | 0 |
| Request fallback JSON | 0 |

## 8. Bukti screenshot

Skrip pengujian menyimpan screenshot sementara di direktori `%TEMP%` pada mesin yang menjalankan test:

- `firereach-prod-station-coverage-baseline-1440.png`
- `firereach-prod-station-coverage-candidate-1440.png`
- `firereach-prod-station-coverage-768.png`
- `firereach-prod-station-coverage-375.png`
- `firereach-prod-priority-planner-1440.png`

Screenshot tersebut tidak disertakan dalam dokumen ini karena hanya tersedia di direktori sementara mesin pengujian. Salin bukti screenshot ke folder dokumentasi QA repository hanya bila tim memang ingin menyimpan artefak visual permanen; jangan menganggap file `%TEMP%` otomatis tersedia di repository.

## 9. Batasan dan tindak lanjut

1. Smoke test ini memverifikasi integrasi aplikasi dengan snapshot Supabase pada saat pengujian, bukan validitas lapangan seluruh lokasi kandidat.
2. Empat kandidat memiliki koordinat perkiraan; dua kandidat hanya memiliki informasi tingkat kecamatan. Keenamnya tetap `needs_review`.
3. Hasil cakupan skenario kandidat adalah simulasi eksploratif, bukan cakupan resmi atau jaminan waktu respons operasional.
4. Priority Planner tetap provisional dan baseline-nya tidak dipromosikan oleh pengujian ini.
5. Screenshot berada di `%TEMP%` mesin pengujian; artefaknya perlu disalin secara eksplisit bila ingin diarsipkan.

**Kesimpulan akhir:** Smoke test production FireReach Medan untuk `/station-coverage` dan `/priority-planner` dinyatakan **PASS** berdasarkan hasil Playwright Chromium yang dilaporkan. Koneksi Supabase, pembacaan snapshot, status provisional, tampilan kandidat, responsivitas, dan pemeriksaan error lulus pada sesi tersebut.
