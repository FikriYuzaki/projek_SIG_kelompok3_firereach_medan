// Service & aturan metodologi SIG untuk modul Fire Hotspot Analyzer (Adeptri)
// Catatan fixture: public/data/demo/hotspot-analyzer.demo.json adalah salinan runtime identik
// dari data/fixtures/demo/hotspot-analyzer.demo.json karena dataStatusService memuat dari base URL /data.

export const STRICT_KDE_ACCURACIES = Object.freeze([
  "exact_verified",
  "address_geocoded_verified"
]);

// Amplop batas kasar (pre-check cepat sebelum pengecekan point-in-polygon)
export const MEDAN_BOUNDS = Object.freeze({
  minLat: 3.45,
  maxLat: 3.85,
  minLon: 98.55,
  maxLon: 98.78
});

/**
 * Poligon batas administrasi Kota Medan (EPSG:4326) sebagai batas default sinkron
 * untuk validasi point-in-polygon (mencakup 21 kecamatan dari Medan Tuntungan di selatan
 * hingga Medan Belawan di utara, serta mengecualikan wilayah Kab. Deli Serdang & Selat Malaka).
 * Saat runtime memuat medan_districts_osm.geojson, batas ini otomatis diperbarui ke poligon OSM.
 */
export const MEDAN_ADMIN_BOUNDARY_GEOJSON = Object.freeze({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Kota Medan",
        source: "medan-admin-boundary-default"
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [98.595, 3.495],
            [98.65, 3.495],
            [98.725, 3.515],
            [98.732, 3.575],
            [98.722, 3.635],
            [98.712, 3.705],
            [98.708, 3.792],
            [98.665, 3.792],
            [98.635, 3.735],
            [98.62, 3.665],
            [98.598, 3.615],
            [98.595, 3.55],
            [98.595, 3.495]
          ]
        ]
      }
    }
  ]
});

let activeMedanBoundaryGeoJson = MEDAN_ADMIN_BOUNDARY_GEOJSON;

export function setMedanBoundaryGeoJson(geoJson) {
  if (geoJson && typeof geoJson === "object") {
    activeMedanBoundaryGeoJson = geoJson;
  }
}

export function resetMedanBoundaryGeoJson() {
  activeMedanBoundaryGeoJson = MEDAN_ADMIN_BOUNDARY_GEOJSON;
}

export const RUNTIME_DEMO_FIXTURE_URL = "/data/demo/hotspot-analyzer.demo.json";

export const HOTSPOT_TIER_CONFIG = Object.freeze({
  low: Object.freeze({
    rank: 1,
    tier: "low",
    label: "Rendah",
    fillColor: "#E9C46A",
    strokeColor: "#9E7E2E"
  }),
  medium: Object.freeze({
    rank: 2,
    tier: "medium",
    label: "Sedang",
    fillColor: "#E79E4F",
    strokeColor: "#A6631B"
  }),
  high: Object.freeze({
    rank: 3,
    tier: "high",
    label: "Tinggi",
    fillColor: "#C8523B",
    strokeColor: "#852D1C"
  }),
  "very-high": Object.freeze({
    rank: 4,
    tier: "very-high",
    label: "Sangat Tinggi",
    fillColor: "#7F1D1D",
    strokeColor: "#450A0A"
  })
});

export const UNKNOWN_HOTSPOT_TIER = Object.freeze({
  rank: null,
  tier: "unknown",
  label: "Tidak Dikenal",
  fillColor: "#64748B",
  strokeColor: "#334155",
  isValid: false,
  hasConflict: false,
  validationNote: "Kelas kepadatan tidak dikenali."
});

