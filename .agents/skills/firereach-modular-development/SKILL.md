---
name: firereach-modular-development
description: >-
  Module ownership, integration contract, and lifecycle rules for FireReach Medan.
  Use when creating or updating feature modules, registry entries, shared services,
  DEMO contract fixtures, or module activation states.
---

# FireReach Modular Development

Follow `docs/INTEGRATION_CONTRACT.md` and `docs/TEAM_GUIDE.md`.

## Module Ownership

All four modules are currently `active` in `src/core/feature-registry.js` (release `2026-11-27-prod`):
- `incident-explorer` -> Fikri (`active`)
- `hotspot-analyzer` -> Adeptri (`active`)
- `station-coverage` -> Adriel (`active`)
- `priority-planner` -> Olo (`active`)

Never edit another member's module internals or create cross-module imports between `src/features/*`. Exchange data only through documented Supabase tables, `public/data/`, or shared `services`.

## Module Contract

Every `src/features/<module-id>/index.js` must export:
- `manifest`: `{ id, title, owner, description }` where `id` matches `src/core/feature-registry.js`.
- `mount({ container, services, params })`: renders strictly inside `container` and returns an async `unmount()` function that removes every Leaflet map, Chart.js instance, DOM/window listener, observer, and timer.

## Registry & Contract Test Fixtures

- Allowed statuses: `coming-soon`, `in-development`, `ready-for-review`, `active`, `blocked`.
- Never mark a module `active` until acceptance criteria, automated tests, and review pass.
- `data/fixtures/demo/` fixtures (explicitly flagged `isDemo: true` and `"dataLabel": "DEMO"`) are strictly for automated unit/contract tests (`tests/unit/`), never as runtime fallbacks in `public/data/` or production UI.
