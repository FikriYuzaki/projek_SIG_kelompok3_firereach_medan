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

export const STRICT_KDE_ACCURACIES = Object.freeze([
  "exact_verified",
  "address_geocoded_verified"
]);

export const SUPABASE_PAGE_SIZE = 500;
export const SUPABASE_MAX_RECORDS = 5000;
export const SUPABASE_MAX_PAGES = 20;

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
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function isInsideMedanExtent(lat, lon) {
  return (
    lat >= MEDAN_BOUNDS.minLat &&
    lat <= MEDAN_BOUNDS.maxLat &&
    lon >= MEDAN_BOUNDS.minLon &&
    lon <= MEDAN_BOUNDS.maxLon
  );
}

function extractPointFromGeom(geom) {
  if (!geom) return null;
  let lat = null;
  let lon = null;

  if (typeof geom === "object" && !Array.isArray(geom)) {
    if (geom.type !== "Point" || !Array.isArray(geom.coordinates)) {
      return null;
    }
    if (geom.coordinates.length < 2 || geom.coordinates.length > 3) {
      return null;
    }
    lon = parseFiniteCoord(geom.coordinates[0]);
    lat = parseFiniteCoord(geom.coordinates[1]);
    if (geom.coordinates.length === 3 && parseFiniteCoord(geom.coordinates[2]) === null) {
      return null;
    }
  } else if (typeof geom === "string") {
    const match = /^POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$/i.exec(geom.trim());
    if (!match) {
      return null;
    }
    lon = parseFiniteCoord(match[1]);
    lat = parseFiniteCoord(match[2]);
  } else {
    return null;
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

/**
 * Extracts validated [lon, lat] GeoJSON point coordinates only when accuracy allows point display
 * and coordinates fall strictly inside Kota Medan bounds.
 */
export function extractValidPointCoordinates(record = {}) {
  const acc = String(record.location_accuracy || "unknown");
  if (!POINT_MAPPABLE_ACCURACIES.includes(acc)) {
    return null;
  }

  const lat = parseFiniteCoord(record.lat);
  const lon = parseFiniteCoord(record.lon);

  if (lat === null || lon === null) {
    return extractPointFromGeom(record.geom);
  }

  if (!isInsideMedanExtent(lat, lon)) {
    return null;
  }

  return {
    lat,
    lon,
    geom: { type: "Point", coordinates: [lon, lat] }
  };
}

function isDemoRecord(record) {
  if (!record || typeof record !== "object") return false;
  return Boolean(record.isDemo) || String(record.dataLabel || "").trim().toUpperCase() === "DEMO";
}

/**
 * Enforces docs/GIS_WORKFLOW.md & Adeptri KDE rules:
 * Only exact_verified and address_geocoded_verified verified records with a valid Point geometry
 * inside MEDAN_BOUNDS qualify for KDE by default.
 * Approximate points require explicit boolean approval + non-empty string reason to qualify for KDE.
 */
export function isRecordKdeEligible(record = {}, options = {}) {
  const { includeApprovedApproximate = false, approximateApprovalNote = "" } = options || {};
  if (!record || typeof record !== "object" || isDemoRecord(record) || record.verification_status !== "verified") {
    return false;
  }
  if (!extractPointFromGeom(record.geom)) {
    return false;
  }
  const accuracy = String(record.location_accuracy || "unknown");
  if (STRICT_KDE_ACCURACIES.includes(accuracy)) {
    return true;
  }
  if (accuracy === "approximate") {
    return (
      includeApprovedApproximate === true &&
      typeof approximateApprovalNote === "string" &&
      approximateApprovalNote.trim().length > 0
    );
  }
  return false;
}

export function normalizeIncidentRecord(raw = {}, kdeOptions = {}) {
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

  const isDemo = isDemoRecord(raw);
  const district = normalizeDistrictName(raw.district_name || "") || null;
  const subdistrict = normalizeDistrictName(raw.subdistrict_name || "") || null;
  const geom = coords ? coords.geom : null;

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
    geom,
    lat: coords ? coords.lat : null,
    lon: coords ? coords.lon : null,
    isDemo,
    map_point_eligible: Boolean(geom && POINT_MAPPABLE_ACCURACIES.includes(accuracy)),
    kde_eligible: isRecordKdeEligible(
      {
        location_accuracy: accuracy,
        verification_status: status,
        geom,
        isDemo,
        dataLabel: isDemo ? "DEMO" : raw.dataLabel
      },
      kdeOptions
    )
  };
}

export function partitionIncidentRecords(records = [], kdeOptions = {}) {
  const verifiedLocated = [];
  const needsReview = [];
  const unlocated = [];
  const demoRecords = [];
  const kdeEligible = [];

  for (const item of records) {
    const rec = normalizeIncidentRecord(item, kdeOptions);
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

export function matchObjectTypeToCategory(objectType = "") {
  const text = String(objectType || "").toLowerCase().trim();
  if (!text) return null;
  if (text.includes("ruko") || text.includes("komersial") || text.includes("toko") || text.includes("kios")) {
    return "ruko";
  }
  if (text.includes("rumah") || text.includes("hunian")) {
    return "rumah";
  }
  if (
    text.includes("travo") ||
    text.includes("trafo") ||
    text.includes("kabel") ||
    text.includes("listrik") ||
    text.includes("gardu") ||
    text.includes("tiang")
  ) {
    return "travo_kabel";
  }
  if (text.includes("gudang") || text.includes("pabrik") || text.includes("industri") || text.includes("workshop")) {
    return "gudang_pabrik";
  }
  if (
    text.includes("kendaraan") ||
    text.includes("mobil") ||
    text.includes("motor") ||
    text.includes("truk") ||
    text.includes("transportasi")
  ) {
    return "kendaraan";
  }
  if (text.includes("lahan") || text.includes("vegetasi") || text.includes("semak") || text.includes("hutan") || text.includes("kebun")) {
    return "lahan";
  }
  if (
    text.includes("fasilitas") ||
    text.includes("umum") ||
    text.includes("sekolah") ||
    text.includes("masjid") ||
    text.includes("pasar") ||
    text.includes("kantor") ||
    text.includes("rumah sakit")
  ) {
    return "fasilitas_umum";
  }
  if (
    text.includes("lain") ||
    text.includes("gas") ||
    text.includes("elpiji") ||
    text.includes("lpg") ||
    text.includes("sampah") ||
    text.includes("pohon")
  ) {
    return "lain_lain";
  }
  return null;
}

function getRecordPeriodYear(record = {}) {
  if (Number.isInteger(record.period_year) && record.period_year >= 1900 && record.period_year <= 2100) {
    return record.period_year;
  }
  if (record.occurred_at) {
    const parsed = new Date(record.occurred_at);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getUTCFullYear();
    }
  }
  return null;
}

export function filterSupabasePoints(
  records = [],
  { period = "2023-kecamatan", district = "semua", category = "semua", search = "" } = {}
) {
  const query = String(search || "").replace(/\s+/g, " ").trim().toLowerCase();
  const targetDistrict = district !== "semua" ? normalizeDistrictName(district) : "semua";

  return (records || []).filter((rec) => {
    if (!rec || rec.isDemo || !rec.geom) return false;

    const year = getRecordPeriodYear(rec);
    if (
      period === "bpbd-2021-2023" ||
      period === "bpbd-2022-2023-bulanan" ||
      period === "non-kebakaran-2023-2025" ||
      period === "kandidat-independen"
    ) {
      return false;
    }
    if (period === "2016-2021-bulanan") {
      if (year === null || year < 2016 || year > 2021) return false;
    } else if (period === "2023-kecamatan" || period === "2023-dampak") {
      if (year !== 2023) return false;
    } else if (period === "2024-bulanan") {
      if (year !== 2024) return false;
    } else if (period === "2025-bulanan") {
      if (year !== 2025) return false;
    } else if (period === "2016-2025-tahunan") {
      if (year === null || year < 2016 || year > 2025) return false;
    }

    if (targetDistrict !== "semua") {
      const recDistrict = normalizeDistrictName(rec.district_name || "");
      if (recDistrict !== targetDistrict) return false;
    }

    if (category && category !== "semua") {
      if (matchObjectTypeToCategory(rec.object_type) !== category) return false;
    }

    if (query) {
      const hay = [
        rec.source_record_id,
        rec.district_name || "",
        rec.subdistrict_name || "",
        rec.address_text || "",
        rec.object_type || "",
        rec.cause_category || "",
        rec.source_name || "",
        year !== null ? String(year) : ""
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }

    return true;
  });
}

export function shouldResetMapExtent(prevCtx, nextCtx) {
  if (!prevCtx) return true;
  if (Boolean(prevCtx.demoMode) !== Boolean(nextCtx.demoMode)) return true;
  if (prevCtx.period !== nextCtx.period) return true;
  if (normalizeDistrictName(prevCtx.district || "semua") !== normalizeDistrictName(nextCtx.district || "semua")) {
    return true;
  }
  return false;
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

export async function fetchSupabaseIncidents(
  supabaseService,
  {
    pageSize = SUPABASE_PAGE_SIZE,
    maxRecords = SUPABASE_MAX_RECORDS,
    maxPages = SUPABASE_MAX_PAGES,
    kdeOptions = {}
  } = {}
) {
  if (!supabaseService?.isConfigured || !supabaseService?.client) {
    return {
      active: false,
      source: "local",
      records: [],
      partitioned: partitionIncidentRecords([], kdeOptions),
      pagesLoaded: 0,
      truncated: false,
      partialLoad: false,
      maxRecords,
      error: null,
      note: supabaseService?.note || "Mode Lokal aktif tanpa konfigurasi Supabase."
    };
  }

  const safePageSize = Math.max(1, Number(pageSize) || SUPABASE_PAGE_SIZE);
  const safeMaxRecords = Math.max(1, Number(maxRecords) || SUPABASE_MAX_RECORDS);
  const safeMaxPages = Math.max(1, Number(maxPages) || SUPABASE_MAX_PAGES);

  const allRaw = [];
  let pagesLoaded = 0;
  let offset = 0;
  let truncated = false;
  let partialError = null;
  let lastBatchFull = false;

  for (let pageIdx = 0; pageIdx < safeMaxPages && allRaw.length < safeMaxRecords; pageIdx++) {
    const remaining = safeMaxRecords - allRaw.length;
    const batchSize = Math.min(safePageSize, remaining);
    const rangeEnd = offset + batchSize - 1;

    try {
      const { data, error } = await supabaseService.client
        .from("fire_incidents")
        .select(SUPABASE_INCIDENT_COLUMNS)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, rangeEnd);

      if (error) {
        partialError = error.message || "Gagal membaca tabel public.fire_incidents.";
        break;
      }

      if (!Array.isArray(data) || data.length === 0) {
        lastBatchFull = false;
        break;
      }

      pagesLoaded = pageIdx + 1;
      allRaw.push(...data.slice(0, remaining));
      offset += data.length;
      lastBatchFull = data.length >= batchSize;

      if (data.length < batchSize) {
        break;
      }
    } catch (err) {
      partialError = err?.message || "Koneksi Supabase gagal; memakai arsip lokal terverifikasi.";
      break;
    }
  }

  // Probe one row past maxRecords when capped on a full page so truncation is never silent
  if (!partialError && allRaw.length >= safeMaxRecords && lastBatchFull) {
    try {
      const { data, error } = await supabaseService.client
        .from("fire_incidents")
        .select(SUPABASE_INCIDENT_COLUMNS)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset);

      if (error) {
        partialError = error.message || "Gagal memeriksa sisa halaman Supabase.";
      } else if (Array.isArray(data) && data.length > 0) {
        truncated = true;
      }
    } catch (err) {
      partialError = err?.message || "Gagal memeriksa sisa halaman Supabase.";
    }
  }

  if (!partialError && !truncated && pagesLoaded >= safeMaxPages && allRaw.length < safeMaxRecords && lastBatchFull) {
    truncated = true;
  }

  if (partialError && allRaw.length === 0) {
    return {
      active: false,
      source: "local_fallback",
      records: [],
      partitioned: partitionIncidentRecords([], kdeOptions),
      pagesLoaded: 0,
      truncated: false,
      partialLoad: false,
      maxRecords: safeMaxRecords,
      error: partialError,
      note: `Fallback ke mode lokal: ${partialError}`
    };
  }

  const normalized = allRaw.map((row) => normalizeIncidentRecord(row, kdeOptions));
  const partitioned = partitionIncidentRecords(normalized, kdeOptions);

  if (partialError) {
    return {
      active: true,
      source: "supabase_partial",
      records: normalized,
      partitioned,
      pagesLoaded,
      truncated: true,
      partialLoad: true,
      maxRecords: safeMaxRecords,
      error: partialError,
      note: `Sebagian data Supabase dimuat (${normalized.length} record dari ${pagesLoaded} halaman); halaman lanjutan gagal: ${partialError}`
    };
  }

  const note = truncated
    ? `Menampilkan batas maksimum ${normalized.length} dari batas ${safeMaxRecords} record Supabase (${pagesLoaded} halaman); record lanjutan di luar batas tidak ikut dimuat.`
    : `Terhubung ke Supabase (${normalized.length} record individual pada ${pagesLoaded || 1} halaman public.fire_incidents).`;

  return {
    active: true,
    source: "supabase",
    records: normalized,
    partitioned,
    pagesLoaded,
    truncated,
    partialLoad: false,
    maxRecords: safeMaxRecords,
    error: null,
    note
  };
}

export async function loadExplorerDatasets(services) {
  const supabasePromise = fetchSupabaseIncidents(services.supabase);
  const summary = await services.dataStatus.fetchJson("fire_incidents_summary.json");
  const [districtsGeoJson, supabaseStatus] = await Promise.all([
    services.dataStatus.fetchJson("medan_districts_osm.geojson"),
    supabasePromise
  ]);

  return {
    summary,
    districtsGeoJson,
    supabaseStatus
  };
}

function getSourceRowsForPeriod(summary, period) {
  if (period === "2023-kecamatan") return summary.district_2023 || [];
  if (period === "2023-dampak") return summary.monthly_2023_impact || [];
  if (period === "2024-bulanan") return summary.monthly_2024 || [];
  if (period === "2025-bulanan") return summary.monthly_2025 || [];
  if (period === "2016-2025-tahunan") return summary.annual_series || [];
  if (period === "2016-2021-bulanan") return summary.monthly_2016_2021 || [];
  if (period === "bpbd-2021-2023") return summary.bpbd_comparison?.district_2022 || [];
  if (period === "bpbd-2022-2023-bulanan") {
    return [
      ...(summary.bpbd_comparison?.monthly_2022 || []),
      ...(summary.bpbd_comparison?.monthly_2023 || [])
    ];
  }
  if (period === "non-kebakaran-2023-2025") return summary.non_fire_rescues?.monthly_series || [];
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
  const isDistrictPeriod = period === "2023-kecamatan" || period === "bpbd-2021-2023";
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
        : row.display_label || row.month_name;

    const searchTarget = [
      displayLabel,
      row.area_code || "",
      row.source_name || "",
      row.source_file || "",
      row.dominant_rescue_type || "",
      row.period_year ? String(row.period_year) : ""
    ]
      .join(" ")
      .toLowerCase();
    if (query && !searchTarget.includes(query)) {
      continue;
    }

    const activeCount =
      hasCategories && category !== "semua"
        ? Number(row.categories?.[category] || 0)
        : period === "bpbd-2022-2023-bulanan"
          ? Number(row.fire_incidents ?? 0)
          : Number(row.fire_incidents ?? row.total_incidents ?? row.total_rescues ?? 0);

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

export function filterIndependentCandidates(
  records = [],
  {
    district = "semua",
    category = "semua",
    year = "semua",
    source = "semua",
    accuracy = "semua",
    search = "",
    sortBy = "default"
  } = {}
) {
  const query = String(search || "").replace(/\s+/g, " ").trim().toLowerCase();
  const targetDistrict = district !== "semua" ? normalizeDistrictName(district) : "semua";
  const targetYear = String(year || "semua").trim();
  const targetSource = String(source || "semua").trim().toLowerCase();
  const targetAccuracy = String(accuracy || "semua").trim().toLowerCase();

  const filtered = (records || [])
    .map((item) => {
      const normalized = normalizeIncidentRecord({ ...item, isDemo: false });
      return {
        ...item,
        ...normalized,
        kde_eligible: false,
        verification_status: item.verification_status || "needs_review",
        displayLabel: String(item.source_record_id || normalized.source_record_id)
      };
    })
    .filter((rec) => {
      if (rec.isDemo) return false;
      if (targetDistrict !== "semua" && rec.district_name !== targetDistrict) return false;
      if (category && category !== "semua") {
        const mapped = matchObjectTypeToCategory(rec.object_type) || rec.object_type;
        if (mapped !== category) return false;
      }
      if (targetYear !== "semua") {
        const recYear = String(rec.period_year || String(rec.occurred_on || "").slice(0, 4));
        if (recYear !== targetYear) return false;
      }
      if (targetSource !== "semua") {
        const haySource = `${rec.source_name || ""} ${rec.source_url || ""}`.toLowerCase();
        if (!haySource.includes(targetSource)) return false;
      }
      if (targetAccuracy !== "semua" && String(rec.location_accuracy || "").toLowerCase() !== targetAccuracy) {
        return false;
      }
      if (!query) return true;
      const hay = [
        rec.source_record_id,
        rec.occurred_on || "",
        rec.district_name || "",
        rec.subdistrict_name || "",
        rec.address_text || "",
        rec.object_summary || "",
        rec.object_type || "",
        rec.source_name || "",
        rec.dispatched_units_note || ""
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });

  if (sortBy === "desc") {
    filtered.sort(
      (a, b) =>
        String(b.occurred_on || "").localeCompare(String(a.occurred_on || "")) ||
        a.source_record_id.localeCompare(b.source_record_id, "id")
    );
  } else if (sortBy === "asc") {
    filtered.sort(
      (a, b) =>
        String(a.occurred_on || "").localeCompare(String(b.occurred_on || "")) ||
        a.source_record_id.localeCompare(b.source_record_id, "id")
    );
  } else if (sortBy === "name") {
    filtered.sort(
      (a, b) =>
        String(a.district_name || "").localeCompare(String(b.district_name || ""), "id") ||
        a.source_record_id.localeCompare(b.source_record_id, "id")
    );
  }

  return filtered;
}
