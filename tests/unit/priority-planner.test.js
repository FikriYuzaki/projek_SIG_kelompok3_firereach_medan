import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("leaflet", () => ({
  default: {
    layerGroup: () => ({
      addTo: () => ({
        clearLayers: vi.fn()
      }),
      clearLayers: vi.fn()
    }),
    geoJSON: () => ({
      addTo: () => ({
        setStyle: vi.fn()
      }),
      setStyle: vi.fn()
    })
  }
}));

import {
  DEFAULT_PRIORITY_WEIGHTS,
  EXPECTED_AREA_CODES,
  filterPriorityZones,
  loadPriorityPlannerData,
  minMaxNormalize,
  recalculatePriorityScores,
  validateDistrictJoin,
  validatePriorityOutput,
  validateWeights
} from "../../src/features/priority-planner/service.js";
import { renderPriorityPlanner } from "../../src/features/priority-planner/view.js";

const OSM_BOUNDARY = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "public/data/medan_districts_osm.geojson"), "utf-8")
);
const SUMMARY = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "public/data/fire_incidents_summary.json"), "utf-8")
);

function makePopRows() {
  const csv = fs
    .readFileSync(path.resolve(process.cwd(), "data/processed/medan_population_2022_2025.csv"), "utf-8")
    .trim()
    .split(/\r?\n/);
  const headers = csv[0].split(",");
  return csv.slice(1).map((line) => {
    const cols = line.split(",");
    const obj = Object.fromEntries(headers.map((h, i) => [h, cols[i]]));
    return {
      area_code: obj.area_code,
      district_name: obj.district_name,
      population_2025_bps: Number(obj.population_2025_bps),
      density_km2_2025_bps: Number(obj.density_km2_2025_bps)
    };
  });
}

