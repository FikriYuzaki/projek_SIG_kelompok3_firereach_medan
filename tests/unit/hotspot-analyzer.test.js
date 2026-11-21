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
  RUNTIME_DEMO_FIXTURE_URL,
  extractValidMedanPoint,
  filterHotspotZones,
  filterKdeEligiblePoints,
  getHotspotTierMeta,
  loadHotspotZones
} from "../../src/features/hotspot-analyzer/service.js";
import { renderHotspotAnalyzer } from "../../src/features/hotspot-analyzer/view.js";

describe("hotspot-analyzer P1: validasi ketat titik KDE", () => {
  it("menerima exact_verified dan address_geocoded_verified dengan Point valid di dalam Medan", () => {
    const records = [
      {
        id: "ok-1",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.67, 3.59] }
      },
      {
        id: "ok-2",
        location_accuracy: "address_geocoded_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.68, 3.58] }
      },
      {
        id: "ok-wkt",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: "POINT(98.675 3.585)"
      }
    ];

    const eligible = filterKdeEligiblePoints(records);
    expect(eligible.map((r) => r.id)).toEqual(["ok-1", "ok-2", "ok-wkt"]);
  });

  it("menolak district_only, unknown, approximate default, needs_review, unlocated, dan record DEMO", () => {
    const basePoint = { type: "Point", coordinates: [98.67, 3.59] };
    const rejectedRecords = [
      { id: "r1", location_accuracy: "district_only", verification_status: "verified", geom: basePoint },
      { id: "r2", location_accuracy: "unknown", verification_status: "verified", geom: basePoint },
      { id: "r3", location_accuracy: "approximate", verification_status: "verified", geom: basePoint },
      { id: "r4", location_accuracy: "exact_verified", verification_status: "needs_review", geom: basePoint },
      { id: "r5", location_accuracy: "exact_verified", verification_status: "unlocated", geom: basePoint },
      { id: "r6", location_accuracy: "exact_verified", verification_status: "verified", isDemo: true, geom: basePoint },
      { id: "r7", location_accuracy: "exact_verified", verification_status: "verified", dataLabel: "DEMO", geom: basePoint },
      { id: "r8", location_accuracy: "exact_verified", verification_status: "verified", dataLabel: " demo ", geom: basePoint }
    ];

    expect(filterKdeEligiblePoints(rejectedRecords)).toEqual([]);

    // Opt-in eksplisit untuk approximate hanya berlaku jika disetujui dan memiliki alasan
    const explicitApproved = filterKdeEligiblePoints(
      [{ id: "r3", location_accuracy: "approximate", verification_status: "verified", geom: basePoint }],
      { allowApproximate: true, approximateApproved: true, approximateReason: "Verifikasi lapangan tim Damkarmat" }
    );
    expect(explicitApproved).toHaveLength(1);
  });

  it("menolak geometri non-Point, malformed, koordinat NaN/Infinity, urutan terbalik, dan titik di luar batas Medan", () => {
    const invalidGeomRecords = [
      {
        id: "poly",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Polygon", coordinates: [[[98.66, 3.58], [98.68, 3.58], [98.68, 3.59], [98.66, 3.58]]] }
      },
      {
        id: "line",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "LineString", coordinates: [[98.66, 3.58], [98.68, 3.59]] }
      },
      { id: "empty", location_accuracy: "exact_verified", verification_status: "verified", geom: null },
      { id: "malformed-obj", location_accuracy: "exact_verified", verification_status: "verified", geom: { type: "Point" } },
      { id: "malformed-wkt", location_accuracy: "exact_verified", verification_status: "verified", geom: "POINT(abc def)" },
      {
        id: "nan-coord",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [Number.NaN, 3.59] }
      },
      {
        id: "inf-coord",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.67, Number.POSITIVE_INFINITY] }
      },
      {
        id: "swapped-lat-lon",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [3.59, 98.67] }
      },
      {
        id: "outside-medan",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: { type: "Point", coordinates: [98.95, 3.92] }
      }
    ];

    expect(filterKdeEligiblePoints(invalidGeomRecords)).toEqual([]);

    // Fallback lat/lon tanpa properti geom tetap divalidasi dan dinormalisasi menjadi Point
    expect(extractValidMedanPoint({ lat: 3.59, lon: 98.67 })).toEqual({
      type: "Point",
      coordinates: [98.67, 3.59]
    });
    expect(extractValidMedanPoint({ lat: 5.0, lon: 98.67 })).toBeNull();
  });
});

