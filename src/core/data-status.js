export function createDataStatusService(baseUrl = "/data") {
  let cachedManifest = null;
  let lastError = null;

  async function fetchJson(relativePath) {
    const clean = relativePath.startsWith("/") ? relativePath : `${baseUrl}/${relativePath}`;
    const res = await fetch(clean, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`Gagal memuat ${clean} (HTTP ${res.status})`);
    }
    return res.json();
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
