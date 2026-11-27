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
  computeScenarioMinutes,
  filterDistrictCoverage,
  formatCoverageDelta,
  isDemoStationRecord,
  loadStationCoverageData,
  validateCandidateCoverageScenario,
  validateCandidateStationRecords,
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
const CURATED_CANDIDATES = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "qgis/station-coverage/public_station_candidates.json"), "utf-8")
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

    await expect(
      loadStationCoverageData({
        dataStatus: {
          fetchJson: vi.fn(async () => {
            throw new Error("offline");
          })
        }
      })
    ).rejects.toThrow(/offline/);
  });

  it("memvalidasi 6 kandidat publik UPT dan menolak DEMO, verified palsu, koordinat luar Medan, serta district_only berkoordinat", () => {
    const validRes = validateCandidateStationRecords(
      CURATED_CANDIDATES.candidates,
      OSM_BOUNDARY,
      new Set(["MAKO-00"])
    );
    expect(validRes.rejected).toEqual([]);
    expect(validRes.summary.acceptedCount).toBe(6);
    expect(validRes.summary.geolocatedCount).toBe(4);
    expect(validRes.summary.districtOnlyCount).toBe(2);
    expect(validRes.geolocated.map((s) => s.station_code)).toEqual(["UPT-01", "UPT-02", "UPT-05", "UPT-06"]);
    expect(validRes.districtOnly.map((s) => s.station_code)).toEqual(["UPT-03", "UPT-04"]);

    const invalidCases = [
      { ...CURATED_CANDIDATES.candidates[0], station_code: "MAKO-00" },
      { ...CURATED_CANDIDATES.candidates[0], station_code: "DEMO-UPT-2", isDemo: true },
      { ...CURATED_CANDIDATES.candidates[0], station_code: "UPT-FAKE-VER", verification_status: "verified" },
      {
        ...CURATED_CANDIDATES.candidates[0],
        station_code: "UPT-OUT-KIM",
        lat: 3.6720893,
        lon: 98.6819896,
        geom: { type: "Point", coordinates: [98.6819896, 3.6720893] }
      },
      {
        ...CURATED_CANDIDATES.candidates[3],
        station_code: "UPT-BAD-NULL",
        lat: 3.7767,
        lon: 98.6841,
        geom: { type: "Point", coordinates: [98.6841, 3.7767] }
      }
    ];
    const invalidRes = validateCandidateStationRecords(invalidCases, OSM_BOUNDARY, new Set(["MAKO-00"]));
    expect(invalidRes.accepted).toEqual([]);
    expect(invalidRes.summary.rejectedCount).toBe(5);
    expect(invalidRes.summary.rejectionReasons.duplicate_verified_station_code).toBe(1);
    expect(invalidRes.summary.rejectionReasons.demo_station_rejected).toBe(1);
    expect(invalidRes.summary.rejectionReasons.must_remain_needs_review).toBe(1);
    expect(invalidRes.summary.rejectionReasons.outside_medan_boundary).toBe(1);
    expect(invalidRes.summary.rejectionReasons.district_only_must_have_null_geom).toBe(1);
  });

  it("menolak skenario kandidat yang mengaku resmi dan mendukung fallback kandidat dari fire_incidents_summary.json", async () => {
    const fakeOfficialScenario = {
      isDemo: false,
      is_official_coverage: true,
      dataLabel: "SKENARIO_KANDIDAT_BELUM_TERVERIFIKASI",
      working_crs: "EPSG:32647",
      output_crs: "EPSG:4326",
      assumed_speed_kmh: 35,
      disclaimer: "Disclaimer",
      included_station_codes: ["MAKO-00", "UPT-05"],
      threshold_comparison: [{ threshold_meters: 5000, scenario_minutes: 8.57, euclidean_area_km2: 10, network_area_km2: 8 }],
      euclidean_buffers: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { threshold_m: 5000 }, geometry: { type: "Polygon", coordinates: [[[98.65, 3.57], [98.69, 3.57], [98.69, 3.60], [98.65, 3.57]]] } }]
      },
      network_service_areas: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { threshold_m: 5000 }, geometry: { type: "Polygon", coordinates: [[[98.65, 3.57], [98.69, 3.57], [98.69, 3.60], [98.65, 3.57]]] } }]
      },
      district_coverage: Array.from({ length: 21 }, (_, idx) => ({
        area_code: `12.71.${String(idx + 1).padStart(2, "0")}`,
        district_name: `Kecamatan ${idx + 1}`,
        district_area_km2: 10,
        network_3km_coverage_pct: 20,
        network_5km_coverage_pct: 40,
        network_5km_gap_ratio: 0.6,
        euclidean_5km_coverage_pct: 60,
        centroid_distance_m_mako: 2000
      }))
    };
    const scenCheck = validateCandidateCoverageScenario(fakeOfficialScenario);
    expect(scenCheck.valid).toBe(false);

    const legacyProv = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "public/data/station-coverage.provisional.json"), "utf-8")
    );
    delete legacyProv.candidate_stations;
    delete legacyProv.candidate_coverage_scenario;

    const loaded = await loadStationCoverageData({
      dataStatus: {
        getManifest: vi.fn(async () => ({ ok: true, manifest: { verified_outputs: { "station-coverage": { available: true } } } })),
        fetchJson: vi.fn(async (p) => {
          if (p === "medan_districts_osm.geojson") return OSM_BOUNDARY;
          if (p === "station-coverage.provisional.json") return legacyProv;
          if (p === "fire_incidents_summary.json") return SUMMARY;
          return null;
        })
      }
    });
    expect(loaded.verifiedStations).toHaveLength(1);
    expect(loaded.candidateStations).toHaveLength(6);
    expect(loaded.candidateStations.every((s) => s.verification_status === "needs_review")).toBe(true);
    expect(loaded.candidateCoverageScenario).toBeNull();
  });

  it("memformat delta cakupan secara jujur untuk positif, negatif, nol, dan null", () => {
    expect(formatCoverageDelta(37.84, { decimals: 1, unit: "%" })).toEqual({
      text: "+37.8%",
      className: "coverage-delta-pos",
      sign: "positive"
    });
    expect(formatCoverageDelta(37.84, { decimals: 2, unit: " poin %" })).toEqual({
      text: "+37.84 poin %",
      className: "coverage-delta-pos",
      sign: "positive"
    });
    expect(formatCoverageDelta(-4.25, { decimals: 1, unit: "%" })).toEqual({
      text: "-4.3%",
      className: "coverage-delta-neg",
      sign: "negative"
    });
    expect(formatCoverageDelta(-4.25, { decimals: 2, unit: " poin %" })).toEqual({
      text: "-4.25 poin %",
      className: "coverage-delta-neg",
      sign: "negative"
    });
    expect(formatCoverageDelta(0, { decimals: 1, unit: "%" })).toEqual({
      text: "0.0%",
      className: "coverage-delta-zero",
      sign: "neutral"
    });
    expect(formatCoverageDelta(-0, { decimals: 2, unit: " poin %" })).toEqual({
      text: "0.00 poin %",
      className: "coverage-delta-zero",
      sign: "neutral"
    });
    expect(formatCoverageDelta(0.001, { decimals: 1, unit: "%" })).toEqual({
      text: "0.0%",
      className: "coverage-delta-zero",
      sign: "neutral"
    });
    expect(formatCoverageDelta(null)).toEqual({
      text: "-",
      className: "coverage-delta-zero",
      sign: "neutral"
    });
    expect(formatCoverageDelta(Number.NaN)).toEqual({
      text: "-",
      className: "coverage-delta-zero",
      sign: "neutral"
    });
  });

  it("membersihkan map dan chart saat unmount station-coverage", async () => {
    const mapDestroy = vi.fn();
    const chartDestroy = vi.fn();
    const ids = [
      "#coverage-scenario-select",
      "#coverage-station-select",
      "#coverage-threshold-select",
      "#coverage-band-select",
      "#coverage-search-input",
      "#coverage-reset-btn",
      "#coverage-toggle-network",
      "#coverage-toggle-euclidean",
      "#coverage-toggle-districts",
      "#coverage-toggle-candidates",
      "#coverage-toggle-partition",
      "#coverage-candidate-scenario-banner",
      "#coverage-selected-station-note",
      "#coverage-kpi-net5",
      "#coverage-kpi-net5-sub",
      "#coverage-map-title",
      "#coverage-chart-title",
      "#coverage-table-title",
      "#coverage-stations-table-wrap",
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

    const realCoverage = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "public/data/station-coverage.provisional.json"), "utf-8")
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
          getManifest: vi.fn(async () => ({
            ok: true,
            manifest: { verified_outputs: { "station-coverage": { available: true } } }
          })),
          fetchJson: vi.fn(async (p) => {
            if (p === "medan_districts_osm.geojson") return OSM_BOUNDARY;
            if (p === "station-coverage.provisional.json") return realCoverage;
            throw new Error("offline");
          })
        }
      },
      manifest: { id: "station-coverage", title: "Fire Station Coverage" }
    });

    await unmount();
    expect(mapDestroy).toHaveBeenCalledTimes(1);
    expect(chartDestroy).toHaveBeenCalledTimes(1);
  });
});
