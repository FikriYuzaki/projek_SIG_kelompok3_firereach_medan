import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(process.cwd());
const summary = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/fire_incidents_summary.json"), "utf-8")
);
const districtsGeo = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/data/medan_districts_osm.geojson"), "utf-8")
);

const mockOverlayClear = vi.fn();
vi.mock("leaflet", () => ({
  default: {
    layerGroup: () => ({ addTo: () => ({ clearLayers: mockOverlayClear }) }),
    geoJSON: () => ({
      addTo: () => ({ setStyle: vi.fn() }),
      setStyle: vi.fn()
    }),
    circleMarker: () => ({
      bindPopup: function () {
        return this;
      },
      on: function () {
        return this;
      },
      addTo: function () {
        return this;
      }
    })
  }
}));

const mockPreviewDestroy = vi.fn();
vi.mock("../../src/components/three-preview.js", () => ({
  mountObjectSchematicPreview: () => ({
    setObjectType: vi.fn(),
    destroy: mockPreviewDestroy
  })
}));

let lastErrorAction = null;
vi.mock("../../src/components/state-panel.js", () => ({
  renderStatePanel: ({ variant, title, onAction }) => {
    if (variant === "error") lastErrorAction = onAction;
    return { variant, title };
  }
}));

import {
  classifyChoroplethTier,
  computeChoroplethBreaks,
  extractValidPointCoordinates,
  fetchSupabaseIncidents,
  filterDemoRecords,
  filterOfficialRows,
  normalizeDistrictName,
  normalizeIncidentRecord,
  partitionIncidentRecords
} from "../../src/features/incident-explorer/service.js";
import { manifest, mount } from "../../src/features/incident-explorer/index.js";

function makeStubElement() {
  const listeners = new Map();
  const el = {
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    hidden: false,
    className: "",
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(),
    getAttribute: vi.fn(() => "semua"),
    addEventListener: vi.fn((type, fn, opts) => {
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => listeners.delete(type));
      }
      listeners.set(type, fn);
    }),
    focus: vi.fn(),
    querySelector: () => makeStubElement(),
    querySelectorAll: () => [],
    replaceChildren: vi.fn()
  };
  return el;
}

function makeStubContainer() {
  const bySelector = new Map();
  const root = {
    innerHTML: "",
    replaceChildren: vi.fn(),
    querySelector(sel) {
      if (!bySelector.has(sel)) {
        const stub = makeStubElement();
        if (sel === "#filter-period") stub.value = "2023-kecamatan";
        if (sel === "#filter-district") stub.value = "semua";
        if (sel === "#filter-category") stub.value = "semua";
        if (sel === "#filter-sort") stub.value = "default";
        bySelector.set(sel, stub);
      }
      return bySelector.get(sel);
    },
    querySelectorAll: () => []
  };
  return root;
}

