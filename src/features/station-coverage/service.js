// Service & validasi metodologi SIG untuk modul Fire Station Coverage (Adriel)

export const REQUIRED_WORKING_CRS = "EPSG:32647";
export const REQUIRED_OUTPUT_CRS = "EPSG:4326";
export const DEFAULT_ASSUMED_SPEED_KMH = 35;
export const PROVISIONAL_COVERAGE_URL = "/data/station-coverage.provisional.json";
export const RUNTIME_DEMO_FIXTURE_URL = "/data/demo/station-coverage.demo.json";
export const EXPECTED_AREA_CODES = Object.freeze(
  Array.from({ length: 21 }, (_, idx) => `12.71.${String(idx + 1).padStart(2, "0")}`)
);

const FALLBACK_DEMO_FIXTURE = {
  isDemo: true,
  dataLabel: "DEMO",
  module: "station-coverage",
  owner: "Adriel",
  notice:
    "DATA DEMO UNTUK PENGEMBANGAN UI: bukan hasil service area jaringan jalan aktual. Hanya Mako 0.0 yang memiliki koordinat terverifikasi.",
  analysis: {
    title: "Demo Jangkauan Layanan Damkarmat (Fixture Kontrak)",
    status: "demo_fixture",
    method_type: "network_service_area",
    road_extract_date: "2026-11-18",
    assumed_speed_kmh: 35,
    thresholds_meters: [3000],
    working_crs: "EPSG:32647",
    output_crs: "EPSG:4326",
    disclaimer:
      "Estimasi skenario jarak jaringan jalan menggunakan asumsi kecepatan teoretis dan batas topologi OSM, bukan waktu respons operasional Damkarmat."
  },
  stations: [
    {
      station_code: "MAKO-00",
      name: "Mako 0.0 Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan",
      station_type: "mako",
      address: "Jl. Candi Borobudur No. 2, Kota Medan",
      lat: 3.589536437471534,
      lon: 98.67144703626451,
      verification_status: "verified",
      isDemo: false,
      source_name: "Satu Data Medan (Knowledge Damkarmat)"
    },
    {
      station_code: "DEMO-UPT-1",
      name: "Contoh Slot Pos UPT (DEMO)",
      station_type: "upt",
      address: "Lokasi placeholder kontrak pengembangan",
      lat: 3.541,
      lon: 98.705,
      verification_status: "needs_review",
      isDemo: true,
      source_name: "DEMO Fixture"
    }
  ],
  zones: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          isDemo: true,
          dataLabel: "DEMO",
          station_code: "MAKO-00",
          coverage_tier: "Jangkauan 3000 m (DEMO)",
          threshold_m: 3000,
          threshold_value: 3000,
          threshold_unit: "meters",
          area_km2: 14.5
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [98.652, 3.572],
              [98.691, 3.572],
              [98.691, 3.607],
              [98.652, 3.607],
              [98.652, 3.572]
            ]
          ]
        }
      }
    ]
  },
  threshold_comparison: [],
  district_coverage: []
};

function isFiniteNumber(val) {
  return typeof val === "number" && Number.isFinite(val);
}

function normalizeLabel(val) {
  if (val === null || val === undefined) return "";
  return String(val).trim().replace(/\s+/g, " ").toUpperCase();
}

export function isDemoStationRecord(station) {
  if (!station || typeof station !== "object" || Array.isArray(station)) return true;
  if (station.isDemo === true || station.is_demo === true) return true;
  if (typeof station.isDemo === "string" && station.isDemo.trim().toLowerCase() === "true") {
    return true;
  }
  for (const field of ["dataLabel", "data_label", "station_code", "source_name", "name"]) {
    const norm = normalizeLabel(station[field]);
    if (norm === "DEMO" || /\bDEMO\b/.test(norm) || norm.startsWith("DEMO-")) {
      return true;
    }
  }
  return false;
}

function isPointOnSegment(px, py, x1, y1, x2, y2, eps = 1e-12) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= eps) return Math.hypot(px - x1, py - y1) <= eps;
  const perp = Math.abs((py - y1) * dx - (px - x1) * dy) / len;
  if (perp > eps) return false;
  return (
    px >= Math.min(x1, x2) - eps &&
    px <= Math.max(x1, x2) + eps &&
    py >= Math.min(y1, y2) - eps &&
    py <= Math.max(y1, y2) + eps
  );
}

function classifyRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 4) return "outside";
  for (let i = 0; i < ring.length - 1; i++) {
    if (isPointOnSegment(lon, lat, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])) {
      return "boundary";
    }
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

