// Service & aturan metodologi SIG untuk modul Fire Hotspot Analyzer (Adeptri)

export const STRICT_KDE_ACCURACIES = Object.freeze([
  "exact_verified",
  "address_geocoded_verified"
]);

// Amplop batas kasar (hanya referensi QA cepat, BUKAN batas analisis akhir)
export const MEDAN_BOUNDS = Object.freeze({
  minLat: 3.45,
  maxLat: 3.85,
  minLon: 98.55,
  maxLon: 98.78
});

export const BOUNDARY_DATA_URL = "/data/medan_districts_osm.geojson";
export const VERIFIED_HOTSPOT_OUTPUT_URL = "/data/hotspot-analyzer.verified.geojson";
export const EXPLORATORY_HOTSPOT_OUTPUT_URL = "/data/hotspot-analyzer.exploratory.geojson";

export const BOUNDARY_PROVENANCE = Object.freeze({
  source: "OpenStreetMap Nominatim (Fallback Geoportal Medan)",
  attribution: "© OpenStreetMap contributors",
  license: "ODbL 1.0",
  isOfficial: false,
  note: "Fallback OpenStreetMap, bukan batas administrasi resmi Pemko Medan."
});

let activeMedanBoundaryGeoJson = null;

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

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidWgs84Pair(lon, lat) {
  return (
    isFiniteNumber(lon) &&
    isFiniteNumber(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function normalizeLabel(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, " ").toUpperCase();
}

function isDemoFlag(value) {
  if (value === true) return true;
  if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  return false;
}

function isDemoLabel(value) {
  const normalized = normalizeLabel(value);
  if (!normalized) return false;
  return normalized === "DEMO" || /\bDEMO\b/.test(normalized);
}

export function isValidIncidentDate(value) {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;

  const dateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    if (year < 1900 || year > 2100) return false;
    const d = new Date(Date.UTC(year, month - 1, day));
    return (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    );
  }

  const dtMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/
  );
  if (dtMatch) {
    const year = Number(dtMatch[1]);
    const month = Number(dtMatch[2]);
    const day = Number(dtMatch[3]);
    const hour = Number(dtMatch[4]);
    const minute = Number(dtMatch[5]);
    const second = dtMatch[6] !== undefined ? Number(dtMatch[6]) : 0;
    if (year < 1900 || year > 2100) return false;
    if (hour > 23 || minute > 59 || second > 59) return false;
    const d = new Date(Date.UTC(year, month - 1, day));
    return (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    );
  }

  return false;
}

function ringSignedArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    if (!Array.isArray(p1) || !Array.isArray(p2) || p1.length < 2 || p2.length < 2) {
      return 0;
    }
    if (!isFiniteNumber(p1[0]) || !isFiniteNumber(p1[1]) || !isFiniteNumber(p2[0]) || !isFiniteNumber(p2[1])) {
      return 0;
    }
    sum += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return 0.5 * sum;
}

function isValidLinearRing(ring, eps = 1e-12) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2 || !isValidWgs84Pair(pt[0], pt[1])) {
      return false;
    }
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) > eps || Math.abs(first[1] - last[1]) > eps) {
    return false;
  }
  return Math.abs(ringSignedArea(ring)) > 1e-15;
}

function validatePolygonCoords(polyCoords, label, errors) {
  if (!Array.isArray(polyCoords) || polyCoords.length === 0) {
    errors.push(`${label}: koordinat Polygon kosong atau bukan array.`);
    return 0;
  }
  if (!isValidLinearRing(polyCoords[0])) {
    errors.push(`${label}: exterior ring tidak valid, tidak tertutup, atau luas nol.`);
    return 0;
  }
  let holes = 0;
  for (let i = 1; i < polyCoords.length; i++) {
    if (!isValidLinearRing(polyCoords[i])) {
      errors.push(`${label}: interior ring (hole #${i}) tidak valid.`);
      return holes;
    }
    holes += 1;
  }
  return holes;
}

/**
 * Memvalidasi GeoJSON batas wilayah (Polygon, MultiPolygon, Feature, FeatureCollection).
 */
