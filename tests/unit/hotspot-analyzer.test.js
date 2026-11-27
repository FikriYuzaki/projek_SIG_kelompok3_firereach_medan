import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  BOUNDARY_PROVENANCE,
  EXPLORATORY_HOTSPOT_OUTPUT_URL,
  MEDAN_BOUNDS,
  VERIFIED_HOTSPOT_OUTPUT_URL,
  extractValidMedanPoint,
  filterHotspotZones,
  filterKdeEligiblePoints,
  getHotspotTierMeta,
  isPointInGeoJson,
  isValidIncidentDate,
  loadHotspotZones,
  resetMedanBoundaryGeoJson,
  setMedanBoundaryGeoJson,
  validateBoundaryGeoJson,
  validateKdeInputRecords,
  validateVerifiedHotspotOutput
} from "../../src/features/hotspot-analyzer/service.js";
import { renderHotspotAnalyzer } from "../../src/features/hotspot-analyzer/view.js";

const OSM_BOUNDARY = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "public/data/medan_districts_osm.geojson"), "utf-8")
);

function makeValidVerifiedOutput(overrides = {}) {
  return {
    type: "FeatureCollection",
    isDemo: false,
    dataLabel: "TERVERIFIKASI",
    module: "hotspot-analyzer",
    owner: "Adeptri",
    notice: "Hasil KDE historis terverifikasi Kota Medan. Bukan prediksi.",
    analysis: {
      title: "KDE Kebakaran Kota Medan 2024",
      source: "Dinas Damkarmat Kota Medan",
      period_label: "Januari - Desember 2024",
      kernel_method: "Quartic",
      bandwidth_meters: 1000,
      pixel_size_meters: 100,
      working_crs: "EPSG:32647",
      classification_method: "Quantile (4 kelas)",
      incident_count_used: 42,
      ...(overrides.analysis || {})
    },
    features: overrides.features || [
      {
        type: "Feature",
        properties: {
          isDemo: false,
          dataLabel: "TERVERIFIKASI",
          zone_id: "hotspot-zone-1",
          density_class: "Sangat Tinggi",
          density_rank: 4,
          area_km2: 1.85
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [98.665, 3.582],
              [98.685, 3.582],
              [98.685, 3.598],
              [98.665, 3.598],
              [98.665, 3.582]
            ]
          ]
        }
      }
    ],
    ...overrides
  };
}

afterEach(() => {
  resetMedanBoundaryGeoJson();
});

