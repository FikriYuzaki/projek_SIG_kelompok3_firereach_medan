---
name: firereach-modular-development
description: >-
  Module ownership, integration contract, and lifecycle rules for FireReach Medan.
  Use when creating or updating feature modules, registry entries, shared services,
  DEMO fixtures, or module activation states.
---

# FireReach Modular Development

Follow `docs/INTEGRATION_CONTRACT.md` and `docs/TEAM_GUIDE.md`.

## Module Ownership

- `incident-explorer` -> Fikri (initial status: `in-development`)
- `hotspot-analyzer` -> Adeptri (initial status: `coming-soon`)
- `station-coverage` -> Adriel (initial status: `coming-soon`)
- `priority-planner` -> Olo (initial status: `coming-soon`)

Never edit another member's module internals or create cross-module imports between `src/features/*`. Exchange data only through documented Supabase tables, `public/data/`, `data/fixtures/demo/`, or shared `services`.

## Module Contract

Every `src/features/<module-id>/index.js` must export:
- `manifest`: `{ id, title, owner, description }` where `id` matches `src/core/feature-registry.js`.
- `mount({ container, services, params })`: renders strictly inside `container` and returns an async `unmount()` function that removes every Leaflet map, Chart.js instance, DOM/window listener, observer, and timer.

## Registry & Parallel Work

- Allowed statuses: `coming-soon`, `in-development`, `ready-for-review`, `active`, `blocked`.
- Never mark a module `active` until acceptance criteria, automated tests, and review pass.
- Use `data/fixtures/demo/` (explicitly flagged `isDemo: true` and `"dataLabel": "DEMO"`) to build UI independently before upstream outputs are ready.
