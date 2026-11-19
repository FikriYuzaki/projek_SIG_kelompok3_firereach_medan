# Integration Contract: FireReach Modules & Shared Services

Every feature module lives under `src/features/<module-id>/` and integrates with the FireReach application shell strictly through the contract below.

## 1. Registry & Feature States

Allowed status values in `src/core/feature-registry.js`:
- `coming-soon`: Module placeholder only. Router displays `Coming Soon` panel without importing module UI.
- `in-development`: Module may be mounted for development and testing, visibly labeled as in development.
- `ready-for-review`: Feature complete, awaiting QA and integration review.
- `active`: Passed acceptance criteria, unit tests, browser smoke tests, and review.
- `blocked`: Temporarily blocked with explicit blocker note.

Only `in-development`, `ready-for-review`, and `active` statuses are mountable by the router.

## 2. Required Module Exports

Each `src/features/<module-id>/index.js` must export:

```js
export const manifest = {
  id: "module-id",
  title: "Human readable title",
  owner: "Owner name",
  description: "Short purpose"
};

export async function mount({ container, services, params }) {
  // Render inside container only; never create a second app root.
  // Use services.maps, services.charts, services.supabase, etc.
  return async function unmount() {
    // Destroy every Leaflet map, Chart.js instance, Three.js renderer,
    // DOM/window event listener, ResizeObserver, and timer.
  };
}
```

Mandatory constraints:
- `manifest.id` MUST match the key in `src/core/feature-registry.js`.
- Never import files from another module (`src/features/other-module/*`).
- Never leave active Leaflet maps, Chart.js instances, or `window` listeners after `unmount()` resolves.

## 3. Shared `services` API

The router passes one `services` object to every `mount()` call:

```js
services = {
  supabase: {
    client,          // SupabaseClient instance or null in local-only mode
    isConfigured,    // boolean
    statusLabel,     // e.g., "Mode Lokal" or "Terhubung ke Supabase"
    note             // honest explanation of connection status
  },
  maps: {
    createMap(element, options), // returns { map, destroy() }
    addGeoJson(map, geojson, options),
    fitBounds(map, target, options)
  },
  charts: {
    createChart(canvas, config)  // returns { chart, destroy() }
  },
  notify: {
    show(message, tone),         // tone: 'info' | 'success' | 'warning' | 'error'
    clear()
  },
  format: {
    number(value, options),
    date(value, options),
    distance(meters)
  },
  dataStatus: {
    getManifest(),               // returns validated /data/manifest.json
    refresh()
  }
};
```

## 4. Inter-Module Data Contracts

1. **Fikri (`incident-explorer`) -> Adeptri (`hotspot-analyzer`)**:
   - Consumes `fire_incidents` rows (or curated JSON/GeoJSON) where `geom !== null` and `location_accuracy` is `exact_verified`, `address_geocoded_verified`, or `approximate`.
   - `district_only` and `unknown` records MUST remain excluded from point KDE inputs.
2. **Adriel (`station-coverage`)**:
   - Publishes verified `fire_stations` (`geom`, `station_type`, `verification_status`) and `station_coverage_zones` polygons (`method_type`, `threshold_value`, `threshold_unit`, `assumed_speed_kmh`, `disclaimer`).
3. **Adeptri + Adriel + BPS Population -> Olo (`priority-planner`)**:
   - Joins district-level (kecamatan) hotspot intensity, coverage gap metrics, and BPS population/density indicators using normalized `district_name` or BPS `area_code` (`12.71.01` to `12.71.21`).
   - Before Adeptri and Adriel finish real outputs, Olo develops against `data/fixtures/demo/priority-planner.demo.json` (`isDemo: true`, `dataLabel: "DEMO"`).
