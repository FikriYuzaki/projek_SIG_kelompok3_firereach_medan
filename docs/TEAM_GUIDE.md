# Team Guide & Collaboration Workflow

## 1. Module Ownership Matrix

| Member | Module ID | Module Name | Owned Paths | Initial Status |
|---|---|---|---|---|
| Fikri | `incident-explorer` | Fire Incident Explorer | `src/features/incident-explorer/`, `src/core/`, `src/router/`, `src/components/`, `src/styles/`, `docs/` | `in-development` |
| Adeptri | `hotspot-analyzer` | Fire Hotspot Analyzer | `src/features/hotspot-analyzer/`, `qgis/hotspot-analysis/` | `coming-soon` |
| Adriel | `station-coverage` | Fire Station Coverage | `src/features/station-coverage/`, `qgis/station-coverage/` | `coming-soon` |
| Olo | `priority-planner` | Fire Service Priority Planner | `src/features/priority-planner/`, `qgis/priority-analysis/` | `coming-soon` |

## 2. Parallel Development Rules

1. **Stay inside your folder**: Work inside `src/features/<your-module>/` and your own `qgis/` directory. Do not edit another member's module files directly.
2. **Use shared services**: Do not instantiate global Leaflet sidebars, duplicate Supabase clients, or import internal files from another module. Receive `{ container, services, params }` through `mount()` as documented in `docs/INTEGRATION_CONTRACT.md`.
3. **Do not block on upstream modules**:
   - Olo can develop `priority-planner` UI and scoring views right away using the explicitly labeled `DEMO` fixtures in `data/fixtures/demo/priority-planner.demo.json` before Adeptri and Adriel finish final outputs.
   - Adeptri and Adriel can prototype their UI using `data/fixtures/demo/hotspot-analyzer.demo.json` and `data/fixtures/demo/station-coverage.demo.json` while waiting for geocoded incident points or verified UPT station coordinates.
4. **Module activation**: Never flip a module status in `src/core/feature-registry.js` to `ready-for-review` or `active` until its acceptance checklist in `docs/tasks/<member>.md`, automated tests, and integration checks pass.

## 3. Git Branching & Commit Rules

- `main`: Stable baseline ready to clone, test, and demonstrate. Never push directly to `main`.
- `develop`: Active integration branch created from `main` for all feature Pull Requests.
- Foundation branch: `chore/firereach-foundation` (preserved locally as foundation history; do not pre-create empty remote feature branches).
- Feature branches (always created from the latest `develop`):
  - `feature/fikri-incident-explorer`
  - `feature/adeptri-hotspot-analyzer`
  - `feature/adriel-station-coverage`
  - `feature/olo-priority-planner`

Clone and branch setup for team members:

```bash
git clone https://github.com/FikriYuzaki/projek_SIG_kelompok3_firereach_medan.git
cd projek_SIG_kelompok3_firereach_medan
git switch develop
git pull --ff-only origin develop
git switch -c feature/<member>-<module>
# After making scoped commits:
git push -u origin feature/<member>-<module>
```

Workflow:
1. Create your feature branch from the latest `develop` (`feature/<member>-<module>`).
2. Keep commits scoped and use Conventional Commits (`feat(hotspot): ...`, `fix(coverage): ...`, `docs: ...`, `test: ...`).
3. Run `npm run lint`, `npm run test`, and `npm run build` locally before opening a Pull Request into `develop`.
4. After integration verification and QA on `develop`, merge `develop` into `main` via reviewed PR.

## 4. Access & Remote Environment Boundaries

- **Collaborator access**: Fikri (repository owner and integrator) invites Adeptri, Adriel, and Olo via GitHub repository `Settings > Collaborators` once each member provides their GitHub username.
- **Remote environments**: Do not provision or modify remote Supabase projects, run remote database migrations, alter remote RLS policies, or trigger Vercel deployments without explicit project owner approval.
