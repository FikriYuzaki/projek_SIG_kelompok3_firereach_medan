const SUPABASE_SNAPSHOT_KEYS = Object.freeze({
  "manifest.json": "manifest",
  "fire_incidents_summary.json": "fire_incidents_summary",
  "medan_districts_osm.geojson": "medan_districts_osm",
  "station-coverage.provisional.json": "station_coverage_provisional",
  "priority-planner.provisional.json": "priority_planner_provisional"
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isValidSpmEntry(item, unit) {
  return (
    isPlainObject(item) &&
    item.unit === unit &&
    typeof item.realization_value === "number" &&
    Number.isFinite(item.realization_value) &&
    typeof item.target_value === "number" &&
    Number.isFinite(item.target_value)
  );
}

/**
 * Validate whether a Supabase snapshot payload satisfies the current PR #6 data contract.
 * Prevents stale remote snapshots from rendering zeroed or incomplete UI metrics when
 * newer static JSON assets exist under /data/.
 */
export function validateSnapshotPayload(snapshotKey, payload) {
  if (!isPlainObject(payload)) {
    return {
      valid: false,
      reason: `Snapshot Supabase '${snapshotKey}' stale/incomplete (payload bukan objek valid).`
    };
  }

  if (snapshotKey === "manifest") {
    const missing = [];
    if (!hasNonEmptyArray(payload.datasets)) missing.push("datasets");
    if (!Array.isArray(payload.blockers)) missing.push("blockers");
    if (!isPlainObject(payload.verified_outputs)) missing.push("verified_outputs");
    const indep = payload.independent_enrichment;
    if (
      !isPlainObject(indep) ||
      typeof indep.scope_note !== "string" ||
      !indep.scope_note.trim() ||
      !hasNonEmptyArray(indep.datasets) ||
      indep.datasets.some(
        (item) =>
          !isPlainObject(item) ||
          typeof item.id !== "string" ||
          !item.id ||
          typeof item.status !== "string" ||
          !item.status
      )
    ) {
      missing.push("independent_enrichment");
    }
    return missing.length
      ? {
          valid: false,
          reason: `Snapshot Supabase 'manifest' stale/incomplete (missing: ${missing.join(", ")}).`
        }
      : { valid: true, reason: null };
  }

  if (snapshotKey === "fire_incidents_summary") {
    const missing = [];
    if (!isPlainObject(payload.summary_totals) || typeof payload.summary_totals.year_2023 !== "number") {
      missing.push("summary_totals");
    }
    if (!hasNonEmptyArray(payload.district_2023)) missing.push("district_2023");
    if (!hasNonEmptyArray(payload.monthly_2016_2021)) missing.push("monthly_2016_2021");

    const bpbd = payload.bpbd_comparison;
    if (
      !isPlainObject(bpbd) ||
      bpbd.is_comparison_only !== true ||
      !hasNonEmptyArray(bpbd.district_2021) ||
      !hasNonEmptyArray(bpbd.district_2022) ||
      !hasNonEmptyArray(bpbd.monthly_2022) ||
      !hasNonEmptyArray(bpbd.monthly_2023)
    ) {
      missing.push("bpbd_comparison");
    }

    const spm = payload.damkarmat_spm;
    if (
      !Array.isArray(spm) ||
      spm.length < 2 ||
      !spm.some((item) => isValidSpmEntry(item, "%")) ||
      !spm.some((item) => isValidSpmEntry(item, "menit"))
    ) {
      missing.push("damkarmat_spm");
    }

    const nonFire = payload.non_fire_rescues;
    if (
      !isPlainObject(nonFire) ||
      nonFire.is_fire_incident !== false ||
      !hasNonEmptyArray(nonFire.monthly_series) ||
      typeof nonFire.combined_total !== "number"
    ) {
      missing.push("non_fire_rescues");
    }

    const incCand = payload.independent_incident_candidates;
    if (
      !isPlainObject(incCand) ||
      incCand.isDemo !== false ||
      !hasNonEmptyArray(incCand.records)
    ) {
      missing.push("independent_incident_candidates");
    }

    const stCand = payload.candidate_stations;
    if (
      !isPlainObject(stCand) ||
      stCand.isDemo !== false ||
      !hasNonEmptyArray(stCand.stations)
    ) {
      missing.push("candidate_stations");
    }

    if (!hasNonEmptyArray(payload.verified_stations)) missing.push("verified_stations");

    return missing.length
      ? {
          valid: false,
          reason: `Snapshot Supabase 'fire_incidents_summary' stale/incomplete (missing: ${missing.join(", ")}).`
        }
      : { valid: true, reason: null };
  }

  if (snapshotKey === "medan_districts_osm") {
    if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
      return {
        valid: false,
        reason: "Snapshot Supabase 'medan_districts_osm' stale/incomplete (bukan FeatureCollection)."
      };
    }
    return { valid: true, reason: null };
  }

  if (snapshotKey === "station_coverage_provisional" || snapshotKey === "priority_planner_provisional") {
    if (Object.keys(payload).length === 0) {
      return {
        valid: false,
        reason: `Snapshot Supabase '${snapshotKey}' stale/incomplete (objek kosong).`
      };
    }
    return { valid: true, reason: null };
  }

  return { valid: true, reason: null };
}

function resolveSnapshotKey(relativePath) {
  const normalized = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^data\//, "");
  return SUPABASE_SNAPSHOT_KEYS[normalized] || null;
}

/**
 * Derive user-facing badge copy describing the actual active data payload source.
 * Keeps connection status separate from where active payloads were loaded.
 */
export function describeActiveDataSource(snapshotStatus = {}) {
  const mode = snapshotStatus?.mode || "local";
  if (mode === "supabase") {
    return {
      mode,
      badgeClass: "status-badge--active",
      marker: "[+]",
      label: "Sumber Data: Supabase Online",
      title: "Payload snapshot aktif dibaca dari public.app_data_snapshots Supabase."
    };
  }
  if (mode === "local_fallback_stale") {
    return {
      mode,
      badgeClass: "status-badge--dev",
      marker: "[!]",
      label: "Sumber Data: JSON Lokal (Fallback: Snapshot Supabase Usang)",
      title:
        snapshotStatus?.reason ||
        "Snapshot Supabase usang/tidak lengkap; aplikasi memakai /data/*.json terbaru tanpa mencampur sumber."
    };
  }
  if (mode === "local_fallback") {
    return {
      mode,
      badgeClass: "status-badge--dev",
      marker: "[!]",
      label: "Sumber Data: JSON Lokal (Fallback)",
      title:
        snapshotStatus?.reason ||
        "Pembacaan snapshot Supabase gagal; aplikasi sementara memakai /data/*.json lokal."
    };
  }
  if (mode === "supabase_pending") {
    return {
      mode,
      badgeClass: "status-badge--local",
      marker: "[~]",
      label: "Sumber Data: Memeriksa...",
      title: "Menunggu verifikasi skema snapshot aktif."
    };
  }
  return {
    mode: "local",
    badgeClass: "status-badge--local",
    marker: "[o]",
    label: "Sumber Data: JSON Lokal",
    title: "Payload dataset dibaca dari berkas statis terverifikasi di /public/data/."
  };
}

export function createDataStatusService(baseUrl = "/data", supabaseService = null) {
  let cachedManifest = null;
  let cachedManifestSource = null;
  let lastError = null;
  let isLocalFallback = false;
  let isStaleFallback = false;
  let fallbackReason = null;
  const snapshotSources = new Map();
  const listeners = new Set();

  function getSnapshotStatus() {
    const sourcesObj = Object.fromEntries(snapshotSources.entries());
    const hasSupabase = Object.values(sourcesObj).some((s) => s === "supabase");
    const hasLocal = Object.values(sourcesObj).some((s) => s === "local");
    let mode = "local";
    if (isStaleFallback) {
      mode = "local_fallback_stale";
    } else if (isLocalFallback) {
      mode = "local_fallback";
    } else if (supabaseService?.isConfigured && supabaseService?.client) {
      if (hasLocal) {
        mode = "local_fallback";
      } else if (hasSupabase) {
        mode = "supabase";
      } else {
        mode = "supabase_pending";
      }
    }
    return {
      mode,
      isFallback: isLocalFallback || isStaleFallback,
      isStaleFallback,
      reason: fallbackReason || (mode === "local_fallback" ? lastError : null),
      snapshotSources: sourcesObj
    };
  }

  function notifyListeners() {
    const status = getSnapshotStatus();
    for (const listener of listeners) {
      try {
        listener(status);
      } catch {
        // Ignore subscriber UI errors during teardown
      }
    }
  }

  function activateLocalFallback({ stale = false, reason = null } = {}) {
    isLocalFallback = true;
    if (stale) {
      isStaleFallback = true;
    }
    if (reason) {
      if (stale || !fallbackReason) {
        fallbackReason = reason;
      }
      lastError = reason;
    }
    if (cachedManifestSource === "supabase") {
      cachedManifest = null;
      cachedManifestSource = null;
    }
    snapshotSources.clear();
    notifyListeners();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function fetchLocalJson(relativePath) {
    const clean = relativePath.startsWith("/") ? relativePath : `${baseUrl}/${relativePath}`;
    const res = await fetch(clean, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`Gagal memuat ${clean} (HTTP ${res.status})`);
    }
    return res.json();
  }

  async function fetchJson(relativePath) {
    const snapshotKey = resolveSnapshotKey(relativePath);
    const isSupabaseConfigured = Boolean(supabaseService?.isConfigured && supabaseService?.client);
    const useSupabase = Boolean(
      snapshotKey && isSupabaseConfigured && !isLocalFallback && !isStaleFallback
    );

    if (useSupabase) {
      try {
        const { data, error } = await supabaseService.client
          .from("app_data_snapshots")
          .select("payload, dataset_status")
          .eq("snapshot_key", snapshotKey)
          .maybeSingle();

        if (error) {
          activateLocalFallback({
            stale: false,
            reason: error.message || `Gagal membaca snapshot Supabase: ${snapshotKey}`
          });
        } else if (data && data.payload !== undefined && data.payload !== null) {
          const check = validateSnapshotPayload(snapshotKey, data.payload);
          if (check.valid) {
            lastError = null;
            snapshotSources.set(snapshotKey, "supabase");
            notifyListeners();
            return data.payload;
          }
          // Trip coherent session fallback to /data/* so old remote snapshots are never mixed with local assets
          activateLocalFallback({ stale: true, reason: check.reason });
        } else {
          activateLocalFallback({
            stale: false,
            reason: `Snapshot Supabase tidak ditemukan atau tidak tersedia: ${snapshotKey}`
          });
        }
      } catch (err) {
        activateLocalFallback({
          stale: false,
          reason: err?.message || `Koneksi snapshot Supabase gagal: ${snapshotKey}`
        });
      }
    }

    try {
      const localData = await fetchLocalJson(relativePath);
      if (snapshotKey) {
        snapshotSources.set(snapshotKey, "local");
      }
      if (!isSupabaseConfigured) {
        lastError = null;
      }
      notifyListeners();
      return localData;
    } catch (err) {
      lastError = err?.message || "Gagal memuat dataset lokal.";
      throw err;
    }
  }

  async function getManifest({ forceRefresh = false } = {}) {
    if (forceRefresh) {
      cachedManifest = null;
      cachedManifestSource = null;
      isLocalFallback = false;
      isStaleFallback = false;
      fallbackReason = null;
      snapshotSources.clear();
      notifyListeners();
    } else if (cachedManifest) {
      return { ok: true, manifest: cachedManifest, error: null };
    }
    try {
      const data = await fetchJson("manifest.json");
      cachedManifest = data;
      cachedManifestSource = snapshotSources.get("manifest") || "local";
      return { ok: true, manifest: data, error: null };
    } catch (err) {
      lastError = err?.message || "Gagal membaca manifest data.";
      return { ok: false, manifest: null, error: lastError };
    }
  }

  async function refresh() {
    return getManifest({ forceRefresh: true });
  }

  function getLastError() {
    return lastError;
  }

  return { getManifest, refresh, fetchJson, getLastError, getSnapshotStatus, subscribe };
}