const FALLBACK_DEMO_FIXTURE = {
  isDemo: true,
  dataLabel: "DEMO",
  module: "hotspot-analyzer",
  owner: "Adeptri",
  notice:
    "DATA DEMO UNTUK PENGEMBANGAN UI: bukan hasil KDE resmi. Menunggu input titik kebakaran terverifikasi (exact_verified / address_geocoded_verified).",
  analysis: {
    title: "Demo KDE Kebakaran Kota Medan (Fixture Kontrak)",
    period_label: "DEMO 2024-2025",
    kernel_method: "Quartic",
    bandwidth_meters: 1000,
    pixel_size_meters: 100,
    working_crs: "EPSG:32647",
    classification_method: "Quantile (4 kelas)",
    incident_count_used: 0
  },
  zones: {
    type: "FeatureCollection",
    crs: { "type": "name", "properties": { "name": "EPSG:4326" } },
    features: [
      {
        type: "Feature",
        properties: {
          isDemo: true,
          dataLabel: "DEMO",
          zone_id: "demo-hotspot-1",
          density_class: "Tinggi (DEMO)",
          density_rank: 3,
          area_km2: 2.4
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
      },
      {
        type: "Feature",
        properties: {
          isDemo: true,
          dataLabel: "DEMO",
          zone_id: "demo-hotspot-2",
          density_class: "Sedang (DEMO)",
          density_rank: 2,
          area_km2: 3.1
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [98.69, 3.555],
              [98.712, 3.555],
              [98.712, 3.573],
              [98.69, 3.573],
              [98.69, 3.555]
            ]
          ]
        }
      }
    ]
  }
};

function isPointOnSegment(px, py, x1, y1, x2, y2, eps = 1e-12) {
  const cross = (py - y1) * (x2 - x1) - (px - x1) * (y2 - y1);
  if (Math.abs(cross) > eps) return false;
  const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
  return dot <= eps;
}

function isPointInLinearRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ptI = ring[i];
    const ptJ = ring[j];
    if (!Array.isArray(ptI) || !Array.isArray(ptJ)) return false;
    const xi = Number(ptI[0]);
    const yi = Number(ptI[1]);
    const xj = Number(ptJ[0]);
    const yj = Number(ptJ[1]);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      return false;
    }
    if (isPointOnSegment(lon, lat, xi, yi, xj, yj)) {
      return true;
    }
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInPolygonCoords(lon, lat, polygonCoords) {
  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) return false;
  if (!isPointInLinearRing(lon, lat, polygonCoords[0])) return false;
  for (let r = 1; r < polygonCoords.length; r++) {
    if (isPointInLinearRing(lon, lat, polygonCoords[r])) return false;
  }
  return true;
}

/**
 * Algoritma Point-in-Polygon (Ray-Casting) untuk GeoJSON Polygon, MultiPolygon,
 * GeometryCollection, Feature, atau FeatureCollection.
 */
export function isPointInGeoJson(lon, lat, geoJson) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (!geoJson || typeof geoJson !== "object") return false;

  switch (geoJson.type) {
    case "Polygon":
      return isPointInPolygonCoords(lon, lat, geoJson.coordinates);
    case "MultiPolygon":
      return (
        Array.isArray(geoJson.coordinates) &&
        geoJson.coordinates.some((polyCoords) => isPointInPolygonCoords(lon, lat, polyCoords))
      );
    case "GeometryCollection":
      return (
        Array.isArray(geoJson.geometries) &&
        geoJson.geometries.some((geom) => isPointInGeoJson(lon, lat, geom))
      );
    case "Feature":
      return isPointInGeoJson(lon, lat, geoJson.geometry);
    case "FeatureCollection":
      return (
        Array.isArray(geoJson.features) &&
        geoJson.features.some((feature) => isPointInGeoJson(lon, lat, feature))
      );
    default:
      return false;
  }
}

function isFiniteMedanPolygonCoordinate(lon, lat, boundaryGeoJson = activeMedanBoundaryGeoJson) {
  if (typeof lon !== "number" || typeof lat !== "number") return false;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return isPointInGeoJson(lon, lat, boundaryGeoJson);
}

/**
 * Mengekstrak dan memvalidasi geometri Point menggunakan point-in-polygon
 * pada batas administrasi Kota Medan (bukan sekadar bounding box).
 */
export function extractValidMedanPoint(rec, options = {}) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;

  const boundaryGeoJson = options.boundaryGeoJson || activeMedanBoundaryGeoJson;
  const hasGeomField = rec.geom !== undefined || rec.geometry !== undefined;
  const rawGeom = rec.geom !== undefined ? rec.geom : rec.geometry;

  if (hasGeomField) {
    if (!rawGeom) return null;

    if (typeof rawGeom === "string") {
      const match = rawGeom.trim().match(/^POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$/i);
      if (!match) return null;
      const lon = Number(match[1]);
      const lat = Number(match[2]);
      if (!isFiniteMedanPolygonCoordinate(lon, lat, boundaryGeoJson)) return null;
      return { type: "Point", coordinates: [lon, lat] };
    }

    if (typeof rawGeom === "object" && !Array.isArray(rawGeom)) {
      if (rawGeom.type !== "Point") return null;
      if (!Array.isArray(rawGeom.coordinates) || rawGeom.coordinates.length !== 2) return null;
      const [lon, lat] = rawGeom.coordinates;
      if (!isFiniteMedanPolygonCoordinate(lon, lat, boundaryGeoJson)) return null;
      return { type: "Point", coordinates: [lon, lat] };
    }

    return null;
  }

  if (isFiniteMedanPolygonCoordinate(rec.lon, rec.lat, boundaryGeoJson)) {
    return { type: "Point", coordinates: [rec.lon, rec.lat] };
  }

  return null;
}

