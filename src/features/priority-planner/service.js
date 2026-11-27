// Service & metodologi skoring multi-kriteria untuk Fire Service Priority Planner (Olo)

export const EXPECTED_AREA_CODES = Object.freeze(
  Array.from({ length: 21 }, (_, idx) => `12.71.${String(idx + 1).padStart(2, "0")}`)
);

export const DEFAULT_PRIORITY_WEIGHTS = Object.freeze({
  hotspot_intensity: 0.4,
  coverage_gap: 0.35,
  population_exposure: 0.25
});

export const PROVISIONAL_PRIORITY_URL = "/data/priority-planner.provisional.json";

export const PRIORITY_TIER_CONFIG = Object.freeze({
  Rendah: Object.freeze({ rank: 1, label: "Rendah", fillColor: "#E9C46A", strokeColor: "#9E7E2E" }),
  Sedang: Object.freeze({ rank: 2, label: "Sedang", fillColor: "#E79E4F", strokeColor: "#A6631B" }),
  Tinggi: Object.freeze({ rank: 3, label: "Tinggi", fillColor: "#C8523B", strokeColor: "#852D1C" }),
  "Sangat Tinggi": Object.freeze({ rank: 4, label: "Sangat Tinggi", fillColor: "#7F1D1D", strokeColor: "#450A0A" })
});

function isFiniteNumber(val) {
  return typeof val === "number" && Number.isFinite(val);
}

function normalizeLabel(val) {
  if (val === null || val === undefined) return "";
  return String(val).trim().replace(/\s+/g, " ").toUpperCase();
}

export function validateWeights(weights) {
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    throw new Error("Bobot simulasi harus berupa objek.");
  }
  const keys = ["hotspot_intensity", "coverage_gap", "population_exposure"];
  const parsed = {};
  let sum = 0;
  for (const k of keys) {
    const v = Number(weights[k]);
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`Bobot '${k}' wajib berupa angka >= 0.`);
    }
    parsed[k] = v;
    sum += v;
  }
  if (Math.abs(sum - 1.0) > 1e-4) {
    throw new Error(`Total bobot wajib 100% (1.00), saat ini ${(sum * 100).toFixed(1)}%.`);
  }
  return parsed;
}

