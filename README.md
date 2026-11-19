# FireReach Medan

Web GIS application for **Fire Incident Mapping & Emergency Service Coverage Analysis** in Kota Medan.

## Stack

- **Frontend**: Vite + Vanilla JavaScript ES Modules, HTML5, CSS3
- **2D Spatial Map**: Leaflet.js (`EPSG:4326` exchange, `EPSG:32647` metric QGIS workflows)
- **Charts**: Chart.js
- **Schematic 3D Preview**: Three.js (bounded architectural object massing preview with automatic 2D SVG fallback)
- **Database / Backend (Prepared)**: Supabase + PostgreSQL + PostGIS (runs cleanly in local-only mode without credentials)
- **Testing**: Vitest (unit/contract), ESLint, Playwright (browser smoke & responsive checks)

## Team Module Ownership

| Member | Module ID | Folder | Registry Status |
|---|---|---|---|
| Fikri | `incident-explorer` + App Shell | `src/features/incident-explorer/`, `src/core/`, `src/router/`, `src/components/` | `in-development` |
| Adeptri | `hotspot-analyzer` | `src/features/hotspot-analyzer/` | `coming-soon` |
| Adriel | `station-coverage` | `src/features/station-coverage/` | `coming-soon` |
| Olo | `priority-planner` | `src/features/priority-planner/` | `coming-soon` |

## Quick Start (Local Mode)

```bash
git clone https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan.git
cd projek_SIG_kelompok3_firereach_medan
npm install
npm run dev
```

No Supabase credentials are required for local development; the app reads verified static open datasets from `public/data/` and displays `Mode Lokal (tanpa Supabase)` in the shell status bar.

To configure Supabase optionally:
1. Copy `.env.example` to `.env`.
2. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (never use `service_role` in frontend code).

## Branching & Team Collaboration

- `main`: Stable baseline ready to clone, test, and demonstrate (no direct pushes).
- `develop`: Active integration branch created from `main` for reviewed feature Pull Requests.
- Feature branches (`feature/fikri-incident-explorer`, `feature/adeptri-hotspot-analyzer`, `feature/adriel-station-coverage`, `feature/olo-priority-planner`) are branched from the latest `develop` and merged back into `develop` via Pull Request. After integration checks and QA pass on `develop`, open a reviewed Pull Request from `develop` to `main`.
- Collaborator access is managed by Fikri (repository owner and integrator) via GitHub `Settings > Collaborators` after each team member confirms their GitHub username.
- Remote Supabase migrations and Vercel deployments are never executed without explicit owner approval.

## Verification Commands

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
```

## Documentation Index

- [AGENTS.md](./AGENTS.md) and [DESIGN.md](./DESIGN.md)
- [Team Guide](./docs/TEAM_GUIDE.md)
- [System Architecture](./docs/SYSTEM_ARCHITECTURE.md)
- [Integration Contract](./docs/INTEGRATION_CONTRACT.md)
- [Data Catalog](./docs/DATA_CATALOG.md)
- [GIS Workflow](./docs/GIS_WORKFLOW.md)
- [Database Design](./docs/DATABASE_DESIGN.md)
- [Agent Setup](./docs/AGENT_SETUP.md)
- [Deployment](./docs/DEPLOYMENT.md)