export function validateBoundaryGeoJson(geoJson) {
  const errors = [];
  let polygonCount = 0;
  let holeCount = 0;

  function walk(node, label) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`${label}: objek GeoJSON harus berupa object.`);
      return;
    }
    switch (node.type) {
      case "FeatureCollection": {
        if (!Array.isArray(node.features) || node.features.length === 0) {
          errors.push(`${label}: FeatureCollection tidak memiliki daftar features yang valid.`);
          return;
        }
        node.features.forEach((feat, idx) => walk(feat, `${label}.features[${idx}]`));
        break;
      }
      case "Feature": {
        if (!node.geometry || typeof node.geometry !== "object") {
          errors.push(`${label}: Feature tidak memiliki geometry yang valid.`);
          return;
        }
        walk(node.geometry, `${label}.geometry`);
        break;
      }
      case "GeometryCollection": {
        if (!Array.isArray(node.geometries) || node.geometries.length === 0) {
          errors.push(`${label}: GeometryCollection kosong.`);
          return;
        }
        node.geometries.forEach((geom, idx) => walk(geom, `${label}.geometries[${idx}]`));
        break;
      }
      case "Polygon": {
        const before = errors.length;
        const holes = validatePolygonCoords(node.coordinates, label, errors);
        if (errors.length === before) {
          polygonCount += 1;
          holeCount += holes;
        }
        break;
      }
      case "MultiPolygon": {
        if (!Array.isArray(node.coordinates) || node.coordinates.length === 0) {
          errors.push(`${label}: MultiPolygon tidak memiliki poligon.`);
          return;
        }
        node.coordinates.forEach((polyCoords, idx) => {
          const before = errors.length;
          const holes = validatePolygonCoords(polyCoords, `${label}[${idx}]`, errors);
          if (errors.length === before) {
            polygonCount += 1;
            holeCount += holes;
          }
        });
        break;
      }
      default:
        errors.push(`${label}: tipe geometri batas '${String(node.type)}' tidak didukung.`);
    }
  }

  walk(geoJson, "boundary");
  if (polygonCount === 0 && errors.length === 0) {
    errors.push("boundary: tidak ditemukan poligon batas yang valid.");
  }

  return {
    valid: errors.length === 0 && polygonCount > 0,
    errors,
    polygonCount,
    holeCount
  };
}

export function setMedanBoundaryGeoJson(geoJson) {
  const check = validateBoundaryGeoJson(geoJson);
  if (!check.valid) {
    throw new Error(`Boundary administrasi Kota Medan tidak valid: ${check.errors.join("; ")}`);
  }
  activeMedanBoundaryGeoJson = geoJson;
  return check;
}

export function resetMedanBoundaryGeoJson() {
  activeMedanBoundaryGeoJson = null;
}

export function getActiveMedanBoundaryGeoJson() {
  return activeMedanBoundaryGeoJson;
}

function isPointOnSegment(px, py, x1, y1, x2, y2, eps = 1e-12) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const segLen = Math.hypot(dx, dy);
  if (segLen <= eps) {
    return Math.hypot(px - x1, py - y1) <= eps;
  }
  const perpDist = Math.abs((py - y1) * dx - (px - x1) * dy) / segLen;
  if (perpDist > eps) return false;
  return (
    px >= Math.min(x1, x2) - eps &&
    px <= Math.max(x1, x2) + eps &&
    py >= Math.min(y1, y2) - eps &&
    py <= Math.max(y1, y2) + eps
  );
}

function classifyPointInLinearRing(lon, lat, ring, eps = 1e-12) {
  if (!Array.isArray(ring) || ring.length < 4) return "outside";

  for (let i = 0; i < ring.length - 1; i++) {
    const ptA = ring[i];
    const ptB = ring[i + 1];
    if (!Array.isArray(ptA) || !Array.isArray(ptB)) return "outside";
    const x1 = ptA[0];
    const y1 = ptA[1];
    const x2 = ptB[0];
    const y2 = ptB[1];
    if (!isFiniteNumber(x1) || !isFiniteNumber(y1) || !isFiniteNumber(x2) || !isFiniteNumber(y2)) {
      return "outside";
    }
    if (isPointOnSegment(lon, lat, x1, y1, x2, y2, eps)) {
      return "boundary";
    }
  }

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside ? "inside" : "outside";
}