/**
 * Memeriksa apakah satu record kejadian memenuhi seluruh syarat ketat untuk input KDE.
 * Secara default hanya mengizinkan status "verified" dengan akurasi "exact_verified"
 * atau "address_geocoded_verified", bukan record DEMO, dan berada di dalam poligon Kota Medan.
 */
export function isRecordKdeEligible(rec, options = {}) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return false;
  if (rec.isDemo === true) return false;
  if (String(rec.dataLabel ?? "").trim().toUpperCase() === "DEMO") return false;
  if (rec.verification_status !== "verified") return false;

  const accuracy = String(rec.location_accuracy || "").trim();
  const isStrictAccuracy = STRICT_KDE_ACCURACIES.includes(accuracy);
  const isExplicitApproximate =
    accuracy === "approximate" &&
    options.allowApproximate === true &&
    options.approximateApproved === true &&
    typeof options.approximateReason === "string" &&
    options.approximateReason.trim().length > 0;

  if (!isStrictAccuracy && !isExplicitApproximate) return false;

  return extractValidMedanPoint(rec, options) !== null;
}

export function filterKdeEligiblePoints(records = [], options = {}) {
  if (!Array.isArray(records)) return [];
  return records.filter((rec) => isRecordKdeEligible(rec, options));
}

function resolveTierFromRank(rank) {
  if (rank === null || rank === undefined || rank === "") return { tierKey: null, invalid: false };
  const numRank = Number(rank);
  if (!Number.isInteger(numRank)) return { tierKey: null, invalid: true };
  if (numRank === 1) return { tierKey: "low", invalid: false };
  if (numRank === 2) return { tierKey: "medium", invalid: false };
  if (numRank === 3) return { tierKey: "high", invalid: false };
  if (numRank === 4) return { tierKey: "very-high", invalid: false };
  return { tierKey: null, invalid: true };
}

function resolveTierFromLabel(densityClass) {
  const raw = String(densityClass ?? "").trim();
  if (!raw) return { tierKey: null, invalid: false };

  const cleaned = raw
    .replace(/\(demo\)/gi, "")
    .replace(/\bdemo\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) return { tierKey: null, invalid: false };

  // Dahulukan "sangat tinggi" / "very high" sebelum "tinggi" agar tidak salah klasifikasi
  if (
    cleaned === "sangat tinggi" ||
    cleaned === "very high" ||
    cleaned === "very-high" ||
    cleaned.includes("sangat tinggi") ||
    cleaned.includes("very high")
  ) {
    return { tierKey: "very-high", invalid: false };
  }
  if (cleaned === "tinggi" || cleaned === "high" || cleaned.includes("tinggi")) {
    return { tierKey: "high", invalid: false };
  }
  if (cleaned === "sedang" || cleaned === "medium" || cleaned === "moderate" || cleaned.includes("sedang")) {
    return { tierKey: "medium", invalid: false };
  }
  if (cleaned === "rendah" || cleaned === "low" || cleaned.includes("rendah")) {
    return { tierKey: "low", invalid: false };
  }

  return { tierKey: null, invalid: true };
}

/**
 * Memetakan density_rank (1..4) dan label density_class ke empat kelas standar KDE:
 * 1: Rendah (low), 2: Sedang (medium), 3: Tinggi (high), 4: Sangat Tinggi (very-high).
 */
