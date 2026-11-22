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
});