function computeQuantile(sortedVals, q) {
  if (!sortedVals.length) return 0;
  const pos = q * (sortedVals.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedVals[lo];
  return sortedVals[lo] + (pos - lo) * (sortedVals[hi] - sortedVals[lo]);
}

export function minMaxNormalize(valuesByCode) {
  if (!valuesByCode || typeof valuesByCode !== "object") {
    throw new Error("Objek nilai indikator tidak valid.");
  }
  const entries = Object.entries(valuesByCode);
  if (!entries.length) {
    throw new Error("Tidak ada nilai indikator untuk dinormalisasi.");
  }
  const parsed = {};
  for (const [code, raw] of entries) {
    if (raw === null || raw === undefined || !isFiniteNumber(raw)) {
      throw new Error(`Nilai indikator untuk ${code} kosong/tidak valid; tidak boleh dianggap nol.`);
    }
    parsed[code] = raw;
  }
  const vals = Object.values(parsed).sort((a, b) => a - b);
  const minVal = vals[0];
  const maxVal = vals[vals.length - 1];
  const span = maxVal - minVal;
  const scores = {};
  for (const [code, val] of Object.entries(parsed)) {
    scores[code] =
      Math.abs(span) <= 1e-12
        ? 0.5
        : Number(Math.max(0, Math.min(1, (val - minVal) / span)).toFixed(6));
  }
  return { min: minVal, max: maxVal, isConstant: Math.abs(span) <= 1e-12, scores };
}

export function validateDistrictJoin({
  fireDistricts = [],
  populationRows = [],
  boundaryGeoJson = null,
  coverageRows = null
}) {
  function indexRows(list, sourceName) {
    const map = new Map();
    const duplicates = [];
    for (const row of list || []) {
      const code = String(row?.area_code || "").trim();
      if (!code) throw new Error(`Baris tanpa area_code pada ${sourceName}.`);
      if (map.has(code)) duplicates.push(code);
      else map.set(code, row);
    }
    if (duplicates.length > 0) {
      throw new Error(`Kode area ganda pada ${sourceName}: ${[...new Set(duplicates)].join(", ")}.`);
    }
    const missing = EXPECTED_AREA_CODES.filter((c) => !map.has(c));
    if (missing.length > 0) {
      throw new Error(`Kecamatan hilang pada ${sourceName}: ${missing.join(", ")}.`);
    }
    return map;
  }

  const fireMap = indexRows(fireDistricts, "fire_districts_2023");
  const popMap = indexRows(populationRows, "population_2025");
  if (boundaryGeoJson) {
    const bRows = (boundaryGeoJson.features || []).map((f) => f.properties || {});
    indexRows(bRows, "medan_districts_osm");
  }

  let covMap = null;
  let coverageAvailable = false;
  if (Array.isArray(coverageRows) && coverageRows.length > 0) {
    covMap = indexRows(coverageRows, "station_coverage");
    coverageAvailable = EXPECTED_AREA_CODES.every((c) =>
      isFiniteNumber(covMap.get(c)?.network_5km_gap_ratio)
    );
  }

  const rows = EXPECTED_AREA_CODES.map((code) => {
    const f = fireMap.get(code);
    const p = popMap.get(code);
    const inc = f.total_incidents;
    const pop = p.population_2025_bps ?? p.population_2025;
    const dens = p.density_km2_2025_bps ?? p.density_km2_2025;
    if (!isFiniteNumber(inc) || inc < 0) {
      throw new Error(`Nilai incidents_2023 tidak valid pada ${code}.`);
    }
    if (!isFiniteNumber(pop) || pop <= 0) {
      throw new Error(`Nilai population_2025 tidak valid pada ${code}.`);
    }
    if (!isFiniteNumber(dens) || dens <= 0) {
      throw new Error(`Nilai density_km2_2025 tidak valid pada ${code}.`);
    }
    const cov = covMap ? covMap.get(code) : null;
    return {
      area_code: code,
      area_name: String(f.district_name || p.district_name || code).trim(),
      incidents_2023: inc,
      population_2025: pop,
      density_km2_2025: dens,
      network_5km_gap_ratio: coverageAvailable ? Number(cov.network_5km_gap_ratio) : null,
      network_5km_coverage_pct: coverageAvailable ? Number(cov.network_5km_coverage_pct) : null
    };
  });

  return { rows, coverageAvailable };
}

export function recalculatePriorityScores(zones = [], weights = DEFAULT_PRIORITY_WEIGHTS) {
  const validWeights = validateWeights(weights);
  if (!Array.isArray(zones) || zones.length === 0) return [];

  const allHaveCoverage = zones.every((z) => isFiniteNumber(z.coverage_gap_score));
  if (!allHaveCoverage) {
    return zones.map((z) => ({
      ...z,
      composite_score: null,
      priority_rank: null,
      priority_tier: "Parsial (Data Jangkauan Belum Tersedia)",
      priority_reason:
        "Skor gabungan belum dihitung karena coverage_gap_score belum tersedia secara lengkap (nilai tidak dikarang)."
    }));
  }

  const updated = zones.map((z) => {
    const h = Number(z.hotspot_score);
    const c = Number(z.coverage_gap_score);
    const p = Number(z.population_exposure_score);
    const comp = Number(
      Math.max(
        0,
        Math.min(
          1,
          validWeights.hotspot_intensity * h +
            validWeights.coverage_gap * c +
            validWeights.population_exposure * p
        )
      ).toFixed(6)
    );
    return { ...z, composite_score: comp };
  });

  const sortedVals = updated.map((z) => z.composite_score).sort((a, b) => a - b);
  const q25 = computeQuantile(sortedVals, 0.25);
  const q50 = computeQuantile(sortedVals, 0.5);
  const q75 = computeQuantile(sortedVals, 0.75);

  updated.sort((a, b) => b.composite_score - a.composite_score || String(a.area_code).localeCompare(String(b.area_code)));
  return updated.map((z, idx) => {
    let tier = "Rendah";
    if (z.composite_score > q75) tier = "Sangat Tinggi";
    else if (z.composite_score > q50) tier = "Tinggi";
    else if (z.composite_score > q25) tier = "Sedang";
    return {
      ...z,
      priority_rank: idx + 1,
      priority_tier: tier
    };
  });
}

export function validatePriorityOutput(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: ["Payload priority-planner bukan objek JSON."] };
  }
  if (payload.isDemo !== false) {
    errors.push("Output priority-planner resmi/provisional wajib memiliki isDemo === false.");
  }
  const label = normalizeLabel(payload.dataLabel);
  if (!label || /\bDEMO\b/.test(label)) {
    errors.push("dataLabel tidak boleh kosong atau DEMO.");
  }

  const analysis = payload.analysis;
  const requiredMeta = [
    "period_label",
    "sources",
    "weights",
    "normalization_method",
    "composite_formula",
    "data_status",
    "limitations",
    "method_version"
  ];
  if (!analysis || typeof analysis !== "object") {
    errors.push("Metadata analysis wajib tersedia.");
  } else {
    for (const k of requiredMeta) {
      if (!analysis[k]) errors.push(`Metadata analysis.${k} wajib tersedia.`);
    }
    try {
      validateWeights(analysis.weights);
    } catch (err) {
      errors.push(err.message);
    }
  }

  const zones = payload.zones;
  if (!Array.isArray(zones) || zones.length !== 21) {
    errors.push("zones wajib memuat tepat 21 kecamatan.");
  } else {
    const codes = new Set();
    const requiredFields = [
      "area_code",
      "area_name",
      "incidents_2023",
      "population_2025",
      "density_km2_2025",
      "hotspot_score",
      "coverage_gap_score",
      "population_exposure_score",
      "composite_score",
      "priority_tier",
      "priority_reason",
      "isDemo",
      "dataLabel"
    ];
    zones.forEach((z, idx) => {
      for (const f of requiredFields) {
        if (!(f in (z || {}))) errors.push(`zones[${idx}] kekurangan field '${f}'.`);
      }
      codes.add(z?.area_code);
      if (z?.isDemo !== false || /\bDEMO\b/.test(normalizeLabel(z?.dataLabel))) {
        errors.push(`zones[${idx}] masih berlabel DEMO.`);
      }
      for (const sKey of ["hotspot_score", "coverage_gap_score", "population_exposure_score", "composite_score"]) {
        const val = z?.[sKey];
        if (val !== null && (!isFiniteNumber(val) || val < 0 || val > 1)) {
          errors.push(`zones[${idx}].${sKey} di luar rentang 0..1.`);
        }
      }
    });
    if (EXPECTED_AREA_CODES.some((c) => !codes.has(c))) {
      errors.push("Kode area kecamatan tidak lengkap (12.71.01..12.71.21).");
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function loadPriorityPlannerData(services, options = {}) {
  if (!services?.dataStatus?.fetchJson) {
    throw new Error("Layanan data Fire Service Priority Planner tidak tersedia.");
  }

  let districtsGeoJson = null;
  let shouldCheckProvisional = true;

  if (services.dataStatus.getManifest && options.forceProvisionalFetch !== true) {
    try {
      const resp = await services.dataStatus.getManifest();
      const meta = resp?.manifest?.verified_outputs?.["priority-planner"];
      if (meta && meta.available === false) {
        shouldCheckProvisional = false;
      }
    } catch {
      shouldCheckProvisional = true;
    }
  }

  if (!shouldCheckProvisional) {
    throw new Error("Output prioritas layanan 21 kecamatan belum ditandai tersedia di manifest.");
  }

  try {
    districtsGeoJson = await services.dataStatus.fetchJson("medan_districts_osm.geojson");
  } catch {
    districtsGeoJson = null;
  }

  const provPayload = await services.dataStatus.fetchJson("priority-planner.provisional.json");
  const check = validatePriorityOutput(provPayload);
  if (!check.valid) {
    throw new Error(
      `Berkas /data/priority-planner.provisional.json gagal validasi kontrak (${check.errors.slice(0, 3).join("; ")}).`
    );
  }

  return {
    isDemo: false,
    dataLabel: String(provPayload.dataLabel),
    sourceMode: "provisional",
    provisionalLoadStatus: "loaded",
    provisionalValidationErrors: [],
    usedFallback: false,
    fixturePath: PROVISIONAL_PRIORITY_URL,
    notice: String(provPayload.notice),
    analysis: provPayload.analysis,
    zones: provPayload.zones,
    zonesMultiStation: Array.isArray(provPayload.zones_multi_station) ? provPayload.zones_multi_station : null,
    districtsGeoJson
  };
}

export function filterPriorityZones(zones = [], { tier = "semua", search = "" } = {}) {
  const q = String(search || "").trim().toLowerCase();
  return (zones || []).filter((z) => {
    if (tier !== "semua" && z.priority_tier !== tier) return false;
    if (q) {
      const hay = `${z.area_code} ${z.area_name} ${z.priority_tier} ${z.priority_reason}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