function pointInPolyCoords(lon, lat, polyCoords) {
  if (!Array.isArray(polyCoords) || polyCoords.length === 0) return false;
  const outer = classifyRing(lon, lat, polyCoords[0]);
  if (outer === "outside") return false;
  if (outer === "boundary") return true;
  for (let i = 1; i < polyCoords.length; i++) {
    const h = classifyRing(lon, lat, polyCoords[i]);
    if (h === "inside") return false;
    if (h === "boundary") return true;
  }
  return true;
}

export function isPointInGeoJson(lon, lat, geoJson) {
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat) || !geoJson || typeof geoJson !== "object") {
    return false;
  }
  switch (geoJson.type) {
    case "Polygon":
      return pointInPolyCoords(lon, lat, geoJson.coordinates);
    case "MultiPolygon":
      return (
        Array.isArray(geoJson.coordinates) &&
        geoJson.coordinates.some((poly) => pointInPolyCoords(lon, lat, poly))
      );
    case "Feature":
      return isPointInGeoJson(lon, lat, geoJson.geometry);
    case "FeatureCollection":
      return (
        Array.isArray(geoJson.features) &&
        geoJson.features.some((f) => isPointInGeoJson(lon, lat, f))
      );
    default:
      return false;
  }
}

export function validateCoverageCrs(workingCrs, outputCrs) {
  const errors = [];
  if (String(workingCrs || "").trim().toUpperCase() !== REQUIRED_WORKING_CRS) {
    errors.push(`CRS analisis wajib ${REQUIRED_WORKING_CRS}.`);
  }
  if (String(outputCrs || "").trim().toUpperCase() !== REQUIRED_OUTPUT_CRS) {
    errors.push(`CRS output web wajib ${REQUIRED_OUTPUT_CRS}.`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateRoadNetworkMetadata(meta) {
  const errors = [];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { valid: false, errors: ["Metadata jaringan jalan OSM tidak tersedia."] };
  }
  if (!Number.isInteger(meta.segment_count) || meta.segment_count <= 0) {
    errors.push("Jumlah segmen jaringan jalan harus > 0.");
  }
  if (!isFiniteNumber(meta.total_length_km) || meta.total_length_km <= 0) {
    errors.push("Panjang jaringan jalan harus > 0 km.");
  }
  if (String(meta.working_crs || "").toUpperCase() !== REQUIRED_WORKING_CRS) {
    errors.push(`CRS jaringan jalan harus ${REQUIRED_WORKING_CRS}.`);
  }
  if (!String(meta.attribution || "").toLowerCase().includes("openstreetmap")) {
    errors.push("Atribusi OpenStreetMap wajib dicantumkan.");
  }
  return { valid: errors.length === 0, errors };
}

export function computeScenarioMinutes(distanceMeters, assumedSpeedKmh = DEFAULT_ASSUMED_SPEED_KMH) {
  if (!isFiniteNumber(distanceMeters) || distanceMeters <= 0) {
    throw new Error("Jarak skenario wajib angka positif.");
  }
  if (!isFiniteNumber(assumedSpeedKmh) || assumedSpeedKmh <= 0) {
    throw new Error("Kecepatan asumsi wajib angka positif.");
  }
  return Number((((distanceMeters / 1000) / assumedSpeedKmh) * 60).toFixed(2));
}

export function validateStationRecords(stations = [], boundaryGeoJson = null) {
  if (boundaryGeoJson !== null) {
    const hasFeatures =
      boundaryGeoJson &&
      typeof boundaryGeoJson === "object" &&
      ((boundaryGeoJson.type === "FeatureCollection" && Array.isArray(boundaryGeoJson.features) && boundaryGeoJson.features.length > 0) ||
        boundaryGeoJson.type === "Polygon" ||
        boundaryGeoJson.type === "MultiPolygon");
    if (!hasFeatures) {
      throw new Error("Boundary Kota Medan tidak valid untuk validasi lokasi pos.");
    }
  }

  const list = Array.isArray(stations) ? stations : [];
  const seen = new Set();
  const accepted = [];
  const rejected = [];
  const rejectionReasons = {};

  function addReason(reasons, code) {
    if (!reasons.includes(code)) {
      reasons.push(code);
      rejectionReasons[code] = (rejectionReasons[code] || 0) + 1;
    }
  }

  list.forEach((st, idx) => {
    const reasons = [];
    if (!st || typeof st !== "object" || Array.isArray(st)) {
      addReason(reasons, "invalid_station_object");
      rejected.push({ index: idx, station_code: null, reasons });
      return;
    }

    const code = String(st.station_code || "").trim();
    if (!code) {
      addReason(reasons, "missing_station_code");
    } else if (seen.has(code)) {
      addReason(reasons, "duplicate_station_code");
    } else {
      seen.add(code);
    }

    if (isDemoStationRecord(st)) {
      addReason(reasons, "demo_station_rejected");
    }

    if (String(st.verification_status || "").trim().toLowerCase() !== "verified") {
      addReason(reasons, "unverified_station_status");
    }

    const lon = st.lon;
    const lat = st.lat;
    if (!isFiniteNumber(lon) || !isFiniteNumber(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      addReason(reasons, "invalid_coordinates");
    } else if (boundaryGeoJson && !isPointInGeoJson(lon, lat, boundaryGeoJson)) {
      addReason(reasons, "outside_medan_boundary");
    }

    if (reasons.length > 0) {
      rejected.push({ index: idx, station_code: code || null, reasons });
      return;
    }

    accepted.push({
      ...st,
      station_code: code,
      isDemo: false,
      verification_status: "verified"
    });
  });

  return {
    accepted,
    rejected,
    summary: {
      totalInput: list.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      rejectionReasons
    }
  };
}

export function validateStationCoverageOutput(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: ["Payload station-coverage bukan objek JSON."] };
  }
  if (payload.isDemo !== false) {
    errors.push("Output station-coverage resmi/provisional wajib memiliki isDemo === false.");
  }
  const label = normalizeLabel(payload.dataLabel);
  if (!label || /\bDEMO\b/.test(label)) {
    errors.push("dataLabel output tidak boleh kosong atau berlabel DEMO.");
  }

  const analysis = payload.analysis;
  if (!analysis || typeof analysis !== "object") {
    errors.push("Metadata analysis wajib tersedia.");
  } else {
    const crsRes = validateCoverageCrs(analysis.working_crs, analysis.output_crs);
    errors.push(...crsRes.errors);
    if (!String(analysis.disclaimer || "").trim()) {
      errors.push("Disclaimer asumsi skenario waktu tempuh wajib tersedia.");
    }
    if (!isFiniteNumber(analysis.assumed_speed_kmh) || analysis.assumed_speed_kmh <= 0) {
      errors.push("assumed_speed_kmh wajib angka positif.");
    }
  }

  const roadCheck = validateRoadNetworkMetadata(payload.road_network);
  errors.push(...roadCheck.errors);

  if (!Array.isArray(payload.stations) || payload.stations.length === 0) {
    errors.push("Minimal 1 stasiun terverifikasi wajib tersedia.");
  } else {
    const stCheck = validateStationRecords(payload.stations);
    if (stCheck.accepted.length !== payload.stations.length) {
      errors.push("Seluruh stasiun di output wajib berstatus verified dan bukan DEMO.");
    }
  }

  for (const key of ["euclidean_buffers", "network_service_areas"]) {
    const fc = payload[key];
    if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length === 0) {
      errors.push(`Layer ${key} wajib berupa FeatureCollection non-kosong.`);
    }
  }

  if (!Array.isArray(payload.district_coverage) || payload.district_coverage.length !== 21) {
    errors.push("district_coverage wajib memuat tepat 21 kecamatan.");
  } else {
    const codes = new Set(payload.district_coverage.map((r) => r?.area_code));
    if (EXPECTED_AREA_CODES.some((c) => !codes.has(c))) {
      errors.push("Kode area district_coverage tidak lengkap (12.71.01..12.71.21).");
    }
  }

  return { valid: errors.length === 0, errors };
}