describe("incident-explorer service helpers", () => {
  it("normalizes whitespace and casing in district names", () => {
    expect(normalizeDistrictName("Medan  Kota")).toBe("Medan Kota");
    expect(normalizeDistrictName("  MEDAN\u00a0  DENAI  ")).toBe("Medan Denai");
    expect(normalizeDistrictName("")).toBe("");
    expect(normalizeDistrictName(null)).toBe("");
  });

  it("enforces geom = null for district_only, unknown, or out-of-bounds coordinates", () => {
    expect(
      extractValidPointCoordinates({
        location_accuracy: "district_only",
        lat: 3.5895,
        lon: 98.6714
      })
    ).toBeNull();

    expect(
      extractValidPointCoordinates({
        location_accuracy: "unknown",
        geom: { type: "Point", coordinates: [98.6714, 3.5895] }
      })
    ).toBeNull();

    expect(
      extractValidPointCoordinates({
        location_accuracy: "exact_verified",
        lat: -6.2,
        lon: 106.8
      })
    ).toBeNull();

    const valid = extractValidPointCoordinates({
      location_accuracy: "address_geocoded_verified",
      geom: { type: "Point", coordinates: [98.6714, 3.5895] }
    });
    expect(valid).toEqual({
      lat: 3.5895,
      lon: 98.6714,
      geom: { type: "Point", coordinates: [98.6714, 3.5895] }
    });
  });

  it("downgrades invalid verified rows when geom is null and partitions DEMO strictly", () => {
    const aggRec = normalizeIncidentRecord({
      source_record_id: "ROW-AGG-1",
      period_year: 2023,
      district_name: "Medan  Kota",
      location_accuracy: "district_only",
      verification_status: "verified",
      lat: 3.58,
      lon: 98.67
    });
    expect(aggRec.district_name).toBe("Medan Kota");
    expect(aggRec.geom).toBeNull();
    expect(aggRec.verification_status).toBe("needs_review");
    expect(aggRec.kde_eligible).toBe(false);

    const partitioned = partitionIncidentRecords([
      {
        source_record_id: "OFF-POINT-1",
        period_year: 2024,
        district_name: "Medan Petisah",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        lat: 3.5895,
        lon: 98.6714
      },
      aggRec,
      {
        source_record_id: "OFF-UNLOC-1",
        period_year: 2025,
        location_accuracy: "unknown",
        verification_status: "unlocated"
      },
      {
        source_record_id: "DEMO-POINT-1",
        period_year: 2024,
        location_accuracy: "approximate",
        verification_status: "verified",
        lat: 3.55,
        lon: 98.68,
        isDemo: true
      }
    ]);

    expect(partitioned.verifiedLocated).toHaveLength(1);
    expect(partitioned.kdeEligible).toHaveLength(1);
    expect(partitioned.needsReview).toHaveLength(1);
    expect(partitioned.unlocated).toHaveLength(1);
    expect(partitioned.demoRecords).toHaveLength(1);
    expect(partitioned.kdeEligible.every((r) => !r.isDemo)).toBe(true);
  });

  it("filters and sorts official rows across all 5 periods accurately", () => {
    const distDesc = filterOfficialRows({
      summary,
      period: "2023-kecamatan",
      sortBy: "desc"
    });
    expect(distDesc).toHaveLength(21);
    expect(distDesc[0].district_name).toBe("Medan Belawan");
    expect(distDesc[0].filteredCount).toBe(21);

    const lahanNonZero = filterOfficialRows({
      summary,
      period: "2023-kecamatan",
      category: "lahan",
      excludeZero: true
    });
    expect(lahanNonZero.length).toBeLessThan(21);
    expect(lahanNonZero.every((r) => r.filteredCount > 0)).toBe(true);

    const impact2023 = filterOfficialRows({ summary, period: "2023-dampak" });
    expect(impact2023).toHaveLength(12);
    expect(impact2023.find((r) => r.month_name === "Maret")?.loss_anomaly_flag).toBe(true);

    const rows2024 = filterOfficialRows({ summary, period: "2024-bulanan", category: "rumah" });
    expect(rows2024).toHaveLength(12);
    expect(rows2024.reduce((s, r) => s + r.filteredCount, 0)).toBe(119);

    const rows2025 = filterOfficialRows({ summary, period: "2025-bulanan", search: "juli" });
    expect(rows2025).toHaveLength(1);
    expect(rows2025[0].total_incidents).toBe(40);

    const annual = filterOfficialRows({ summary, period: "2016-2025-tahunan" });
    expect(annual).toHaveLength(10);
    expect(annual.find((r) => r.year === 2019)?.consistency_flag).toBe(true);
  });

  it("computes adaptive choropleth breaks even for sparse or zero categories", () => {
    const zeroBreaks = computeChoroplethBreaks([0, 0, 0]);
    expect(zeroBreaks.hasNonZero).toBe(false);
    expect(classifyChoroplethTier(0, zeroBreaks)).toBe("zero");

    const sparseBreaks = computeChoroplethBreaks([0, 1, 2, 3, 0]);
    expect(sparseBreaks.hasNonZero).toBe(true);
    expect(classifyChoroplethTier(0, sparseBreaks)).toBe("zero");
    expect(classifyChoroplethTier(1, sparseBreaks)).toBe("low");
    expect(classifyChoroplethTier(2, sparseBreaks)).toBe("mid");
    expect(classifyChoroplethTier(3, sparseBreaks)).toBe("high");
  });

  it("filters DEMO contract records safely without polluting official lists", () => {
    const demo = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/data/demo/incident-explorer-sample.demo.json"), "utf-8")
    );
    const filtered = filterDemoRecords(demo.records, { statusFilter: "unlocated" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source_record_id).toBe("DEMO-INC-003");
    expect(filtered[0].geom).toBeNull();
  });

  it("handles Supabase local mode, mocked query success, and mocked query fallback gracefully", async () => {
    const localRes = await fetchSupabaseIncidents({ isConfigured: false, client: null, note: "Mode Lokal" });
    expect(localRes.active).toBe(false);
    expect(localRes.source).toBe("local");

    const mockClientOk = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({
              data: [
                {
                  id: "uuid-1",
                  source_record_id: "SUPA-1",
                  period_year: 2024,
                  district_name: "Medan  Kota",
                  location_accuracy: "exact_verified",
                  verification_status: "verified",
                  lat: 3.5895,
                  lon: 98.6714,
                  source_name: "Damkarmat"
                },
                {
                  id: "uuid-2",
                  source_record_id: "SUPA-2",
                  period_year: 2024,
                  district_name: "Medan Johor",
                  location_accuracy: "district_only",
                  verification_status: "needs_review",
                  geom: null,
                  source_name: "Damkarmat"
                }
              ],
              error: null
            })
          })
        })
      })
    };
    const supaOk = await fetchSupabaseIncidents({ isConfigured: true, client: mockClientOk });
    expect(supaOk.active).toBe(true);
    expect(supaOk.partitioned.verifiedLocated).toHaveLength(1);
    expect(supaOk.partitioned.needsReview).toHaveLength(1);

    const mockClientErr = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({ data: null, error: { message: "RLS denied" } })
          })
        })
      })
    };
    const supaErr = await fetchSupabaseIncidents({ isConfigured: true, client: mockClientErr });
    expect(supaErr.active).toBe(false);
    expect(supaErr.source).toBe("local_fallback");
    expect(supaErr.error).toContain("RLS denied");
  });
});