function isPointInPolygonCoords(lon, lat, polygonCoords) {
  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) return false;

  const outerStatus = classifyPointInLinearRing(lon, lat, polygonCoords[0]);
  if (outerStatus === "outside") return false;
  if (outerStatus === "boundary") return true;

  for (let r = 1; r < polygonCoords.length; r++) {
    const holeStatus = classifyPointInLinearRing(lon, lat, polygonCoords[r]);
    if (holeStatus === "inside") return false;
    if (holeStatus === "boundary") return true;
  }
  return true;
}

/**
 * Algoritma Point-in-Polygon (Ray-Casting + boundary segment check + interior holes)
 * untuk GeoJSON Polygon, MultiPolygon, GeometryCollection, Feature, atau FeatureCollection.
 */
export function isPointInGeoJson(lon, lat, geoJson) {
  if (!isValidWgs84Pair(lon, lat)) return false;
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

function resolveRequiredBoundary(options = {}) {
  const boundaryGeoJson = options.boundaryGeoJson ?? activeMedanBoundaryGeoJson;
  if (!boundaryGeoJson) {
    throw new Error(
      "Boundary administrasi Kota Medan belum dimuat; analisis point-in-polygon dibatalkan."
    );
  }
  const check = validateBoundaryGeoJson(boundaryGeoJson);
  if (!check.valid) {
    throw new Error(`Boundary administrasi Kota Medan tidak valid: ${check.errors.join("; ")}`);
  }
  return boundaryGeoJson;
}

function extractStrictGeoJsonPoint(rawGeom) {
  if (!rawGeom || typeof rawGeom !== "object" || Array.isArray(rawGeom)) {
    return { lon: null, lat: null, error: "invalid_geometry_type" };
  }
  if (rawGeom.type !== "Point") {
    return { lon: null, lat: null, error: "invalid_geometry_type" };
  }
  if (!Array.isArray(rawGeom.coordinates) || (rawGeom.coordinates.length !== 2 && rawGeom.coordinates.length !== 3)) {
    return { lon: null, lat: null, error: "malformed_coordinates" };
  }
  const [lon, lat] = rawGeom.coordinates;
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    return { lon: null, lat: null, error: "non_finite_coordinates" };
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return { lon: null, lat: null, error: "out_of_wgs84_range" };
  }
  return { lon, lat, error: null };
}

/**
 * Mengekstrak dan memvalidasi geometri GeoJSON Point menggunakan point-in-polygon
 * pada berkas boundary eksplisit Kota Medan. Melempar Error jika boundary tidak tersedia/valid.
 */
export function extractValidMedanPoint(rec, options = {}) {
  const boundaryGeoJson = resolveRequiredBoundary(options);
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;

  const rawGeom =
    rec.type === "Feature"
      ? rec.geometry
      : rec.geometry !== undefined
        ? rec.geometry
        : rec.geom;

  const { lon, lat, error } = extractStrictGeoJsonPoint(rawGeom);
  if (error !== null || lon === null || lat === null) return null;
  if (!isPointInGeoJson(lon, lat, boundaryGeoJson)) return null;

  return { type: "Point", coordinates: [lon, lat] };
}

function extractRecordFields(rawRec) {
  if (!rawRec || typeof rawRec !== "object" || Array.isArray(rawRec)) {
    return { props: null, geom: null };
  }
  if (rawRec.type === "Feature" && rawRec.properties && typeof rawRec.properties === "object") {
    const props = { ...rawRec.properties };
    if (rawRec.id !== undefined && props.incident_id === undefined) {
      props.incident_id = rawRec.id;
    }
    return { props, geom: rawRec.geometry };
  }
  const geom = rawRec.geometry !== undefined ? rawRec.geometry : rawRec.geom;
  return { props: rawRec, geom };
}

/**
 * Memvalidasi batch record input sebelum KDE secara eksplisit tanpa mengubah data mentah,
 * serta menghasilkan ringkasan total input, diterima, ditolak, dan alasan penolakan.
 */
