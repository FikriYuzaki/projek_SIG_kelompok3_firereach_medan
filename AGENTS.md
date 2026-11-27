# AGENTS.md: Global Rules for FireReach Medan

<!-- antislop:start -->
## Anti-Slop Filter (Active)

For any UI, copywriting, accessibility, responsive layout, or code-comment work in this repository:
1. Read `DESIGN.md` for visual direction, palette tokens, typography, and liveliness dials (`ENERGY 1 / RHYTHM 2 / MOTION 1`).
2. Read `.agents/skills/antislop/SKILL.md` (and relevant companions: `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting`, `antislop-code`).
3. Run and report the mandatory Anti-Slop Delivery Gate before considering UI/copy work finished.
<!-- antislop:end -->

## Project Context & Ownership Boundaries

FireReach Medan (`Fire Incident Mapping & Emergency Service Coverage Analysis`) is developed in parallel by four team members:

| Member | Module ID | Folder Ownership | Registry Status (`2026-11-27-prod`) |
|---|---|---|---|
| Fikri | `incident-explorer` (plus app shell, router, registry, shared services, docs) | `src/features/incident-explorer/`, `src/core/`, `src/router/`, `src/components/` | `active` |
| Adeptri | `hotspot-analyzer` | `src/features/hotspot-analyzer/` | `active` |
| Adriel | `station-coverage` | `src/features/station-coverage/` | `active` |
| Olo | `priority-planner` | `src/features/priority-planner/` | `active` |

Rules:
- Never modify another member's module folder internals or introduce cross-module imports between `src/features/*`.
- Never mark any module `active` in `src/core/feature-registry.js` without passing its acceptance criteria, automated tests, and integration review.
- Keep Leaflet 2D (`src/core/map/index.js`) as the primary spatial map. Three.js has been removed from this codebase; interactive response animation uses Leaflet + Canvas 2D with an SVG 2D fallback.

## Data Honesty, Geospatial & Database Rules

- **No fabricated data**: Never invent fire incident coordinates, statistics, response times, or coverage metrics. Preserve source granularity (`district_aggregate` vs `individual`).
- **CRS discipline**: Compute metric buffers, areas, and network distances in `EPSG:32647` (WGS 84 / UTM zone 47N); store and exchange PostGIS/GeoJSON in `EPSG:4326`.
- **DEMO separation**: Contract-testing fixtures live strictly in `data/fixtures/demo/`, carry `"isDemo": true` and `"dataLabel": "DEMO"`, and must never be used as runtime fallbacks in `public/data/` or production UI.
- **Security & Supabase**:
  - Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in frontend code. Never commit `.env` or expose `service_role` keys.
  - Enable Row Level Security (RLS) on every `public` table; never ship `allow all` write policies.
  - Keep the web app runnable in local-only mode when Supabase credentials are absent.
  - Never apply remote database migrations without explicit owner approval and credentials.

## Repository Hygiene

- Never commit files inside `data/raw/`, `data/interim/`, `.env`, `node_modules/`, `dist/`, `.vite/`, `.vercel/`, `coverage/`, `__pycache__/`, `playwright-report/`, or `test-results/`.
- Clean up temporary debug artifacts, screenshots, and throwaway scripts before committing.
- Never push directly to `main`; use feature branches (`chore/*`, `feature/<member>-<module>`).

## Project Documentation & Custom Skills

- [README.md](./README.md): Product overview, stack, and local run instructions.
- [DESIGN.md](./DESIGN.md): Visual tokens, WCAG AA contrast verification, typography, and layout rules.
- [docs/TEAM_GUIDE.md](./docs/TEAM_GUIDE.md): Team roles, parallel workflow, and Git branching.
- [docs/SYSTEM_ARCHITECTURE.md](./docs/SYSTEM_ARCHITECTURE.md): Browser, QGIS, and Supabase/PostGIS data flow.
- [docs/INTEGRATION_CONTRACT.md](./docs/INTEGRATION_CONTRACT.md): Module `manifest`, `mount`/`unmount`, `services`, and schemas.
- [docs/DATA_CATALOG.md](./docs/DATA_CATALOG.md): Inspected datasets, provenance, licenses, and blockers.
- [docs/GIS_WORKFLOW.md](./docs/GIS_WORKFLOW.md): QGIS workflow, CRS, and module methodology rules.
- [docs/DATABASE_DESIGN.md](./docs/DATABASE_DESIGN.md): Spatial schema, GiST indexes, RLS, and migrations.
- [docs/AGENT_SETUP.md](./docs/AGENT_SETUP.md): Installed skills and Playwright setup.
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md): Vercel SPA configuration and environment variables.
- Project skills in `.agents/skills/`: `firereach-geospatial`, `firereach-modular-development`, `firereach-data-provenance`, `firereach-quality-gate`, `antislop*`, `supabase`, `supabase-postgres-best-practices`.