function normalizeDemoDataset(payload, usedFallback) {
  const rawZones = payload?.zones?.features || [];
  const stations = Array.isArray(payload?.stations) ? payload.stations : FALLBACK_DEMO_FIXTURE.stations;
  const sanitizedStations = stations.map((st) => ({
    ...st,
    isDemoStation: isDemoStationRecord(st)
  }));

  const demoFeatures = rawZones.map((f, idx) => ({
    ...f,
    properties: {
      ...(f.properties || {}),
      isDemo: true,
      dataLabel: "DEMO",
      threshold_m: Number(f.properties?.threshold_m || f.properties?.threshold_value || 3000),
      zone_id: f.properties?.zone_id || `demo-coverage-${idx + 1}`
    }
  }));

  return {
    isDemo: true,
    dataLabel: "DEMO",
    sourceMode: "demo",
    usedFallback,
    fixturePath: usedFallback ? "fallback:inline-demo-fixture" : RUNTIME_DEMO_FIXTURE_URL,
    notice: String(payload?.notice || FALLBACK_DEMO_FIXTURE.notice),
    analysis: {
      ...FALLBACK_DEMO_FIXTURE.analysis,
      ...(payload?.analysis || {})
    },
    roadNetwork: null,
    stations: sanitizedStations,
    verifiedStations: sanitizedStations.filter((s) => !s.isDemoStation && s.verification_status === "verified"),
    thresholdComparison: [],
    euclideanBuffersGeoJson: { type: "FeatureCollection", features: [] },
    networkServiceAreasGeoJson: { type: "FeatureCollection", features: demoFeatures },
    districtCoverage: []
  };
}