export function validateKdeInputRecords(records = [], options = {}) {
  const boundaryGeoJson = resolveRequiredBoundary(options);
  const inputList = Array.isArray(records) ? records : [];
  const seenIds = new Set();
  const accepted = [];
  const rejected = [];
  const rejectionReasons = {};

  function addReason(reasons, code) {
    if (!reasons.includes(code)) {
      reasons.push(code);
      rejectionReasons[code] = (rejectionReasons[code] || 0) + 1;
    }
  }

  inputList.forEach((rawRec, index) => {
    const reasons = [];
    const { props, geom } = extractRecordFields(rawRec);
    if (!props) {
      addReason(reasons, "invalid_record_object");
      rejected.push({ index, incident_id: null, reasons });
      return;
    }

    const rawId = props.incident_id;
    const incidentId =
      typeof rawId === "string"
        ? rawId.trim()
        : typeof rawId === "number" && Number.isInteger(rawId)
          ? String(rawId)
          : "";

    if (!incidentId) {
      addReason(reasons, "missing_incident_id");
    } else if (seenIds.has(incidentId)) {
      addReason(reasons, "duplicate_incident_id");
    } else {
      seenIds.add(incidentId);
    }

    if (!isValidIncidentDate(props.incident_date)) {
      addReason(reasons, "invalid_incident_date");
    }

    if (isDemoFlag(props.isDemo) || isDemoFlag(props.is_demo)) {
      addReason(reasons, "demo_record_flagged");
    }

    if (isDemoLabel(props.dataLabel) || isDemoLabel(props.data_label)) {
      addReason(reasons, "demo_data_label");
    }

    const verificationStatus = String(props.verification_status ?? "").trim();
    if (verificationStatus !== "verified") {
      addReason(reasons, "invalid_verification_status");
    }

    const accuracy = String(props.location_accuracy ?? "").trim();
    if (!STRICT_KDE_ACCURACIES.includes(accuracy)) {
      addReason(reasons, "disallowed_location_accuracy");
    }

    const { lon, lat, error: geomErr } = extractStrictGeoJsonPoint(geom);
    if (geomErr !== null || lon === null || lat === null) {
      addReason(reasons, geomErr);
    } else if (!isPointInGeoJson(lon, lat, boundaryGeoJson)) {
      addReason(reasons, "outside_medan_boundary");
    }

    if (reasons.length > 0) {
      rejected.push({ index, incident_id: incidentId || null, reasons });
      return;
    }

    accepted.push(rawRec);
  });

  return {
    accepted,
    rejected,
    summary: {
      totalInput: inputList.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      pointsUsedForKde: accepted.length,
      rejectionReasons
    }
  };
}

export function isRecordKdeEligible(rec, options = {}) {
  const boundaryGeoJson = resolveRequiredBoundary(options);
  return validateKdeInputRecords([rec], { ...options, boundaryGeoJson }).accepted.length === 1;
}