describe("hotspot-analyzer P2: klasifikasi empat kelas kepadatan", () => {
  it("memetakan rank 1..4 dan label Rendah, Sedang, Tinggi, Sangat Tinggi secara terpisah", () => {
    expect(getHotspotTierMeta(1, "Rendah").tier).toBe("low");
    expect(getHotspotTierMeta(2, "Sedang").tier).toBe("medium");
    expect(getHotspotTierMeta(3, "Tinggi").tier).toBe("high");
    expect(getHotspotTierMeta(4, "Sangat Tinggi").tier).toBe("very-high");

    // Pastikan label "Sangat Tinggi" tidak tertangkap sebagai "Tinggi"
    expect(getHotspotTierMeta(null, "Sangat Tinggi (DEMO)").tier).toBe("very-high");
    expect(getHotspotTierMeta(null, "Tinggi (DEMO)").tier).toBe("high");
  });

  it("menangani konflik metadata dan kelas yang tidak dikenal secara eksplisit", () => {
    const conflict = getHotspotTierMeta(4, "Rendah");
    expect(conflict.tier).toBe("very-high");
    expect(conflict.hasConflict).toBe(true);

    const unknown = getHotspotTierMeta(99, "Ekstrem Tidak Dikenal");
    expect(unknown.tier).toBe("unknown");
    expect(unknown.isValid).toBe(false);
  });

  it("memfilter keempat kelas secara terpisah tanpa mencampur Tinggi dan Sangat Tinggi", () => {
    const zones = [
      { zone_id: "z1", density_class: "Rendah", dataLabel: "DEMO", tierMeta: getHotspotTierMeta(1, "Rendah") },
      { zone_id: "z2", density_class: "Sedang", dataLabel: "DEMO", tierMeta: getHotspotTierMeta(2, "Sedang") },
      { zone_id: "z3", density_class: "Tinggi", dataLabel: "DEMO", tierMeta: getHotspotTierMeta(3, "Tinggi") },
      { zone_id: "z4", density_class: "Sangat Tinggi", dataLabel: "DEMO", tierMeta: getHotspotTierMeta(4, "Sangat Tinggi") }
    ];

    expect(filterHotspotZones(zones, { densityTier: "low" }).map((z) => z.zone_id)).toEqual(["z1"]);
    expect(filterHotspotZones(zones, { densityTier: "medium" }).map((z) => z.zone_id)).toEqual(["z2"]);
    expect(filterHotspotZones(zones, { densityTier: "high" }).map((z) => z.zone_id)).toEqual(["z3"]);
    expect(filterHotspotZones(zones, { densityTier: "very-high" }).map((z) => z.zone_id)).toEqual(["z4"]);
  });
});

describe("hotspot-analyzer P2: pemuatan fixture DEMO dan lifecycle UI", () => {
  it("meminta path runtime yang benar dan memakai payload hasil fetch", async () => {
    const requestedPaths = [];
    const mockedPayload = {
      isDemo: true,
      dataLabel: "DEMO",
      notice: "Payload fixture dari fetch runtime",
      analysis: { kernel_method: "Quartic", bandwidth_meters: 1000, pixel_size_meters: 100, working_crs: "EPSG:32647" },
      zones: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              isDemo: true,
              dataLabel: "DEMO",
              zone_id: "fetched-zone-4",
              density_class: "Sangat Tinggi (DEMO)",
              density_rank: 4,
              area_km2: 1.75
            },
            geometry: {
              type: "Polygon",
              coordinates: [[[98.67, 3.58], [98.68, 3.58], [98.68, 3.59], [98.67, 3.58]]]
            }
          }
        ]
      }
    };

    const mockServices = {
      dataStatus: {
        fetchJson: vi.fn(async (relPath) => {
          requestedPaths.push(relPath);
          if (relPath === "demo/hotspot-analyzer.demo.json") return mockedPayload;
          return null;
        })
      }
    };

    const result = await loadHotspotZones(mockServices);
    expect(requestedPaths[0]).toBe("demo/hotspot-analyzer.demo.json");
    expect(result.usedFallback).toBe(false);
    expect(result.fixturePath).toBe(RUNTIME_DEMO_FIXTURE_URL);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].zone_id).toBe("fetched-zone-4");
    expect(result.zones[0].tierMeta.tier).toBe("very-high");
  });

  it("menggunakan fallback berlabel DEMO hanya ketika fetch gagal", async () => {
    const failingServices = {
      dataStatus: {
        fetchJson: vi.fn(async () => {
          throw new Error("404 Not Found");
        })
      }
    };

    const result = await loadHotspotZones(failingServices);
    expect(result.usedFallback).toBe(true);
    expect(result.isDemo).toBe(true);
    expect(result.dataLabel).toBe("DEMO");
    expect(result.zones.length).toBeGreaterThan(0);
  });

  it("membersihkan instance map dan chart saat modul di-unmount", async () => {
    const mapDestroy = vi.fn();
    const chartDestroy = vi.fn();
    const elements = new Map([
      ["#hotspot-filter-tier", { value: "semua", addEventListener: vi.fn() }],
      ["#hotspot-filter-search", { value: "", addEventListener: vi.fn() }],
      ["#hotspot-filter-reset", { addEventListener: vi.fn() }],
      ["#hotspot-zone-detail", { innerHTML: "" }],
      ["#hotspot-chart-empty", { hidden: true }],
      ["#hotspot-chart-frame", { hidden: false }],
      ["#hotspot-chart", {}],
      ["#hotspot-table-count", { textContent: "" }],
      ["#hotspot-table-wrap", { innerHTML: "", replaceChildren: vi.fn(), querySelectorAll: () => [] }],
      ["#hotspot-map", {}]
    ]);

    const container = {
      innerHTML: "",
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: () => [],
      replaceChildren: vi.fn()
    };

    const services = {
      format: { number: (n) => String(n) },
      maps: {
        createMap: vi.fn(() => ({ map: {}, destroy: mapDestroy })),
        fitBounds: vi.fn()
      },
      charts: {
        createChart: vi.fn(() => ({ destroy: chartDestroy }))
      },
      dataStatus: {
        fetchJson: vi.fn(async () => {
          throw new Error("offline");
        })
      }
    };

    const unmount = await renderHotspotAnalyzer({
      container,
      services,
      manifest: { id: "hotspot-analyzer", title: "Fire Hotspot Analyzer" }
    });

    expect(services.maps.createMap).toHaveBeenCalledTimes(1);
    expect(services.charts.createChart).toHaveBeenCalledTimes(1);

    await unmount();
    expect(mapDestroy).toHaveBeenCalledTimes(1);
    expect(chartDestroy).toHaveBeenCalledTimes(1);
  });
});