export function getHotspotTierMeta(rank, densityClass = "") {
  const rankResult = resolveTierFromRank(rank);
  const labelResult = resolveTierFromLabel(densityClass);

  if (rankResult.invalid && !labelResult.tierKey) {
    return {
      ...UNKNOWN_HOTSPOT_TIER,
      validationNote: `Nilai density_rank (${rank}) tidak valid.`
    };
  }

  if (labelResult.invalid && !rankResult.tierKey) {
    return {
      ...UNKNOWN_HOTSPOT_TIER,
      validationNote: `Label kelas "${densityClass}" tidak dikenali.`
    };
  }

  if (rankResult.tierKey && labelResult.tierKey && rankResult.tierKey !== labelResult.tierKey) {
    const base = HOTSPOT_TIER_CONFIG[rankResult.tierKey];
    return {
      ...base,
      isValid: true,
      hasConflict: true,
      validationNote: `Konflik metadata: rank ${rank} (${base.label}) tidak cocok dengan label "${densityClass}".`
    };
  }

  const resolvedKey = rankResult.tierKey || labelResult.tierKey;
  if (resolvedKey && HOTSPOT_TIER_CONFIG[resolvedKey]) {
    return {
      ...HOTSPOT_TIER_CONFIG[resolvedKey],
      isValid: true,
      hasConflict: Boolean(rankResult.invalid || labelResult.invalid),
      validationNote:
        rankResult.invalid || labelResult.invalid
          ? "Sebagian metadata kelas tidak lengkap/tidak standar, menggunakan nilai valid yang tersedia."
          : ""
    };
  }

  return { ...UNKNOWN_HOTSPOT_TIER };
}

export async function loadHotspotZones(services) {
  let payload = null;
  let districtsGeoJson = null;
  let usedFallback = false;

  if (services?.dataStatus?.fetchJson) {
    try {
      payload = await services.dataStatus.fetchJson("demo/hotspot-analyzer.demo.json");
    } catch {
      payload = FALLBACK_DEMO_FIXTURE;
      usedFallback = true;
    }

    try {
      districtsGeoJson = await services.dataStatus.fetchJson("medan_districts_osm.geojson");
      if (districtsGeoJson && Array.isArray(districtsGeoJson.features) && districtsGeoJson.features.length > 0) {
        setMedanBoundaryGeoJson(districtsGeoJson);
      }
    } catch {
      districtsGeoJson = null;
    }
  } else {
    payload = FALLBACK_DEMO_FIXTURE;
    usedFallback = true;
  }

  const zonesGeoJson = payload?.zones || { type: "FeatureCollection", features: [] };
  const allZones = (zonesGeoJson.features || []).map((feature, index) => {
    const props = feature.properties || {};
    const tierMeta = getHotspotTierMeta(props.density_rank, props.density_class);
    const isDemo = Boolean(props.isDemo ?? payload?.isDemo ?? usedFallback);
    const dataLabel = String(props.dataLabel || payload?.dataLabel || (isDemo ? "DEMO" : "TERVERIFIKASI"));

    return {
      zone_id: String(props.zone_id || `zone-${index + 1}`),
      density_class: String(props.density_class || tierMeta.label),
      density_rank: tierMeta.rank ?? Number(props.density_rank || 0),
      area_km2: Number(props.area_km2 || 0),
      isDemo,
      dataLabel,
      tierMeta,
      feature
    };
  });

  const validZones = allZones.filter((z) => z.tierMeta.isValid);
  const invalidZones = allZones.filter((z) => !z.tierMeta.isValid);
  const validGeoJson = {
    type: "FeatureCollection",
    crs: zonesGeoJson.crs,
    features: validZones.map((z) => z.feature)
  };

  const isDemoDataset = Boolean(payload?.isDemo ?? usedFallback);
  const datasetLabel = String(payload?.dataLabel || (isDemoDataset ? "DEMO" : "TERVERIFIKASI"));

  return {
    isDemo: isDemoDataset,
    dataLabel: datasetLabel,
    usedFallback,
    fixturePath: usedFallback ? "fallback:inline-demo-fixture" : RUNTIME_DEMO_FIXTURE_URL,
    notice: String(payload?.notice || FALLBACK_DEMO_FIXTURE.notice),
    analysis: payload?.analysis || null,
    zones: validZones,
    invalidZones,
    zonesGeoJson: validGeoJson,
    districtsGeoJson
  };
}

export function filterHotspotZones(zones = [], { densityTier = "semua", search = "" } = {}) {
  const query = String(search || "").trim().toLowerCase();
  return (zones || []).filter((item) => {
    if (!item?.tierMeta?.isValid) return false;
    if (densityTier !== "semua" && item.tierMeta.tier !== densityTier) {
      return false;
    }
    if (query) {
      const hay = `${item.zone_id} ${item.density_class} ${item.tierMeta.label} ${item.dataLabel}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}