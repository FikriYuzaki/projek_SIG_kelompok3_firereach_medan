export const MEDAN_BOUNDS = Object.freeze({
  minLat: 3.45,
  maxLat: 3.85,
  minLon: 98.55,
  maxLon: 98.78
});

export const LOCATION_ACCURACY_VALUES = Object.freeze([
  "exact_verified",
  "address_geocoded_verified",
  "approximate",
  "district_only",
  "unknown"
]);

export const VERIFICATION_STATUS_VALUES = Object.freeze(["verified", "needs_review", "unlocated"]);

export const POINT_MAPPABLE_ACCURACIES = Object.freeze([
  "exact_verified",
  "address_geocoded_verified",
  "approximate"
]);

export const SUPABASE_INCIDENT_COLUMNS =
  "id,source_record_id,occurred_at,period_year,period_month,address_text,district_name,subdistrict_name,object_type,cause_category,location_accuracy,verification_status,source_name,source_url,geom";

export const CATEGORY_LABELS = Object.freeze({
  semua: "Semua Kategori Objek",
  rumah: "Rumah Tinggal",
  ruko: "Ruko / Komersial",
  travo_kabel: "Travo / Kabel Listrik",
  gudang_pabrik: "Gudang / Pabrik",
  kendaraan: "Kendaraan / Transportasi",
  lahan: "Lahan / Vegetasi",
  fasilitas_umum: "Fasilitas Umum",
  lain_lain: "Lain-Lain (Gas, Sampah, Pohon)"
});

