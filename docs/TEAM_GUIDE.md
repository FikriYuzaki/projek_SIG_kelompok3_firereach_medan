# Team Guide & Collaboration Workflow

## 1. Module Ownership Matrix

All four analysis modules are `active` in `src/core/feature-registry.js` as of production release `2026-11-27-prod`:

| Member | Module ID | Module Name | Owned Paths | Registry Status |
|---|---|---|---|---|
| Fikri | `incident-explorer` | Fire Incident Explorer | `src/features/incident-explorer/`, `src/core/`, `src/router/`, `src/components/`, `src/styles/`, `docs/` | `active` |
| Adeptri | `hotspot-analyzer` | Fire Hotspot Analyzer | `src/features/hotspot-analyzer/`, `qgis/hotspot-analysis/` | `active` |
| Adriel | `station-coverage` | Fire Station Coverage | `src/features/station-coverage/`, `qgis/station-coverage/` | `active` |
| Olo | `priority-planner` | Fire Service Priority Planner | `src/features/priority-planner/`, `qgis/priority-analysis/` | `active` |

## 2. Parallel Development Rules

1. **Stay inside your folder**: Work inside `src/features/<your-module>/` and your own `qgis/` directory. Do not edit another member's module files directly.
2. **Use shared services**: Do not instantiate global Leaflet sidebars, duplicate Supabase clients, or import internal files from another module. Receive `{ container, services, params }` through `mount()` as documented in `docs/INTEGRATION_CONTRACT.md`.
3. **Contract fixture discipline**: `data/fixtures/demo/*.demo.json` is retained solely for automated unit/contract tests in `tests/unit/` and must never be reintroduced as a runtime fallback in `public/data/`.
4. **Module activation**: Never alter a module status in `src/core/feature-registry.js` unless its acceptance criteria, automated tests, and integration checks pass.

## 3. Git Branching & Commit Rules

- `main`: Active production baseline synced to Vercel (`https://firereach-medan.vercel.app`). Never push directly to `main`.
- Scoped working branches (`chore/*`, `fix/*`, `feature/*`): Always branch from the latest `main` and merge back via reviewed Pull Request after GitHub Actions CI (`lint`, `test`, Python `unittest`, `build`, Playwright E2E) and Vercel preview checks pass.
- Historical branches: `chore/firereach-foundation`, `develop`, and earlier member feature branches (`feature/fikri-*`, `feature/adeptri-*`, `feature/adriel-*`, `feature/olo-*`) remain on the repository as historical records; keep old remote branches intact unless confirmed fully integrated with no unique unmerged work.

Clone and branch setup:

```bash
git clone https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan.git
cd projek_SIG_kelompok3_firereach_medan
git switch main
git pull --ff-only origin main
git switch -c <type>/<short-topic>
# After making scoped commits:
git push -u origin <type>/<short-topic>
```

Workflow:
1. Create a scoped branch (`chore/*`, `fix/*`, or `feature/<member>-<module>`) from the latest `main`.
2. Keep commits scoped and use Conventional Commits (`feat(hotspot): ...`, `fix(coverage): ...`, `docs: ...`, `chore(repo): ...`).
3. Run `npm run lint`, `npm run test`, `python -m unittest discover -s tests/python -v`, `npm run build`, and `npm run test:e2e` locally before opening a Pull Request into `main`.
4. Merge only after CI and preview checks pass cleanly.

## 4. Access & Remote Environment Boundaries

- **Production deployment**: Live frontend builds are served on Vercel (`https://firereach-medan.vercel.app`) from `main`.
- **Remote environments**: Do not modify remote Supabase schemas, RLS policies, or secret environment variables without explicit project owner approval.
