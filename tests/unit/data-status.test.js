import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataStatusService } from "../../src/core/data-status.js";
import { loadExplorerDatasets } from "../../src/features/incident-explorer/service.js";
import { loadHotspotZones } from "../../src/features/hotspot-analyzer/service.js";
import { loadStationCoverageData } from "../../src/features/station-coverage/service.js";
import { loadPriorityPlannerData } from "../../src/features/priority-planner/service.js";

const PUBLIC_DATA_DIR = path.resolve(process.cwd(), "public/data");

function readPublicJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(PUBLIC_DATA_DIR, relPath), "utf-8"));
}

function createSupabaseService(result, { rejectWith = null } = {}) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: rejectWith ? vi.fn().mockRejectedValue(rejectWith) : vi.fn().mockResolvedValue(result)
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);

  return {
    service: {
      isConfigured: true,
      client: { from: vi.fn(() => builder) }
    },
    builder
  };
}

function createSnapshotBackedSupabaseClient(snapshotMap, incidentRows = []) {
  return {
    isConfigured: true,
    mode: "supabase",
    statusLabel: "Terhubung ke Supabase",
    note: "Menggunakan URL dan publishable key proyek Supabase dengan Row Level Security aktif.",
    client: {
      from: vi.fn((table) => {
        if (table === "app_data_snapshots") {
          let requestedKey = null;
          const builder = {
            select: vi.fn(() => builder),
            eq: vi.fn((col, val) => {
              if (col === "snapshot_key") {
                requestedKey = val;
              }
              return builder;
            }),
            maybeSingle: vi.fn(async () => {
              const entry = Object.prototype.hasOwnProperty.call(snapshotMap, requestedKey)
                ? snapshotMap[requestedKey]
                : null;
              return { data: entry, error: null };
            })
          };
          return builder;
        }
        if (table === "fire_incidents") {
          const builder = {
            select: vi.fn(() => builder),
            order: vi.fn(() => builder),
            range: vi.fn(async () => ({ data: incidentRows, error: null }))
          };
          return builder;
        }
        throw new Error(`Unexpected table query: ${table}`);
      })
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("data status Supabase snapshots with local fallback", () => {
  it("prefers the Supabase manifest snapshot when it exists", async () => {
    const manifest = { city: "Kota Medan", source: "supabase-snapshot" };
    const { service, builder } = createSupabaseService({
      data: { payload: manifest, dataset_status: "provisional" },
      error: null
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", service);
    const result = await dataStatus.fetchJson("manifest.json");

    expect(result).toEqual(manifest);
    expect(service.client.from).toHaveBeenCalledWith("app_data_snapshots");
    expect(builder.eq).toHaveBeenCalledWith("snapshot_key", "manifest");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps all 5 snapshot paths (including normalized /data/ prefixes) and reads manifest via getManifest", async () => {
    const snapshots = {
      manifest: { payload: { city: "Kota Medan", datasets: [] }, dataset_status: "verified" },
      fire_incidents_summary: { payload: { summary_totals: { year_2023: 219 } }, dataset_status: "verified" },
      medan_districts_osm: { payload: { type: "FeatureCollection", features: [] }, dataset_status: "fallback_osm" },
      station_coverage_provisional: { payload: { dataLabel: "PROVISIONAL" }, dataset_status: "provisional" },
      priority_planner_provisional: { payload: { dataLabel: "PROVISIONAL" }, dataset_status: "provisional" }
    };
    const supabase = createSnapshotBackedSupabaseClient(snapshots);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", supabase);

    const manifestResp = await dataStatus.getManifest();
    expect(manifestResp).toEqual({ ok: true, manifest: snapshots.manifest.payload, error: null });
    expect(await dataStatus.fetchJson("fire_incidents_summary.json")).toEqual(
      snapshots.fire_incidents_summary.payload
    );
    expect(await dataStatus.fetchJson("/data/medan_districts_osm.geojson")).toEqual(
      snapshots.medan_districts_osm.payload
    );
    expect(await dataStatus.fetchJson("/data/station-coverage.provisional.json")).toEqual(
      snapshots.station_coverage_provisional.payload
    );
    expect(await dataStatus.fetchJson("priority-planner.provisional.json")).toEqual(
      snapshots.priority_planner_provisional.payload
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the local file if the Supabase snapshot query fails", async () => {
    const { service } = createSupabaseService({
      data: null,
      error: { message: "temporary Supabase error" }
    });
    const localPayload = { city: "Kota Medan", source: "local-fallback" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localPayload
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", service);
    const result = await dataStatus.fetchJson("fire_incidents_summary.json");

    expect(result).toEqual(localPayload);
    expect(dataStatus.getLastError()).toBe("temporary Supabase error");
    expect(fetchMock).toHaveBeenCalledWith("/data/fire_incidents_summary.json", {
      headers: { Accept: "application/json" }
    });
  });

  it("falls back to the local file when Supabase throws or returns an empty snapshot row", async () => {
    const localPayload = { ok: true, source: "local" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localPayload
    });
    vi.stubGlobal("fetch", fetchMock);

    const networkFailure = createSupabaseService(null, { rejectWith: new Error("fetch failed") });
    const dataStatusRejected = createDataStatusService("/data", networkFailure.service);
    await expect(dataStatusRejected.fetchJson("manifest.json")).resolves.toEqual(localPayload);
    expect(dataStatusRejected.getLastError()).toBe("fetch failed");

    const missingRow = createSupabaseService({ data: null, error: null });
    const dataStatusMissing = createDataStatusService("/data", missingRow.service);
    await expect(dataStatusMissing.fetchJson("station-coverage.provisional.json")).resolves.toEqual(localPayload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps all DEMO fixtures local and never queries the public snapshot table", async () => {
    const { service } = createSupabaseService({ data: null, error: null });
    const demoPaths = [
      "demo/incident-explorer-sample.demo.json",
      "demo/hotspot-analyzer.demo.json",
      "demo/station-coverage.demo.json",
      "demo/priority-planner.demo.json"
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ isDemo: true, dataLabel: "DEMO" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", service);
    for (const demoPath of demoPaths) {
      const result = await dataStatus.fetchJson(demoPath);
      expect(result).toEqual({ isDemo: true, dataLabel: "DEMO" });
    }

    expect(service.client.from).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(demoPaths.length);
    for (const demoPath of demoPaths) {
      expect(fetchMock).toHaveBeenCalledWith(`/data/${demoPath}`, {
        headers: { Accept: "application/json" }
      });
    }
  });

  it("uses local files safely when Supabase is not configured", async () => {
    const localPayload = { ok: true };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => localPayload });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", { isConfigured: false, client: null });
    await expect(dataStatus.fetchJson("medan_districts_osm.geojson")).resolves.toEqual(localPayload);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("integrates all 4 modules with Supabase snapshots while keeping Hotspot Analyzer in honest pending/DEMO mode", async () => {
    const snapshots = {
      manifest: { payload: readPublicJson("manifest.json"), dataset_status: "verified" },
      fire_incidents_summary: {
        payload: readPublicJson("fire_incidents_summary.json"),
        dataset_status: "verified"
      },
      medan_districts_osm: {
        payload: readPublicJson("medan_districts_osm.geojson"),
        dataset_status: "fallback_osm"
      },
      station_coverage_provisional: {
        payload: readPublicJson("station-coverage.provisional.json"),
        dataset_status: "provisional"
      },
      priority_planner_provisional: {
        payload: readPublicJson("priority-planner.provisional.json"),
        dataset_status: "provisional"
      }
    };
    const supabase = createSnapshotBackedSupabaseClient(snapshots, []);
    const hotspotDemo = readPublicJson("demo/hotspot-analyzer.demo.json");

    const fetchMock = vi.fn(async (url) => {
      if (url === "/data/demo/hotspot-analyzer.demo.json") {
        return { ok: true, json: async () => hotspotDemo };
      }
      throw new Error(`Unexpected local fetch for non-DEMO asset: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", supabase);
    const services = { supabase, dataStatus };

    const explorer = await loadExplorerDatasets(services);
    expect(explorer.summary.summary_totals.year_2023).toBe(219);
    expect(explorer.districtsGeoJson.features).toHaveLength(21);
    expect(explorer.supabaseStatus.active).toBe(true);
    expect(explorer.supabaseStatus.records).toEqual([]);

    const hotspot = await loadHotspotZones(services);
    expect(hotspot.isDemo).toBe(true);
    expect(hotspot.dataLabel).toBe("DEMO");
    expect(hotspot.sourceMode).toBe("demo");
    expect(hotspot.verifiedLoadStatus).toBe("unavailable");
    expect(hotspot.boundaryValid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/data/demo/hotspot-analyzer.demo.json", {
      headers: { Accept: "application/json" }
    });

    const coverage = await loadStationCoverageData(services);
    expect(coverage.isDemo).toBe(false);
    expect(coverage.dataLabel).toBe("PROVISIONAL");
    expect(coverage.sourceMode).toBe("provisional");
    expect(coverage.verifiedStations.length).toBeGreaterThanOrEqual(1);
    expect(coverage.districtCoverage).toHaveLength(21);

    const priority = await loadPriorityPlannerData(services);
    expect(priority.isDemo).toBe(false);
    expect(priority.dataLabel).toBe("PROVISIONAL");
    expect(priority.sourceMode).toBe("provisional");
    expect(priority.zones).toHaveLength(21);
  });

  it("preserves the Supabase error in getLastError() when getManifest() falls back to local JSON and clears it only when Supabase succeeds", async () => {
    const localManifest = { city: "Kota Medan", source: "local-manifest" };
    const remoteManifest = { city: "Kota Medan", source: "supabase-manifest" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localManifest
    });
    vi.stubGlobal("fetch", fetchMock);

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "permission denied for table app_data_snapshots" } })
      .mockRejectedValueOnce(new Error("supabase network timeout"))
      .mockResolvedValueOnce({ data: { payload: remoteManifest, dataset_status: "verified" }, error: null });

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle
    };
    const supabase = {
      isConfigured: true,
      client: { from: vi.fn(() => builder) }
    };

    const dataStatus = createDataStatusService("/data", supabase);

    // 1. Supabase query error -> falls back to local manifest AND preserves Supabase error
    const firstResp = await dataStatus.getManifest();
    expect(firstResp).toEqual({ ok: true, manifest: localManifest, error: null });
    expect(dataStatus.getLastError()).toBe("permission denied for table app_data_snapshots");

    // 2. Cached getManifest() call must not wipe the preserved fallback error
    const cachedResp = await dataStatus.getManifest();
    expect(cachedResp).toEqual({ ok: true, manifest: localManifest, error: null });
    expect(dataStatus.getLastError()).toBe("permission denied for table app_data_snapshots");

    // 3. Thrown network exception on refresh -> falls back to local manifest AND updates error
    const secondResp = await dataStatus.refresh();
    expect(secondResp).toEqual({ ok: true, manifest: localManifest, error: null });
    expect(dataStatus.getLastError()).toBe("supabase network timeout");

    // 4. Subsequent Supabase success clears getLastError() back to null
    const thirdResp = await dataStatus.refresh();
    expect(thirdResp).toEqual({ ok: true, manifest: remoteManifest, error: null });
    expect(dataStatus.getLastError()).toBeNull();
  });

  it("records a missing-snapshot error when Supabase returns an empty row and falls back to local JSON", async () => {
    const localManifest = { city: "Kota Medan", source: "local-fallback" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localManifest
    });
    vi.stubGlobal("fetch", fetchMock);

    const emptyRow = createSupabaseService({ data: null, error: null });
    const dataStatus = createDataStatusService("/data", emptyRow.service);

    const resp = await dataStatus.getManifest();
    expect(resp).toEqual({ ok: true, manifest: localManifest, error: null });
    expect(dataStatus.getLastError()).toContain("manifest");
    expect(dataStatus.getLastError()).toMatch(/tidak ditemukan|tidak tersedia/i);

    const nullPayload = createSupabaseService({ data: { payload: null, dataset_status: "unavailable" }, error: null });
    const dataStatusNullPayload = createDataStatusService("/data", nullPayload.service);
    await expect(dataStatusNullPayload.fetchJson("priority-planner.provisional.json")).resolves.toEqual(localManifest);
    expect(dataStatusNullPayload.getLastError()).toContain("priority_planner_provisional");
  });

  it("loads local manifest cleanly without setting a fake error when Supabase is not configured", async () => {
    const localManifest = { city: "Kota Medan", source: "local-only" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localManifest
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", { isConfigured: false, client: null });
    const resp = await dataStatus.getManifest();

    expect(resp).toEqual({ ok: true, manifest: localManifest, error: null });
    expect(dataStatus.getLastError()).toBeNull();
  });

  it("keeps DEMO fixtures strictly local without clearing a prior Supabase fallback error", async () => {
    const localManifest = { city: "Kota Medan", source: "local-manifest" };
    const demoPayload = { isDemo: true, dataLabel: "DEMO" };
    const fetchMock = vi.fn(async (url) => {
      if (url === "/data/manifest.json") {
        return { ok: true, json: async () => localManifest };
      }
      if (url === "/data/demo/hotspot-analyzer.demo.json") {
        return { ok: true, json: async () => demoPayload };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { service } = createSupabaseService({
      data: null,
      error: { message: "snapshot query timed out" }
    });
    const dataStatus = createDataStatusService("/data", service);

    await dataStatus.getManifest();
    expect(dataStatus.getLastError()).toBe("snapshot query timed out");

    const demoResult = await dataStatus.fetchJson("demo/hotspot-analyzer.demo.json");
    expect(demoResult).toEqual(demoPayload);
    expect(service.client.from).toHaveBeenCalledTimes(1);
    expect(dataStatus.getLastError()).toBe("snapshot query timed out");
  });

  it("propagates and records local file errors when both Supabase fallback and local fetch fail", async () => {
    const { service } = createSupabaseService({
      data: null,
      error: { message: "supabase unavailable" }
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", service);

    await expect(dataStatus.fetchJson("fire_incidents_summary.json")).rejects.toThrow("HTTP 503");
    expect(dataStatus.getLastError()).toContain("HTTP 503");

    const manifestResp = await dataStatus.getManifest();
    expect(manifestResp.ok).toBe(false);
    expect(manifestResp.manifest).toBeNull();
    expect(manifestResp.error).toContain("HTTP 503");
    expect(dataStatus.getLastError()).toContain("HTTP 503");
  });
});