export function normalizeDistrictName(name) {
  if (typeof name !== "string") return "";
  const cleaned = name.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function parseFiniteCoord(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function isInsideMedanExtent(lat, lon) {
  return (
    lat >= MEDAN_BOUNDS.minLat &&
    lat <= MEDAN_BOUNDS.maxLat &&
    lon >= MEDAN_BOUNDS.minLon &&
    lon <= MEDAN_BOUNDS.maxLon
  );
}

/**
 * Extracts validated [lon, lat] GeoJSON point coordinates only when accuracy allows point display
 * and coordinates fall strictly inside Kota Medan bounds.
 */
export function extractValidPointCoordinates(record = {}) {
  const acc = String(record.location_accuracy || "unknown");
  if (!POINT_MAPPABLE_ACCURACIES.includes(acc)) {
    return null;
  }

  let lat = parseFiniteCoord(record.lat);
  let lon = parseFiniteCoord(record.lon);

  if ((lat === null || lon === null) && record.geom && typeof record.geom === "object") {
    if (record.geom.type === "Point" && Array.isArray(record.geom.coordinates) && record.geom.coordinates.length >= 2) {
      lon = parseFiniteCoord(record.geom.coordinates[0]);
      lat = parseFiniteCoord(record.geom.coordinates[1]);
    }
  } else if ((lat === null || lon === null) && typeof record.geom === "string") {
    const match = /^POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$/i.exec(record.geom.trim());
    if (match) {
      lon = parseFiniteCoord(match[1]);
      lat = parseFiniteCoord(match[2]);
    }
  }

  if (lat === null || lon === null || !isInsideMedanExtent(lat, lon)) {
    return null;
  }

  return {
    lat,
    lon,
    geom: { type: "Point", coordinates: [lon, lat] }
  };
}

export function normalizeIncidentRecord(raw = {}) {
  const accuracy = LOCATION_ACCURACY_VALUES.includes(raw.location_accuracy)
    ? raw.location_accuracy
    : "unknown";
  const coords = extractValidPointCoordinates({ ...raw, location_accuracy: accuracy });
  let status = VERIFICATION_STATUS_VALUES.includes(raw.verification_status)
    ? raw.verification_status
    : "unlocated";

  // Enforce data honesty: rows without verified/bounded geometry cannot stay marked "verified"
  if (!coords) {
    if (status === "verified") {
      status = accuracy === "district_only" ? "needs_review" : "unlocated";
    }
    if (accuracy === "unknown") {
      status = "unlocated";
    }
  }

  const isDemo = Boolean(raw.isDemo);
  const district = normalizeDistrictName(raw.district_name || "") || null;
  const subdistrict = normalizeDistrictName(raw.subdistrict_name || "") || null;

  return {
    id: raw.id || raw.source_record_id || null,
    source_record_id: String(raw.source_record_id || raw.id || "UNKNOWN"),
    occurred_at: raw.occurred_at || null,
    period_year: raw.period_year !== undefined && raw.period_year !== null ? Number(raw.period_year) : null,
    period_month: raw.period_month !== undefined && raw.period_month !== null ? Number(raw.period_month) : null,
    address_text: raw.address_text ? String(raw.address_text).trim() : null,
    district_name: district,
    subdistrict_name: subdistrict,
    object_type: raw.object_type ? String(raw.object_type).trim() : null,
    cause_category: raw.cause_category ? String(raw.cause_category).trim() : null,
    location_accuracy: accuracy,
    verification_status: status,
    source_name: String(raw.source_name || "Sumber Tidak Tercatat"),
    source_url: String(raw.source_url || ""),
    geom: coords ? coords.geom : null,
    lat: coords ? coords.lat : null,
    lon: coords ? coords.lon : null,
    isDemo,
    kde_eligible: Boolean(coords && POINT_MAPPABLE_ACCURACIES.includes(accuracy) && status === "verified" && !isDemo)
  };
}

export function partitionIncidentRecords(records = []) {
  const verifiedLocated = [];
  const needsReview = [];
  const unlocated = [];
  const demoRecords = [];
  const kdeEligible = [];

  for (const item of records) {
    const rec = normalizeIncidentRecord(item);
    if (rec.isDemo) {
      demoRecords.push(rec);
      continue;
    }
    if (rec.geom !== null && rec.verification_status === "verified") {
      verifiedLocated.push(rec);
      if (rec.kde_eligible) {
        kdeEligible.push(rec);
      }
    } else if (rec.verification_status === "needs_review") {
      needsReview.push(rec);
    } else {
      unlocated.push(rec);
    }
  }

  return { verifiedLocated, needsReview, unlocated, demoRecords, kdeEligible };
}

export function computeChoroplethBreaks(values = []) {
  const valid = values.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0);
  const max = valid.length ? Math.max(...valid) : 0;

  if (max <= 0) {
    return {
      max: 0,
      lowMax: 0,
      midMax: 0,
      hasNonZero: false,
      zeroLabel: "0 kejadian",
      lowLabel: null,
      midLabel: null,
      highLabel: null
    };
  }

  if (max === 1) {
    return {
      max: 1,
      lowMax: 0,
      midMax: 0,
      hasNonZero: true,
      zeroLabel: "0",
      lowLabel: null,
      midLabel: null,
      highLabel: "1"
    };
  }

  if (max === 2) {
    return {
      max: 2,
      lowMax: 1,
      midMax: 1,
      hasNonZero: true,
      zeroLabel: "0",
      lowLabel: "1",
      midLabel: null,
      highLabel: "2"
    };
  }

  const lowMax = max <= 5 ? 1 : Math.max(1, Math.floor(max * 0.35));
  const midMax = max <= 5 ? max - 1 : Math.min(max - 1, Math.max(lowMax + 1, Math.floor(max * 0.7)));

  return {
    max,
    lowMax,
    midMax,
    hasNonZero: true,
    zeroLabel: "0",
    lowLabel: lowMax === 1 ? "1" : `1 - ${lowMax}`,
    midLabel: midMax <= lowMax + 1 ? `${lowMax + 1}` : `${lowMax + 1} - ${midMax}`,
    highLabel: `>= ${midMax + 1}`
  };
}

export function classifyChoroplethTier(count, breaks) {
  const num = Number(count || 0);
  if (num <= 0 || !breaks?.hasNonZero) return "zero";
  if (breaks.highLabel && num > breaks.midMax) return "high";
  if (breaks.midLabel && num > breaks.lowMax) return "mid";
  return "low";
}

export function getDominantCategory(categoriesObj = {}) {
  let topKey = "umum";
  let topVal = -1;
  for (const [key, val] of Object.entries(categoriesObj)) {
    if (Number(val) > topVal) {
      topVal = Number(val);
      topKey = key;
    }
  }
  return { key: topKey, count: Math.max(0, topVal) };
}

export async function fetchSupabaseIncidents(supabaseService) {
  if (!supabaseService?.isConfigured || !supabaseService?.client) {
    return {
      active: false,
      source: "local",
      records: [],
      partitioned: partitionIncidentRecords([]),
      error: null,
      note: supabaseService?.note || "Mode Lokal aktif tanpa konfigurasi Supabase."
    };
  }

  try {
    const { data, error } = await supabaseService.client
      .from("fire_incidents")
      .select(SUPABASE_INCIDENT_COLUMNS)
      .order("occurred_at", { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(error.message || "Gagal membaca tabel public.fire_incidents.");
    }

    const normalized = Array.isArray(data) ? data.map((row) => normalizeIncidentRecord(row)) : [];
    const partitioned = partitionIncidentRecords(normalized);
    return {
      active: true,
      source: "supabase",
      records: normalized,
      partitioned,
      error: null,
      note: `Terhubung ke Supabase (${normalized.length} record individual pada public.fire_incidents).`
    };
  } catch (err) {
    const message = err?.message || "Koneksi Supabase gagal; memakai arsip lokal terverifikasi.";
    return {
      active: false,
      source: "local_fallback",
      records: [],
      partitioned: partitionIncidentRecords([]),
      error: message,
      note: `Fallback ke mode lokal: ${message}`
    };
  }
}

export async function loadExplorerDatasets(services) {
  const [summary, districtsGeoJson, supabaseStatus] = await Promise.all([
    services.dataStatus.fetchJson("fire_incidents_summary.json"),
    services.dataStatus.fetchJson("medan_districts_osm.geojson"),
    fetchSupabaseIncidents(services.supabase)
  ]);

  return {
    summary,
    districtsGeoJson,
    supabaseStatus
  };
}

export async function loadDemoContractFixture(services) {
  return services.dataStatus.fetchJson("demo/incident-explorer-sample.demo.json");
}

function getSourceRowsForPeriod(summary, period) {
  if (period === "2023-kecamatan") return summary.district_2023 || [];
  if (period === "2023-dampak") return summary.monthly_2023_impact || [];
  if (period === "2024-bulanan") return summary.monthly_2024 || [];
  if (period === "2025-bulanan") return summary.monthly_2025 || [];
  if (period === "2016-2025-tahunan") return summary.annual_series || [];
  return summary.district_2023 || [];
}

export function filterOfficialRows({
  summary,
  period = "2023-kecamatan",
  district = "semua",
  category = "semua",
  search = "",
  sortBy = "default",
  excludeZero = false
}) {
  const query = String(search || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isDistrictPeriod = period === "2023-kecamatan";
  const hasCategories =
    period === "2023-kecamatan" || period === "2024-bulanan" || period === "2025-bulanan";
  const sourceRows = getSourceRowsForPeriod(summary || {}, period);

  const filtered = [];
  for (const row of sourceRows) {
    const districtLabel = row.district_name ? normalizeDistrictName(row.district_name) : "";
    if (isDistrictPeriod && district !== "semua" && districtLabel !== normalizeDistrictName(district)) {
      continue;
    }

    const displayLabel = isDistrictPeriod
      ? districtLabel
      : period === "2016-2025-tahunan"
        ? String(row.year)
        : row.month_name;

    const searchTarget = [displayLabel, row.area_code || "", row.source_name || "", row.source_file || ""]
      .join(" ")
      .toLowerCase();
    if (query && !searchTarget.includes(query)) {
      continue;
    }

    const activeCount =
      hasCategories && category !== "semua"
        ? Number(row.categories?.[category] || 0)
        : Number(row.total_incidents || 0);

    if (excludeZero && activeCount === 0) {
      continue;
    }

    filtered.push({
      ...row,
      ...(isDistrictPeriod ? { district_name: districtLabel } : {}),
      displayLabel,
      filteredCount: activeCount
    });
  }

  if (sortBy === "desc") {
    filtered.sort((a, b) => b.filteredCount - a.filteredCount || a.displayLabel.localeCompare(b.displayLabel, "id"));
  } else if (sortBy === "asc") {
    filtered.sort((a, b) => a.filteredCount - b.filteredCount || a.displayLabel.localeCompare(b.displayLabel, "id"));
  } else if (sortBy === "name") {
    filtered.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel, "id"));
  }

  return filtered;
}

export function filterDemoRecords(records = [], { district = "semua", search = "", statusFilter = "semua" } = {}) {
  const query = String(search || "").replace(/\s+/g, " ").trim().toLowerCase();
  const targetDistrict = district !== "semua" ? normalizeDistrictName(district) : "semua";

  return records
    .map((item) => normalizeIncidentRecord({ ...item, isDemo: true }))
    .filter((rec) => {
      if (targetDistrict !== "semua" && rec.district_name !== targetDistrict) return false;
      if (statusFilter !== "semua" && rec.verification_status !== statusFilter) return false;
      if (!query) return true;
      const hay = [
        rec.source_record_id,
        rec.district_name || "",
        rec.address_text || "",
        rec.object_type || "",
        rec.location_accuracy
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
}