export function filterKdeEligiblePoints(records = [], options = {}) {
  const boundaryGeoJson = resolveRequiredBoundary(options);
  return validateKdeInputRecords(records, { ...options, boundaryGeoJson }).accepted;
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

/**
 * Memvalidasi payload output KDE resmi (/data/hotspot-analyzer.verified.geojson).
 * Menolak output DEMO, FeatureCollection tidak valid, metadata kurang, atau kelas tidak sah.
 */
export function validateVerifiedHotspotOutput(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: ["Payload output resmi bukan objek JSON."], normalized: null };
  }

  if (payload.isDemo !== false) {
    errors.push("Payload resmi wajib memiliki isDemo === false.");
  }

  const rawDataLabel = typeof payload.dataLabel === "string" ? payload.dataLabel.trim() : "";
  if (!rawDataLabel) {
    errors.push("Payload resmi wajib memiliki dataLabel non-kosong.");
  } else if (isDemoLabel(rawDataLabel)) {
    errors.push("Payload resmi dilarang berlabel DEMO.");
  }

  const featureCollection =
    payload.type === "FeatureCollection"
      ? payload
      : payload.zones && typeof payload.zones === "object"
        ? payload.zones
        : null;

  if (
    !featureCollection ||
    featureCollection.type !== "FeatureCollection" ||
    !Array.isArray(featureCollection.features)
  ) {
    errors.push("Output resmi wajib berupa GeoJSON FeatureCollection.");
  } else if (featureCollection.features.length === 0) {
    errors.push("FeatureCollection output resmi tidak boleh kosong.");
  }

  const analysis =
    payload.analysis && typeof payload.analysis === "object"
      ? payload.analysis
      : payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : null;

  if (!analysis) {
    errors.push("Metadata analisis KDE wajib tersedia.");
  } else {
    for (const key of ["source", "period_label", "kernel_method", "working_crs", "classification_method"]) {
      const val = typeof analysis[key] === "string" ? analysis[key].trim() : "";
      if (!val) {
        errors.push(`Metadata analysis.${key} wajib berupa teks non-kosong.`);
      } else if ((key === "source" || key === "period_label") && isDemoLabel(val)) {
        errors.push(`Metadata analysis.${key} tidak boleh berlabel DEMO.`);
      }
    }
    for (const numKey of ["bandwidth_meters", "pixel_size_meters"]) {
      if (!isFiniteNumber(analysis[numKey]) || analysis[numKey] <= 0) {
        errors.push(`Metadata analysis.${numKey} wajib angka positif.`);
      }
    }
    if (!Number.isInteger(analysis.incident_count_used) || analysis.incident_count_used < 1) {
      errors.push("Metadata analysis.incident_count_used wajib bilangan bulat >= 1.");
    }
  }

  const normalizedZones = [];
  const rawFeatures = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
  rawFeatures.forEach((feature, index) => {
    if (!feature || typeof feature !== "object" || feature.type !== "Feature") {
      errors.push(`features[${index}] bukan GeoJSON Feature.`);
      return;
    }

    const geomCheck = validateBoundaryGeoJson(feature.geometry);
    if (!geomCheck.valid) {
      errors.push(`features[${index}].geometry tidak valid: ${geomCheck.errors.join("; ")}`);
    }

    const props = feature.properties;
    if (!props || typeof props !== "object" || Array.isArray(props)) {
      errors.push(`features[${index}].properties wajib berupa objek.`);
      return;
    }

    if (isDemoFlag(props.isDemo) || isDemoFlag(props.is_demo)) {
      errors.push(`features[${index}] memiliki flag isDemo=true.`);
    }

    if (isDemoLabel(props.dataLabel) || isDemoLabel(props.data_label)) {
      errors.push(`features[${index}] memiliki dataLabel DEMO.`);
    }

    const zoneId = typeof props.zone_id === "string" ? props.zone_id.trim() : "";
    if (!zoneId) {
      errors.push(`features[${index}].properties.zone_id wajib non-kosong.`);
    }

    const rawDensityClass = String(props.density_class ?? "").trim();
    if (isDemoLabel(rawDensityClass)) {
      errors.push(`features[${index}].properties.density_class mengandung label DEMO.`);
    }

    const rankIsValidInt = Number.isInteger(props.density_rank) && props.density_rank >= 1 && props.density_rank <= 4;
    if (!rankIsValidInt) {
      errors.push(`features[${index}].properties.density_rank wajib integer 1..4.`);
    }

    const tierMeta = getHotspotTierMeta(props.density_rank, rawDensityClass);
    if (!tierMeta.isValid || tierMeta.hasConflict || !rawDensityClass) {
      errors.push(
        `features[${index}] kelas kepadatan tidak valid atau bertentangan (${props.density_rank} / "${rawDensityClass}").`
      );
    }

    if (!isFiniteNumber(props.area_km2) || props.area_km2 < 0) {
      errors.push(`features[${index}].properties.area_km2 wajib angka >= 0.`);
    }

    if (errors.length === 0) {
      normalizedZones.push({
        zone_id: zoneId,
        density_class: rawDensityClass,
        density_rank: tierMeta.rank,
        area_km2: Number(props.area_km2),
        isDemo: false,
        dataLabel: rawDataLabel,
        tierMeta,
        feature
      });
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: {
      isDemo: false,
      dataLabel: rawDataLabel,
      notice: String(
        payload.notice ||
          "Hasil analisis Kernel Density Estimation (KDE) historis berbasis titik kebakaran terverifikasi Kota Medan. Bukan prediksi kejadian masa depan."
      ),
      analysis,
      zones: normalizedZones,
      zonesGeoJson: {
        type: "FeatureCollection",
        crs: featureCollection.crs || { type: "name", properties: { name: "EPSG:4326" } },
        features: normalizedZones.map((z) => z.feature)
      }
    }
  };
}

export async function loadHotspotZones(services, options = {}) {
  if (!services?.dataStatus?.fetchJson) {
    throw new Error("Layanan data Fire Hotspot Analyzer tidak tersedia.");
  }

  let districtsGeoJson = null;
  let boundaryValid = false;
  let boundaryError = null;
  let shouldCheckVerified = options.forceVerifiedFetch === true;

  if (services.dataStatus.getManifest && options.forceVerifiedFetch !== true) {
    try {
      const manifestResp = await services.dataStatus.getManifest();
      const hotspotMeta = manifestResp?.manifest?.verified_outputs?.["hotspot-analyzer"];
      const metaStatus = String(hotspotMeta?.status || "").toLowerCase();
      if (!hotspotMeta || (hotspotMeta.available !== false && !metaStatus.startsWith("exploratory"))) {
        shouldCheckVerified = true;
      }
    } catch {
      shouldCheckVerified = true;
    }
  } else if (!services.dataStatus.getManifest && options.forceVerifiedFetch !== true) {
    shouldCheckVerified = true;
  }

  try {
    districtsGeoJson = await services.dataStatus.fetchJson("medan_districts_osm.geojson");
    if (districtsGeoJson) {
      const check = setMedanBoundaryGeoJson(districtsGeoJson);
      boundaryValid = check.valid;
    }
  } catch (err) {
    districtsGeoJson = null;
    boundaryValid = false;
    boundaryError = err?.message || "Berkas batas administrasi OSM gagal dimuat atau tidak valid.";
  }

  let verifiedLoadStatus = "unavailable";
  let verifiedValidationErrors = [];

  if (shouldCheckVerified) {
    try {
      const verifiedPayload = await services.dataStatus.fetchJson("hotspot-analyzer.verified.geojson");
      const validation = validateVerifiedHotspotOutput(verifiedPayload);
      if (validation.valid && validation.normalized) {
        return {
          ...validation.normalized,
          sourceMode: "verified",
          verifiedLoadStatus: "loaded",
          verifiedValidationErrors: [],
          usedFallback: false,
          fixturePath: VERIFIED_HOTSPOT_OUTPUT_URL,
          boundaryProvenance: BOUNDARY_PROVENANCE,
          boundaryValid,
          boundaryError,
          invalidZones: [],
          districtsGeoJson
        };
      }
      verifiedLoadStatus = "rejected";
      verifiedValidationErrors = validation.errors;
    } catch (err) {
      verifiedLoadStatus = "unavailable";
      verifiedValidationErrors = [err?.message || "Output KDE resmi belum tersedia."];
    }
  }

  if (options.forceVerifiedFetch === true && verifiedLoadStatus === "rejected") {
    throw new Error(
      `Output KDE terverifikasi ditolak validasi: ${verifiedValidationErrors.slice(0, 3).join("; ")}`
    );
  }

  const exploratoryPayload = await services.dataStatus.fetchJson("hotspot-analyzer.exploratory.geojson");
  const exploratoryCheck = validateVerifiedHotspotOutput(exploratoryPayload);
  if (!exploratoryCheck.valid || !exploratoryCheck.normalized) {
    throw new Error(
      `Output KDE eksploratif tidak valid (${exploratoryCheck.errors.slice(0, 3).join("; ")}).`
    );
  }

  return {
    ...exploratoryCheck.normalized,
    sourceMode: "exploratory",
    verifiedLoadStatus,
    verifiedValidationErrors,
    usedFallback: false,
    fixturePath: EXPLORATORY_HOTSPOT_OUTPUT_URL,
    boundaryProvenance: BOUNDARY_PROVENANCE,
    boundaryValid,
    boundaryError,
    invalidZones: [],
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