describe("incident-explorer mount & unmount lifecycle", () => {
  it("destroys map, chart, overlay, and preview cleanly including after error retry", async () => {
    expect(manifest.id).toBe("incident-explorer");

    const mapDestroy = vi.fn();
    const chartDestroy = vi.fn();
    let failFirst = true;

    const services = {
      supabase: { isConfigured: false, client: null, note: "Mode Lokal" },
      maps: {
        createMap: () => ({ map: { _mapPane: true, invalidateSize: vi.fn() }, destroy: mapDestroy }),
        fitBounds: vi.fn()
      },
      charts: {
        createChart: () => ({ chart: {}, destroy: chartDestroy })
      },
      notify: { show: vi.fn(), clear: vi.fn() },
      format: {
        number: (v) => String(v),
        date: (v) => String(v || "-")
      },
      dataStatus: {
        fetchJson: async (relPath) => {
          if (failFirst) {
            throw new Error("Simulated offline");
          }
          if (relPath === "fire_incidents_summary.json") return summary;
          if (relPath === "medan_districts_osm.geojson") return districtsGeo;
          throw new Error(`Unexpected path: ${relPath}`);
        }
      }
    };

    const container = makeStubContainer();
    const unmount = await mount({ container, services, params: {} });
    expect(typeof lastErrorAction).toBe("function");

    // Simulate clicking "Muat Ulang" after error
    failFirst = false;
    await lastErrorAction();
    expect(chartDestroy).toHaveBeenCalledTimes(0);

    await unmount();
    expect(mockOverlayClear).toHaveBeenCalled();
    expect(chartDestroy).toHaveBeenCalledTimes(1);
    expect(mockPreviewDestroy).toHaveBeenCalledTimes(1);
    expect(mapDestroy).toHaveBeenCalledTimes(1);
  });
});
