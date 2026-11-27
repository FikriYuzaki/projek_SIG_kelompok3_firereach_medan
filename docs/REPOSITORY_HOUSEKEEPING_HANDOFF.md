# Repository Housekeeping Handoff: FireReach Medan

Status per 2026-11-27. Dokumen ini mencatat apa yang sudah selesai pada pekerjaan housekeeping repository, apa yang sengaja tidak diubah, dan sisa pekerjaan yang masih terbuka.

## 1. Riwayat Tahap

| Tahap | Branch | PR | Commit merge di `main` | Status |
|---|---|---|---|---|
| Baseline audit | `main` | - | `e8cd4d1e81699020138236283b7464f17d008ffd` | Selesai |
| Pembersihan artefak, `.gitignore`, README, dokumentasi utama | `chore/repository-housekeeping` | [#12](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/12) | `d4d028ee3bd2bd09a6b2a272813edb7025e1c1dd` | Merged, CI dan Vercel lulus |
| Tindak lanjut: `docs/AGENT_SETUP.md`, `qgis/QA_REPORT.md`, dokumen handoff ini | `chore/repository-housekeeping-followup` | [#13](https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan/pull/13) | - | Menunggu CI dan merge ke `main` |

## 2. Yang Sudah Dikerjakan (PR #12)

- Artefak lokal dihapus: `dist/`, `test-results/`, dan seluruh `__pycache__/` di `qgis/*`, `scripts/`, `tests/python/`. Tidak ada artefak sementara yang ter-track di Git.
- `.gitignore` diperluas: cache Vite/Vercel, coverage, Playwright, bytecode dan cache Python, virtualenv, lock/backup QGIS dan GeoPackage, log, file temporary. `.env` tetap diabaikan, `.env.example` tetap ter-track.
- Konstanta tidak terpakai `PUBLIC_DEMO` dihapus dari `scripts/build_processed_data.py` (nol referensi lain di repository).
- `README.md` ditulis ulang sesuai rilis `2026-11-27-prod`.
- Dokumentasi diperbarui: `AGENTS.md`, `DESIGN.md`, `docs/TEAM_GUIDE.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/INTEGRATION_CONTRACT.md`, `docs/DEPLOYMENT.md`, `docs/qa/DATA_CLEANUP_REPORT.md`, `data/README.md`, `.agents/skills/firereach-modular-development/SKILL.md`, dan keempat `src/features/*/README.md`.

## 3. Yang Sengaja Dipertahankan

- `data/fixtures/demo/`: dipakai test kontrak di `tests/unit/`, bukan fallback runtime.
- `data/processed/`, `public/data/`, `data/metadata/`, `supabase/`, `FireReach_Medan_QGIS_Pack.zip`, seluruh `.qgz`, `.gpkg`, layer, style, dan ekspor PNG QGIS.
- `docs/tasks/*.md`: catatan historis tugas awal (status awal `coming-soon` / `in-development` dan branch `develop` dibiarkan sebagai arsip, bukan petunjuk status terkini).
- `docs/laporan/`: draft laporan akademik, tidak diedit.
- `src/components/coming-soon.js`: masih diimpor oleh `src/router/index.js` sebagai guarded fallback, jadi bukan file mati.
- Remote branch lama (`develop`, `feature/*`, `fix/*`, `backup/*`, `chore/repository-housekeeping`): tidak dihapus karena belum diaudit apakah masih menyimpan commit unik.
- File lokal pengguna yang belum di-track serta direktori kerja lokal yang diabaikan `.gitignore` tidak diubah, tidak dihapus, dan tidak dipublikasikan ke GitHub.

## 4. Validasi Terakhir

Dijalankan lokal pada branch housekeeping sebelum merge PR #12:

| Pemeriksaan | Hasil |
|---|---|
| `npm ci` | Sukses (npm melaporkan 3 vulnerability: 1 moderate, 2 critical) |
| `npm run lint` | Lulus |
| `npm run test` | 10 file, 74 test lulus |
| `npm run build` | Sukses, tidak ada `dist/data/demo` |
| `npm run test:e2e` | 5/5 lulus |
| `python -m unittest discover -s tests/python -v` | 19/19 lulus |
| PyQGIS `qgis_integration_smoke.py`, `qgis_station_priority_smoke.py` | Lulus |
| `scripts/build_qgis_pack.py --verify-only` | Lulus (3 proyek, 0 path absolut, 0 geometri invalid) |
| Production check `https://firereach-medan.vercel.app` setelah merge | 6 route x 3 viewport tanpa overflow, 0 console/page/HTTP error |

## 5. Sisa Pekerjaan Terbuka

1. Audit remote branch lama terhadap `main` (`git log main..origin/<branch>`) sebelum memutuskan penghapusan. Belum dilakukan.
2. Tindak lanjut `npm audit` (3 vulnerability) di PR terpisah, karena `npm audit fix --force` bisa membawa perubahan breaking.
3. `qgis/README_QGIS.md` (yang juga dikemas di dalam `FireReach_Medan_QGIS_Pack.zip`) belum menyebut dua layer eksploratif 22 titik di proyek hotspot. Mengubahnya perlu membangun ulang paket QGIS agar isi zip tetap sama dengan repository, jadi sengaja ditunda.
