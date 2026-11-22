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
    }),
    circleMarker: () => ({
      bindPopup: () => ({
        addTo: vi.fn()
      })
    })
  }
}));

import {
  PROVISIONAL_COVERAGE_URL,
  RUNTIME_DEMO_FIXTURE_URL,
  computeScenarioMinutes,
  filterDistrictCoverage,
  isDemoStationRecord,
  loadStationCoverageData,
  validateCoverageCrs,
  validateRoadNetworkMetadata,
  validateStationCoverageOutput,
  validateStationRecords
} from "../../src/features/station-coverage/service.js";
import { renderStationCoverage } from "../../src/features/station-coverage/view.js";

const OSM_BOUNDARY = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "public/data/medan_districts_osm.geojson"), "utf-8")
);
const SUMMARY = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "public/data/fire_incidents_summary.json"), "utf-8")
);

describe("station-coverage Phase 6: validasi Mako, penolakan DEMO-UPT, CRS, road network, dan lifecycle", () => {
  it("memvalidasi Mako 0.0 dan menolak DEMO-UPT-1, koordinat luar Medan, serta stasiun kosong", () => {
    const mako = SUMMARY.verified_stations[0];
    const demoUpt = {
      station_code: "DEMO-UPT-1",
      name: "Contoh Slot Pos UPT (DEMO)",
      lat: 3.541,
      lon: 98.705,
      verification_status: "verified",
      isDemo: false
    };
    const outsideStation = {
      station_code: "OUT-01",
      name: "Luar Medan",
      lat: 3.78,
      lon: 98.57,
      verification_status: "verified",
      isDemo: false
    };

    expect(isDemoStationRecord(demoUpt)).toBe(true);
    const val = validateStationRecords([mako, demoUpt, outsideStation], OSM_BOUNDARY);
    expect(val.accepted.map((s) => s.station_code)).toEqual(["MAKO-00"]);
    expect(val.rejected).toHaveLength(2);
    expect(val.summary.rejectionReasons.demo_station_rejected).toBe(1);
    expect(val.summary.rejectionReasons.outside_medan_boundary).toBe(1);

    const emptyVal = validateStationRecords([], OSM_BOUNDARY);
    expect(emptyVal.accepted).toEqual([]);
    expect(emptyVal.summary.totalInput).toBe(0);
  });

  it("memvalidasi CRS metrik EPSG:32647 -> EPSG:4326, metadata jaringan jalan, dan skenario menit tempuh", () => {
    expect(validateCoverageCrs("EPSG:32647", "EPSG:4326").valid).toBe(true);
    expect(validateCoverageCrs("EPSG:4326", "EPSG:4326").valid).toBe(false);

    expect(
      validateRoadNetworkMetadata({
        segment_count: 44522,
        total_length_km: 6723.27,
        working_crs: "EPSG:32647",
        attribution: "© OpenStreetMap contributors"
      }).valid
    ).toBe(true);
    expect(validateRoadNetworkMetadata({ segment_count: 0 }).valid).toBe(false);

    expect(computeScenarioMinutes(3500, 35)).toBe(6);
    expect(() => computeScenarioMinutes(-100, 35)).toThrow();
  });

  it("memuat hasil buffer & network service area provisional valid serta jatuh aman ke DEMO jika tidak tersedia/invalid", async () => {
    const validProvisional = {
      isDemo: false,
      dataLabel: "PROVISIONAL",
      notice: "Provisional Mako 0.0",
      analysis: {
        working_crs: "EPSG:32647",
        output_crs: "EPSG:4326",
        assumed_speed_kmh: 35,
        disclaimer: "Skenario 35 km/jam, bukan aktual."
      },
      road_network: {
        segment_count: 44522,
        total_length_km: 6723.27,
        working_crs: "EPSG:32647",
        attribution: "© OpenStreetMap contributors",
        extract_date: "2026-11-21"
      },
      stations: [SUMMARY.verified_stations[0]],
      threshold_comparison: [
        { threshold_meters: 5000, scenario_minutes: 8.57, euclidean_area_km2: 78.5, network_area_km2: 42.1 }
      ],
      euclidean_buffers: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { threshold_m: 5000, area_km2: 78.5 },
            geometry: { type: "Polygon", coordinates: [[[98.65, 3.57], [98.69, 3.57], [98.69, 3.60], [98.65, 3.57]]] }
          }
        ]
      },
      network_service_areas: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { threshold_m: 5000, area_km2: 42.1 },
            geometry: { type: "Polygon", coordinates: [[[98.65, 3.57], [98.69, 3.57], [98.69, 3.60], [98.65, 3.57]]] }
          }
        ]
      },
      district_coverage: Array.from({ length: 21 }, (_, idx) => ({
        area_code: `12.71.${String(idx + 1).padStart(2, "0")}`,
        district_name: `Kecamatan ${idx + 1}`,
        district_area_km2: 10,
        network_3km_coverage_pct: 20,
        network_5km_coverage_pct: idx === 0 ? 80 : 0,
        network_5km_gap_ratio: idx === 0 ? 0.2 : 1.0,
        euclidean_5km_coverage_pct: 85,
        centroid_distance_m_mako: 2500
      }))
    };

    expect(validateStationCoverageOutput(validProvisional).valid).toBe(true);
    const loaded = await loadStationCoverageData({
      dataStatus: {
        getManifest: vi.fn(async () => ({
          ok: true,
          manifest: { verified_outputs: { "station-coverage": { available: true } } }
        })),
        fetchJson: vi.fn(async (p) => {
          if (p === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (p === "station-coverage.provisional.json") return validProvisional;
          return null;
        })
      }
    });

    expect(loaded.isDemo).toBe(false);
    expect(loaded.dataLabel).toBe("PROVISIONAL");
    expect(loaded.fixturePath).toBe(PROVISIONAL_COVERAGE_URL);
    expect(loaded.verifiedStations).toHaveLength(1);
    expect(filterDistrictCoverage(loaded.districtCoverage, { coverageBand: "terjangkau" })).toHaveLength(1);

    const demoFallback = await loadStationCoverageData({
      dataStatus: {
        fetchJson: vi.fn(async () => {
          throw new Error("offline");
        })
      }
    });
    expect(demoFallback.isDemo).toBe(true);
    expect(demoFallback.dataLabel).toBe("DEMO");
    expect(demoFallback.fixturePath).not.toBe(PROVISIONAL_COVERAGE_URL);
    expect(demoFallback.stations.some((s) => s.station_code === "DEMO-UPT-1" && s.isDemoStation)).toBe(true);
    expect(RUNTIME_DEMO_FIXTURE_URL).toContain("station-coverage.demo.json");
  });

  it("membersihkan map dan chart saat unmount station-coverage", async () => {
    const mapDestroy = vi.fn();
    const chartDestroy = vi.fn();
    const ids = [
      "#coverage-threshold-select",
      "#coverage-band-select",
      "#coverage-search-input",
      "#coverage-reset-btn",
      "#coverage-toggle-network",
      "#coverage-toggle-euclidean",
      "#coverage-toggle-districts",
      "#coverage-district-detail",
      "#coverage-chart-empty",
      "#coverage-chart-frame",
      "#coverage-chart",
      "#coverage-table-count",
      "#coverage-table-wrap",
      "#coverage-map"
    ];
    const map = new Map(
      ids.map((id) => [
        id,
        {
          value: "semua",
          checked: true,
          hidden: false,
          innerHTML: "",
          textContent: "",
          addEventListener: vi.fn(),
          replaceChildren: vi.fn(),
          querySelectorAll: () => []
        }
      ])
    );

    const unmount = await renderStationCoverage({
      container: {
        innerHTML: "",
        querySelector: (s) => map.get(s) || null,
        querySelectorAll: () => [],
        replaceChildren: vi.fn()
      },
      services: {
        format: { number: (n) => String(n), distance: (m) => `${m} m` },
        maps: { createMap: vi.fn(() => ({ map: {}, destroy: mapDestroy })), fitBounds: vi.fn() },
        charts: { createChart: vi.fn(() => ({ destroy: chartDestroy })) },
        dataStatus: {
          fetchJson: vi.fn(async () => {
            throw new Error("offline");
          })
        }
      },
      manifest: { id: "station-coverage", title: "Fire Station Coverage" }
    });

    await unmount();
    expect(mapDestroy).toHaveBeenCalledTimes(1);
    expect(chartDestroy).toHaveBeenCalledTimes(0);
  });
});