describe("priority-planner Phase 6: join 21 kecamatan, normalisasi, bobot what-if, null safety, dan anti-DEMO", () => {
  it("menggabungkan tepat 21 kecamatan dan mendeteksi kode ganda, kecamatan hilang, serta nilai null", () => {
    const popRows = makePopRows();
    const mockCoverage = EXPECTED_AREA_CODES.map((code, idx) => ({
      area_code: code,
      network_5km_coverage_pct: idx * 4,
      network_5km_gap_ratio: Number((1 - (idx * 4) / 100).toFixed(4))
    }));

    const joined = validateDistrictJoin({
      fireDistricts: SUMMARY.district_2023,
      populationRows: popRows,
      boundaryGeoJson: OSM_BOUNDARY,
      coverageRows: mockCoverage
    });
    expect(joined.rows).toHaveLength(21);
    expect(joined.coverageAvailable).toBe(true);

    expect(() =>
      validateDistrictJoin({
        fireDistricts: [...SUMMARY.district_2023, SUMMARY.district_2023[0]],
        populationRows: popRows,
        boundaryGeoJson: OSM_BOUNDARY
      })
    ).toThrow(/ganda/i);

    expect(() =>
      validateDistrictJoin({
        fireDistricts: SUMMARY.district_2023.slice(0, 20),
        populationRows: popRows,
        boundaryGeoJson: OSM_BOUNDARY
      })
    ).toThrow(/hilang/i);

    const nullFire = SUMMARY.district_2023.map((r, i) => (i === 0 ? { ...r, total_incidents: null } : r));
    expect(() =>
      validateDistrictJoin({
        fireDistricts: nullFire,
        populationRows: popRows,
        boundaryGeoJson: OSM_BOUNDARY
      })
    ).toThrow(/tidak valid/i);
  });

  it("menjalankan normalisasi Min-Max, validasi bobot = 1, composite score, what-if recalculation, dan mode parsial", () => {
    const norm = minMaxNormalize({ "12.71.01": 10, "12.71.02": 20, "12.71.03": 30 });
    expect(norm.scores["12.71.01"]).toBe(0);
    expect(norm.scores["12.71.02"]).toBe(0.5);
    expect(norm.scores["12.71.03"]).toBe(1);
    expect(() => minMaxNormalize({ "12.71.01": null })).toThrow(/kosong/i);

    expect(validateWeights(DEFAULT_PRIORITY_WEIGHTS)).toEqual(DEFAULT_PRIORITY_WEIGHTS);
    expect(() =>
      validateWeights({ hotspot_intensity: 0.5, coverage_gap: 0.3, population_exposure: 0.1 })
    ).toThrow(/100%/);

    const sampleZones = EXPECTED_AREA_CODES.map((code, idx) => ({
      area_code: code,
      area_name: `Kecamatan ${idx + 1}`,
      incidents_2023: idx + 1,
      population_2025: 100000,
      density_km2_2025: 5000 + idx * 500,
      hotspot_score: Number((idx / 20).toFixed(4)),
      coverage_gap_score: Number((1 - idx / 20).toFixed(4)),
      population_exposure_score: Number((idx / 20).toFixed(4)),
      priority_reason: "Alasan uji",
      isDemo: false,
      dataLabel: "PROVISIONAL"
    }));

    const standardScored = recalculatePriorityScores(sampleZones, DEFAULT_PRIORITY_WEIGHTS);
    expect(standardScored).toHaveLength(21);
    for (const z of standardScored) {
      expect(z.composite_score).toBeGreaterThanOrEqual(0);
      expect(z.composite_score).toBeLessThanOrEqual(1);
      expect(["Rendah", "Sedang", "Tinggi", "Sangat Tinggi"]).toContain(z.priority_tier);
    }

    const whatIfScored = recalculatePriorityScores(sampleZones, {
      hotspot_intensity: 0.7,
      coverage_gap: 0.1,
      population_exposure: 0.2
    });
    // Dengan bobot hotspot 70%, kecamatan indeks tinggi (area 12.71.21) naik menjadi #1
    expect(whatIfScored[0].area_code).toBe("12.71.21");
    expect(filterPriorityZones(whatIfScored, { search: "12.71.21" })).toHaveLength(1);

    // Data tidak lengkap (coverage_gap_score null) -> wajib mode parsial tanpa mengarang skor komposit
    const partialZones = sampleZones.map((z) => ({ ...z, coverage_gap_score: null }));
    const partialScored = recalculatePriorityScores(partialZones, DEFAULT_PRIORITY_WEIGHTS);
    expect(partialScored[0].composite_score).toBeNull();
    expect(partialScored[0].priority_tier).toContain("Parsial");
  });

  it("menolak output berlabel DEMO dan memastikan fixture DEMO tidak dipromosikan ke verified", async () => {
    expect(validatePriorityOutput({ isDemo: true, dataLabel: "DEMO", zones: [] }).valid).toBe(false);

    const tamperedDemo = {
      isDemo: false,
      dataLabel: "TERVERIFIKASI",
      analysis: { method_version: "demo" },
      zones: [{ area_code: "12.71.08", area_name: "Medan Belawan", priority_tier: "Sangat Tinggi" }]
    };

    const res = await loadPriorityPlannerData(
      {
        dataStatus: {
          fetchJson: vi.fn(async (p) => {
            if (p === "priority-planner.provisional.json") return tamperedDemo;
            if (p === "demo/priority-planner.demo.json") return tamperedDemo;
            return null;
          })
        }
      },
      { forceProvisionalFetch: true }
    );

    expect(res.provisionalLoadStatus).toBe("rejected");
    expect(res.isDemo).toBe(true);
    expect(res.dataLabel).toBe("DEMO");
    expect(res.zones[0].isDemo).toBe(true);
    expect(res.zones[0].dataLabel).toBe("DEMO");
  });

  it("membersihkan map dan chart saat unmount priority-planner", async () => {
    const mapDestroy = vi.fn();
    const chartDestroy = vi.fn();
    const ids = [
      "#priority-tier-select",
      "#priority-search-input",
      "#priority-filter-reset",
      "#weight-hotspot-input",
      "#weight-gap-input",
      "#weight-pop-input",
      "#priority-apply-weights",
      "#priority-reset-weights",
      "#priority-weight-feedback",
      "#priority-sim-badge",
      "#priority-top-district",
      "#priority-active-weights-text",
      "#priority-zone-detail",
      "#priority-zone-reason",
      "#priority-chart-empty",
      "#priority-chart-frame",
      "#priority-chart",
      "#priority-table-count",
      "#priority-table-wrap",
      "#priority-map"
    ];
    const map = new Map(
      ids.map((id) => [
        id,
        {
          value: "semua",
          hidden: false,
          innerHTML: "",
          textContent: "",
          style: {},
          addEventListener: vi.fn(),
          replaceChildren: vi.fn(),
          querySelectorAll: () => []
        }
      ])
    );

    const unmount = await renderPriorityPlanner({
      container: {
        innerHTML: "",
        querySelector: (s) => map.get(s) || null,
        querySelectorAll: () => [],
        replaceChildren: vi.fn()
      },
      services: {
        format: { number: (n) => String(n) },
        maps: { createMap: vi.fn(() => ({ map: {}, destroy: mapDestroy })), fitBounds: vi.fn() },
        charts: { createChart: vi.fn(() => ({ destroy: chartDestroy })) },
        dataStatus: {
          fetchJson: vi.fn(async () => {
            throw new Error("offline");
          })
        }
      },
      manifest: { id: "priority-planner", title: "Fire Service Priority Planner" }
    });

    await unmount();
    expect(mapDestroy).toHaveBeenCalledTimes(1);
    expect(chartDestroy).toHaveBeenCalledTimes(1);
  });
});
