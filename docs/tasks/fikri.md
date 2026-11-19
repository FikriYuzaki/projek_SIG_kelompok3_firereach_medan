# Task Brief: Fikri (`incident-explorer` & Platform Foundation)

- **Module ID**: `incident-explorer`
- **Owner**: Fikri
- **Initial Registry Status**: `in-development`
- **Owned Paths**: `src/features/incident-explorer/`, `src/core/`, `src/router/`, `src/components/`, `src/styles/`, `docs/`, `supabase/`
- **Suggested Branch**: `feature/fikri-incident-explorer` (after `chore/firereach-foundation`)

## 1. Current Foundation Implemented

- Vite Vanilla JS application shell (`src/core/layout.js`, `src/router/`), feature registry (`src/core/feature-registry.js`), and shared Leaflet/Chart/Supabase/DataStatus services.
- Verified official datasets processed into `public/data/`:
  - 2023 district-level fire incident & scale summary across 21 Kecamatan (`219` incidents)
  - 2024 monthly fire incident summary (`269` incidents)
  - 2025 monthly fire incident summary (`251` incidents)
  - 2016-2022 historical series + official Mako 0.0 coordinate (`Jl. Candi Borobudur No. 2`, `3.589536, 98.671447`)

## 2. Next Engineering Steps for Fikri

1. Collect and verify individual incident records (street address + date + object/cause) from Damkarmat or official daily reports, or standardize geocoding for address-only records with explicit `location_accuracy` (`address_geocoded_verified` vs `needs_review`).
2. Keep records lacking verified coordinates (`geom === null` or `district_only`) separated in the unlocated/needs-review panel rather than fabricating points.
3. Load curated records into Supabase `public.fire_incidents` once the project database is provisioned.
4. Run `npm run lint`, `npm run test`, `npm run build`, and `npm run test:e2e` before proposing status promotion to `ready-for-review` and `active`.