describe("hotspot-analyzer P1: validasi boundary & point-in-polygon Kota Medan", () => {
  it("memvalidasi berkas batas OSM Kota Medan serta mendukung Polygon, MultiPolygon, interior holes, dan titik batas", () => {
    const osmCheck = validateBoundaryGeoJson(OSM_BOUNDARY);
    expect(osmCheck.valid).toBe(true);
    expect(osmCheck.polygonCount).toBeGreaterThanOrEqual(21);

    const polygonWithHole = {
      type: "Polygon",
      coordinates: [
        [
          [98.6, 3.5],
          [98.7, 3.5],
          [98.7, 3.6],
          [98.6, 3.6],
          [98.6, 3.5]
        ],
        [
          [98.63, 3.53],
          [98.67, 3.53],
          [98.67, 3.57],
          [98.63, 3.57],
          [98.63, 3.53]
        ]
      ]
    };

    expect(validateBoundaryGeoJson(polygonWithHole)).toEqual({
      valid: true,
      errors: [],
      polygonCount: 1,
      holeCount: 1
    });

    // Di dalam poligon utama & di luar lubang
    expect(isPointInGeoJson(98.61, 3.51, polygonWithHole)).toBe(true);
    // Tepat di tepi luar poligon
    expect(isPointInGeoJson(98.65, 3.5, polygonWithHole)).toBe(true);
    // Tepat di tepi lubang (interior ring)
    expect(isPointInGeoJson(98.65, 3.53, polygonWithHole)).toBe(true);
    // Tepat di dalam lubang (hole) wajib ditolak
    expect(isPointInGeoJson(98.65, 3.55, polygonWithHole)).toBe(false);
    // Di luar poligon utama
    expect(isPointInGeoJson(98.75, 3.55, polygonWithHole)).toBe(false);

    const multiPoly = {
      type: "MultiPolygon",
      coordinates: [
        [[[98.6, 3.5], [98.62, 3.5], [98.62, 3.52], [98.6, 3.52], [98.6, 3.5]]],
        [[[98.68, 3.58], [98.7, 3.58], [98.7, 3.6], [98.68, 3.6], [98.68, 3.58]]]
      ]
    };
    expect(isPointInGeoJson(98.61, 3.51, multiPoly)).toBe(true);
    expect(isPointInGeoJson(98.69, 3.59, multiPoly)).toBe(true);
    expect(isPointInGeoJson(98.65, 3.55, multiPoly)).toBe(false);
  });

  it("gagal dengan pesan jelas jika boundary tidak diset atau tidak valid", () => {
    const validRecord = {
      incident_id: "INC-1",
      incident_date: "2024-05-01",
      verification_status: "verified",
      location_accuracy: "exact_verified",
      geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
    };

    expect(() => filterKdeEligiblePoints([validRecord])).toThrow(/Boundary/i);
    expect(() => extractValidMedanPoint(validRecord)).toThrow(/Boundary/i);

    const unclosedBoundary = {
      type: "Polygon",
      coordinates: [[[98.6, 3.5], [98.7, 3.5], [98.7, 3.6], [98.6, 3.6]]]
    };
    expect(() => setMedanBoundaryGeoJson(unclosedBoundary)).toThrow(/tidak valid/i);
    expect(() => filterKdeEligiblePoints([validRecord], { boundaryGeoJson: unclosedBoundary })).toThrow(
      /tidak valid/i
    );
  });

  it("menolak titik yang masih di dalam bounding box tetapi berada di luar poligon OSM Kota Medan", () => {
    const insideBboxButOutsidePolygon = [
      {
        incident_id: "outside-nw-hamparan-perak",
        incident_date: "2024-05-01",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.57, 3.78] }
      },
      {
        incident_id: "outside-ne-selat-malaka",
        incident_date: "2024-05-01",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.76, 3.78] }
      },
      {
        incident_id: "outside-sw-pancur-batu",
        incident_date: "2024-05-01",
        location_accuracy: "address_geocoded_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.56, 3.47] }
      },
      {
        incident_id: "outside-se-tanjung-morawa",
        incident_date: "2024-05-01",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.76, 3.48] }
      },
      {
        incident_id: "outside-w-sunggal-deliserdang",
        incident_date: "2024-05-01",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.57, 3.6] }
      }
    ];

    for (const rec of insideBboxButOutsidePolygon) {
      const [lon, lat] = rec.geometry.coordinates;
      expect(lat >= MEDAN_BOUNDS.minLat && lat <= MEDAN_BOUNDS.maxLat).toBe(true);
      expect(lon >= MEDAN_BOUNDS.minLon && lon <= MEDAN_BOUNDS.maxLon).toBe(true);
    }

    const res = validateKdeInputRecords(insideBboxButOutsidePolygon, { boundaryGeoJson: OSM_BOUNDARY });
    expect(res.accepted).toEqual([]);
    expect(res.summary.rejectedCount).toBe(5);
    expect(res.summary.rejectionReasons.outside_medan_boundary).toBe(5);
  });
});

