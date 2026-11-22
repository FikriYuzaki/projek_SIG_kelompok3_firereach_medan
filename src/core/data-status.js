const SUPABASE_SNAPSHOT_KEYS = Object.freeze({
  "manifest.json": "manifest",
  "fire_incidents_summary.json": "fire_incidents_summary",
  "medan_districts_osm.geojson": "medan_districts_osm",
  "station-coverage.provisional.json": "station_coverage_provisional",
  "priority-planner.provisional.json": "priority_planner_provisional"
});

function resolveSnapshotKey(relativePath) {
  const normalized = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^data\//, "");
  return SUPABASE_SNAPSHOT_KEYS[normalized] || null;
}

export function createDataStatusService(baseUrl = "/data", supabaseService = null) {
  let cachedManifest = null;
  let lastError = null;

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

    if (snapshotKey && supabaseService?.isConfigured && supabaseService?.client) {
      try {
        const { data, error } = await supabaseService.client
          .from("app_data_snapshots")
          .select("payload, dataset_status")
          .eq("snapshot_key", snapshotKey)
          .maybeSingle();

        if (error) {
          lastError = error.message || `Gagal membaca snapshot Supabase: ${snapshotKey}`;
        } else if (data && data.payload !== undefined && data.payload !== null) {
          lastError = null;
          return data.payload;
        }
      } catch (err) {
        lastError = err?.message || `Koneksi snapshot Supabase gagal: ${snapshotKey}`;
      }
    }

    try {
      return await fetchLocalJson(relativePath);
    } catch (err) {
      lastError = err?.message || "Gagal memuat dataset lokal.";
      throw err;
    }
  }

  async function getManifest({ forceRefresh = false } = {}) {
    if (cachedManifest && !forceRefresh) {
      return { ok: true, manifest: cachedManifest, error: null };
    }
    try {
      const data = await fetchJson("manifest.json");
      cachedManifest = data;
      lastError = null;
      return { ok: true, manifest: data, error: null };
    } catch (err) {
      lastError = err.message || "Gagal membaca manifest data.";
      return { ok: false, manifest: null, error: lastError };
    }
  }

  async function refresh() {
    return getManifest({ forceRefresh: true });
  }

  function getLastError() {
    return lastError;
  }

  return { getManifest, refresh, fetchJson, getLastError };
}