export async function loadStationCoverageData(services, options = {}) {
  let districtsGeoJson = null;
  let shouldCheckProvisional = true;

  if (services?.dataStatus?.getManifest && options.forceProvisionalFetch !== true) {
    try {
      const resp = await services.dataStatus.getManifest();
      const meta = resp?.manifest?.verified_outputs?.["station-coverage"];
      if (meta && meta.available === false) {
        shouldCheckProvisional = false;
      }
    } catch {
      shouldCheckProvisional = true;
    }
  }

  if (services?.dataStatus?.fetchJson) {
    try {
      districtsGeoJson = await services.dataStatus.fetchJson("medan_districts_osm.geojson");
    } catch {
      districtsGeoJson = null;
    }
  }

  let provisionalLoadStatus = "unavailable";
  let provisionalValidationErrors = [];

  if (shouldCheckProvisional && services?.dataStatus?.fetchJson) {
    try {
      const provPayload = await services.dataStatus.fetchJson("station-coverage.provisional.json");
      const check = validateStationCoverageOutput(provPayload);
      if (check.valid) {
        const stationVal = validateStationRecords(provPayload.stations, districtsGeoJson);
        return {
          isDemo: false,
          dataLabel: String(provPayload.dataLabel),
          sourceMode: "provisional",
          provisionalLoadStatus: "loaded",
          provisionalValidationErrors: [],
          usedFallback: false,
          fixturePath: PROVISIONAL_COVERAGE_URL,
          notice: String(provPayload.notice),
          analysis: provPayload.analysis,
          roadNetwork: provPayload.road_network,
          stations: stationVal.accepted.map((s) => ({ ...s, isDemoStation: false })),
          verifiedStations: stationVal.accepted,
          rejectedStations: stationVal.rejected,
          thresholdComparison: provPayload.threshold_comparison || [],
          euclideanBuffersGeoJson: provPayload.euclidean_buffers,
          networkServiceAreasGeoJson: provPayload.network_service_areas,
          districtCoverage: provPayload.district_coverage || [],
          districtsGeoJson
        };
      }
      provisionalLoadStatus = "rejected";
      provisionalValidationErrors = check.errors;
    } catch {
      provisionalLoadStatus = "unavailable";
    }
  }

  let demoPayload = null;
  let usedFallback = false;
  if (services?.dataStatus?.fetchJson) {
    try {
      demoPayload = await services.dataStatus.fetchJson("demo/station-coverage.demo.json");
      if (!demoPayload || typeof demoPayload !== "object") {
        demoPayload = FALLBACK_DEMO_FIXTURE;
        usedFallback = true;
      }
    } catch {
      demoPayload = FALLBACK_DEMO_FIXTURE;
      usedFallback = true;
    }
  } else {
    demoPayload = FALLBACK_DEMO_FIXTURE;
    usedFallback = true;
  }

  return {
    ...normalizeDemoDataset(demoPayload, usedFallback),
    provisionalLoadStatus,
    provisionalValidationErrors,
    districtsGeoJson
  };
}

export function filterDistrictCoverage(rows = [], { search = "", coverageBand = "semua" } = {}) {
  const q = String(search || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    const pct5 = Number(r.network_5km_coverage_pct || 0);
    if (coverageBand === "terjangkau" && pct5 <= 0) return false;
    if (coverageBand === "parsial" && (pct5 <= 0 || pct5 >= 99.9)) return false;
    if (coverageBand === "belum-terjangkau" && pct5 > 0) return false;
    if (q) {
      const hay = `${r.area_code} ${r.district_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