describe("hotspot-analyzer P1: validasi ketat input sebelum KDE", () => {
  it("menerima exact_verified & address_geocoded_verified valid serta menolak ID duplikat/kosong, tanggal invalid, DEMO, approximate/district_only, dan geometri malformed", () => {
    expect(isValidIncidentDate("2024-02-29")).toBe(true);
    expect(isValidIncidentDate("2024-02-30")).toBe(false);
    expect(isValidIncidentDate("2023-02-29")).toBe(false);
    expect(isValidIncidentDate("")).toBe(false);

    const records = [
      {
        incident_id: "INC-001",
        incident_date: "2024-06-01",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        isDemo: false,
        dataLabel: "RESMI",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      {
        incident_id: "INC-002",
        incident_date: "2025-01-12",
        location_accuracy: "address_geocoded_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.68, 3.77] }
      },
      // ID duplikat
      {
        incident_id: "INC-001",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      // ID kosong
      {
        incident_id: "  ",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      // Tanggal invalid
      {
        incident_id: "INC-BAD-DATE",
        incident_date: "2024-02-30",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      // DEMO berbagai variasi spasi/kapitalisasi
      {
        incident_id: "INC-DEMO-1",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        isDemo: true,
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      {
        incident_id: "INC-DEMO-2",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        dataLabel: "  DeMo  ",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      // Akurasi & status verifikasi ditolak (termasuk approximate)
      {
        incident_id: "INC-APPROX",
        incident_date: "2024-06-02",
        location_accuracy: "approximate",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      {
        incident_id: "INC-DIST",
        incident_date: "2024-06-02",
        location_accuracy: "district_only",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      {
        incident_id: "INC-UNKNOWN",
        incident_date: "2024-06-02",
        location_accuracy: "unknown",
        verification_status: "unlocated",
        geometry: { type: "Point", coordinates: [98.6714, 3.5895] }
      },
      // Geometri non-GeoJSON Point, WKT, NaN, Infinity, Polygon, swapped lat/lon
      {
        incident_id: "INC-WKT",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geom: "POINT(98.675 3.585)"
      },
      {
        incident_id: "INC-POLY",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: {
          type: "Polygon",
          coordinates: [[[98.66, 3.58], [98.68, 3.58], [98.68, 3.59], [98.66, 3.58]]]
        }
      },
      {
        incident_id: "INC-NAN",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [Number.NaN, 3.59] }
      },
      {
        incident_id: "INC-INF",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [98.67, Number.POSITIVE_INFINITY] }
      },
      {
        incident_id: "INC-SWAPPED",
        incident_date: "2024-06-02",
        location_accuracy: "exact_verified",
        verification_status: "verified",
        geometry: { type: "Point", coordinates: [3.59, 98.67] }
      }
    ];

    const result = validateKdeInputRecords(records, { boundaryGeoJson: OSM_BOUNDARY });
    expect(result.accepted.map((r) => r.incident_id)).toEqual(["INC-001", "INC-002"]);
    expect(result.summary.totalInput).toBe(15);
    expect(result.summary.acceptedCount).toBe(2);
    expect(result.summary.rejectedCount).toBe(13);
    expect(result.summary.pointsUsedForKde).toBe(2);
    expect(result.summary.rejectionReasons.duplicate_incident_id).toBe(1);
    expect(result.summary.rejectionReasons.missing_incident_id).toBe(1);
    expect(result.summary.rejectionReasons.invalid_incident_date).toBe(1);
    expect(result.summary.rejectionReasons.demo_record_flagged).toBe(1);
    expect(result.summary.rejectionReasons.demo_data_label).toBe(1);
    expect(result.summary.rejectionReasons.disallowed_location_accuracy).toBe(3);
  });
});

describe("hotspot-analyzer P2: klasifikasi empat kelas kepadatan", () => {
  it("memetakan rank 1..4 dan label Rendah, Sedang, Tinggi, Sangat Tinggi secara terpisah", () => {
    expect(getHotspotTierMeta(1, "Rendah").tier).toBe("low");
    expect(getHotspotTierMeta(2, "Sedang").tier).toBe("medium");
    expect(getHotspotTierMeta(3, "Tinggi").tier).toBe("high");
    expect(getHotspotTierMeta(4, "Sangat Tinggi").tier).toBe("very-high");
    expect(getHotspotTierMeta(null, "Sangat Tinggi (DEMO)").tier).toBe("very-high");
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

describe("hotspot-analyzer P2: integrasi output resmi, penolakan output DEMO/malformed, dan fallback DEMO", () => {
  it("berhasil memuat output resmi valid dari /data/hotspot-analyzer.verified.geojson", async () => {
    const verifiedPayload = makeValidVerifiedOutput();
    const requestedPaths = [];

    const services = {
      dataStatus: {
        getManifest: vi.fn(async () => ({
          ok: true,
          manifest: {
            verified_outputs: {
              "hotspot-analyzer": { available: true }
            }
          }
        })),
        fetchJson: vi.fn(async (relPath) => {
          requestedPaths.push(relPath);
          if (relPath === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (relPath === "hotspot-analyzer.verified.geojson") return verifiedPayload;
          throw new Error("Should not fetch demo when verified is valid");
        })
      }
    };

    const result = await loadHotspotZones(services);
    expect(requestedPaths).toEqual(["medan_districts_osm.geojson", "hotspot-analyzer.verified.geojson"]);
    expect(result.isDemo).toBe(false);
    expect(result.dataLabel).toBe("TERVERIFIKASI");
    expect(result.sourceMode).toBe("verified");
    expect(result.verifiedLoadStatus).toBe("loaded");
    expect(result.fixturePath).toBe(VERIFIED_HOTSPOT_OUTPUT_URL);
    expect(result.boundaryProvenance.isOfficial).toBe(false);
    expect(result.boundaryProvenance.attribution).toBe(BOUNDARY_PROVENANCE.attribution);
    expect(result.analysis.incident_count_used).toBe(42);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].isDemo).toBe(false);
    expect(result.zones[0].dataLabel).toBe("TERVERIFIKASI");
  });

  it("menolak output resmi yang berlabel DEMO atau malformed secara eksplisit tanpa fallback ke DEMO", async () => {
    const disguisedDemo = makeValidVerifiedOutput({ isDemo: true, dataLabel: "  demo " });
    const services = {
      dataStatus: {
        fetchJson: vi.fn(async (relPath) => {
          if (relPath === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (relPath === "hotspot-analyzer.verified.geojson") return disguisedDemo;
          return null;
        })
      }
    };

    await expect(loadHotspotZones(services, { forceVerifiedFetch: true })).rejects.toThrow(
      /Output KDE terverifikasi ditolak validasi/i
    );
  });

  it("memuat output KDE eksploratif 22 titik dan menolak output malformed secara eksplisit", async () => {
    const malformed = {
      type: "FeatureCollection",
      isDemo: false,
      dataLabel: "TERVERIFIKASI",
      analysis: { source: "Damkarmat", bandwidth_meters: -10, incident_count_used: 0 },
      features: []
    };
    expect(validateVerifiedHotspotOutput(malformed).valid).toBe(false);

    const malformedServices = {
      dataStatus: {
        fetchJson: vi.fn(async (relPath) => {
          if (relPath === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (relPath === "hotspot-analyzer.verified.geojson") return malformed;
          return null;
        })
      }
    };
    await expect(loadHotspotZones(malformedServices, { forceVerifiedFetch: true })).rejects.toThrow(
      /Output KDE terverifikasi ditolak validasi/i
    );

    const realExploratory = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "public/data/hotspot-analyzer.exploratory.geojson"), "utf-8")
    );
    const expServices = {
      dataStatus: {
        getManifest: vi.fn(async () => ({
          ok: true,
          manifest: { verified_outputs: { "hotspot-analyzer": { available: true, status: "exploratory" } } }
        })),
        fetchJson: vi.fn(async (relPath) => {
          if (relPath === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (relPath === "hotspot-analyzer.exploratory.geojson") return realExploratory;
          throw new Error(`Unexpected path: ${relPath}`);
        })
      }
    };

    const expResult = await loadHotspotZones(expServices);
    expect(expResult.usedFallback).toBe(false);
    expect(expResult.fixturePath).toBe(EXPLORATORY_HOTSPOT_OUTPUT_URL);
    expect(expResult.isDemo).toBe(false);
    expect(expResult.sourceMode).toBe("exploratory");
    expect(expResult.analysis.incident_count_used).toBe(22);
    expect(expResult.zones.length).toBeGreaterThan(0);

    const offlineServices = {
      dataStatus: {
        fetchJson: vi.fn(async () => {
          throw new Error("404 Not Found");
        })
      }
    };
    await expect(loadHotspotZones(offlineServices)).rejects.toThrow(/404 Not Found/);
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

    const realExploratory = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "public/data/hotspot-analyzer.exploratory.geojson"), "utf-8")
    );
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
        getManifest: vi.fn(async () => ({
          ok: true,
          manifest: { verified_outputs: { "hotspot-analyzer": { available: true, status: "exploratory" } } }
        })),
        fetchJson: vi.fn(async (relPath) => {
          if (relPath === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (relPath === "hotspot-analyzer.exploratory.geojson") return realExploratory;
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
