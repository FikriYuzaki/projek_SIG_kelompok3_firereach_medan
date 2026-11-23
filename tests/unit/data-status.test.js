import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", () => ({
  default: {
    layerGroup: () => ({ addTo: () => ({ clearLayers: vi.fn() }) }),
    geoJSON: () => ({
      addTo: () => ({ setStyle: vi.fn() }),
      setStyle: vi.fn()
    }),
    circleMarker: () => ({
      bindPopup: function () {
        return this;
      },
      on: function () {
        return this;
      },
      addTo: function () {
        return this;
      }
    })
  }
}));

import {
  createDataStatusService,
  describeActiveDataSource,
  validateSnapshotPayload
} from "../../src/core/data-status.js";
import { createShellLayout } from "../../src/core/layout.js";
import { formatters } from "../../src/core/formatters.js";
import { renderAbout } from "../../src/components/about-view.js";
import { renderDashboard } from "../../src/components/dashboard-view.js";
import { loadExplorerDatasets } from "../../src/features/incident-explorer/service.js";
import { loadHotspotZones } from "../../src/features/hotspot-analyzer/service.js";
import { loadStationCoverageData } from "../../src/features/station-coverage/service.js";
import { loadPriorityPlannerData } from "../../src/features/priority-planner/service.js";

const PUBLIC_DATA_DIR = path.resolve(process.cwd(), "public/data");

function readPublicJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(PUBLIC_DATA_DIR, relPath), "utf-8"));
}

function createCompleteManifestSnapshot(overrides = {}) {
  return {
    ...readPublicJson("manifest.json"),
    ...overrides
  };
}

function createCompleteSummarySnapshot(overrides = {}) {
  return {
    ...readPublicJson("fire_incidents_summary.json"),
    ...overrides
  };
}

function createLegacyManifestSnapshot() {
  const full = readPublicJson("manifest.json");
  const legacy = { ...full, datasets: full.datasets.slice(0, 7) };
  delete legacy.independent_enrichment;
  return legacy;
}

function createLegacySummarySnapshot() {
  const legacy = { ...readPublicJson("fire_incidents_summary.json") };
  delete legacy.monthly_2016_2021;
  delete legacy.bpbd_comparison;
  delete legacy.damkarmat_spm;
  delete legacy.non_fire_rescues;
  delete legacy.independent_incident_candidates;
  delete legacy.candidate_stations;
  return legacy;
}

function makeStubContainer() {
  return {
    innerHTML: "",
    querySelector: () => ({}),
    replaceChildren: vi.fn()
  };
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
  it("prefers the Supabase manifest snapshot when it exists and passes PR #6 schema check", async () => {
    const manifest = createCompleteManifestSnapshot({ source: "supabase-snapshot" });
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
      manifest: { payload: createCompleteManifestSnapshot(), dataset_status: "verified" },
      fire_incidents_summary: { payload: createCompleteSummarySnapshot(), dataset_status: "verified" },
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
    const remoteManifest = createCompleteManifestSnapshot({ source: "supabase-manifest" });
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

  it("validates snapshot schema fields strictly and rejects legacy, null, empty, or partial payloads", () => {
    expect(validateSnapshotPayload("manifest", createCompleteManifestSnapshot()).valid).toBe(true);
    expect(validateSnapshotPayload("fire_incidents_summary", createCompleteSummarySnapshot()).valid).toBe(true);

    expect(validateSnapshotPayload("manifest", null).valid).toBe(false);
    expect(validateSnapshotPayload("manifest", {}).valid).toBe(false);
    expect(validateSnapshotPayload("manifest", []).valid).toBe(false);
    expect(validateSnapshotPayload("manifest", createLegacyManifestSnapshot()).valid).toBe(false);

    expect(validateSnapshotPayload("fire_incidents_summary", null).valid).toBe(false);
    expect(validateSnapshotPayload("fire_incidents_summary", {}).valid).toBe(false);
    expect(validateSnapshotPayload("fire_incidents_summary", createLegacySummarySnapshot()).valid).toBe(false);

    // Individual missing PR #6 schema sections must each fail validation
    const fullSummary = createCompleteSummarySnapshot();
    const cases = [
      { ...fullSummary, monthly_2016_2021: [] },
      { ...fullSummary, bpbd_comparison: { ...fullSummary.bpbd_comparison, monthly_2023: [] } },
      { ...fullSummary, damkarmat_spm: [fullSummary.damkarmat_spm[0]] },
      { ...fullSummary, non_fire_rescues: { ...fullSummary.non_fire_rescues, monthly_series: [] } },
      { ...fullSummary, independent_incident_candidates: { ...fullSummary.independent_incident_candidates, records: [] } },
      { ...fullSummary, candidate_stations: { ...fullSummary.candidate_stations, stations: [] } }
    ];
    for (const broken of cases) {
      const res = validateSnapshotPayload("fire_incidents_summary", broken);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("stale/incomplete");
    }

    expect(validateSnapshotPayload("medan_districts_osm", {}).valid).toBe(false);
    expect(validateSnapshotPayload("station_coverage_provisional", {}).valid).toBe(false);
  });

  it("falls back coherently from stale pre-PR #6 Supabase snapshots to static /data/*.json across Dashboard, About, and Explorer without rendering zeros", async () => {
    const localManifest = readPublicJson("manifest.json");
    const localSummary = readPublicJson("fire_incidents_summary.json");
    const localGeo = readPublicJson("medan_districts_osm.geojson");

    const staleSnapshots = {
      manifest: { payload: createLegacyManifestSnapshot(), dataset_status: "verified" },
      fire_incidents_summary: { payload: createLegacySummarySnapshot(), dataset_status: "verified" },
      medan_districts_osm: { payload: localGeo, dataset_status: "fallback_osm" }
    };
    const supabase = createSnapshotBackedSupabaseClient(staleSnapshots, []);
    const fetchMock = vi.fn(async (url) => {
      if (url === "/data/manifest.json") return { ok: true, json: async () => localManifest };
      if (url === "/data/fire_incidents_summary.json") return { ok: true, json: async () => localSummary };
      if (url === "/data/medan_districts_osm.geojson") return { ok: true, json: async () => localGeo };
      throw new Error(`Unexpected local fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", supabase);
    const services = {
      supabase,
      dataStatus,
      format: formatters,
      maps: {
        createMap: () => ({ map: { _mapPane: true }, destroy: vi.fn() }),
        addGeoJson: vi.fn(() => ({})),
        fitBounds: vi.fn()
      }
    };

    const dashContainer = makeStubContainer();
    const unmountDash = await renderDashboard({ container: dashContainer, services, navigate: vi.fn() });
    await unmountDash();

    expect(dashContainer.innerHTML).toContain("100% (target 100%)");
    expect(dashContainer.innerHTML).toContain("13.10 mnt (target 15.00 mnt)");
    expect(dashContainer.innerHTML).toContain("2.218");
    expect(dashContainer.innerHTML).toContain("27 (17 titik ruas)");
    expect(dataStatus.getSnapshotStatus().mode).toBe("local_fallback_stale");
    expect(dataStatus.getSnapshotStatus().isStaleFallback).toBe(true);
    expect(Object.values(dataStatus.getSnapshotStatus().snapshotSources).every((v) => v === "local")).toBe(true);

    const aboutContainer = makeStubContainer();
    await renderAbout({ container: aboutContainer, services, navigate: vi.fn() });
    expect(aboutContainer.innerHTML).toContain("Pengayaan Kandidat Independen (Belum Terverifikasi)");
    expect(aboutContainer.innerHTML).toContain("BPBD Rekapitulasi Bencana Tahun 2021");

    const explorer = await loadExplorerDatasets(services);
    expect(explorer.summary.monthly_2016_2021).toHaveLength(72);
    expect(explorer.summary.bpbd_comparison.monthly_2023).toHaveLength(12);
    expect(explorer.summary.damkarmat_spm).toHaveLength(2);
    expect(explorer.summary.non_fire_rescues.combined_total).toBe(2218);
    expect(explorer.summary.independent_incident_candidates.records).toHaveLength(27);
    expect(explorer.summary.candidate_stations.stations).toHaveLength(6);
  });

  it("prevents mixing Supabase and local snapshots when manifest is new on Supabase but summary is stale (and vice versa)", async () => {
    const localManifest = createCompleteManifestSnapshot({ sourceTag: "local-manifest" });
    const localSummary = createCompleteSummarySnapshot({ sourceTag: "local-summary" });
    const localGeo = readPublicJson("medan_districts_osm.geojson");
    const remoteGeo = { ...localGeo, sourceTag: "remote-geo" };

    const fetchMock = vi.fn(async (url) => {
      if (url === "/data/manifest.json") return { ok: true, json: async () => localManifest };
      if (url === "/data/fire_incidents_summary.json") return { ok: true, json: async () => localSummary };
      if (url === "/data/medan_districts_osm.geojson") return { ok: true, json: async () => localGeo };
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Case A: new manifest on Supabase + stale summary on Supabase -> Dashboard must end with coherent ALL-local data
    const mixedCaseASupabase = createSnapshotBackedSupabaseClient({
      manifest: { payload: createCompleteManifestSnapshot({ sourceTag: "remote-manifest" }), dataset_status: "verified" },
      fire_incidents_summary: { payload: createLegacySummarySnapshot(), dataset_status: "verified" },
      medan_districts_osm: { payload: remoteGeo, dataset_status: "fallback_osm" }
    });
    const statusA = createDataStatusService("/data", mixedCaseASupabase);
    const dashServicesA = {
      supabase: mixedCaseASupabase,
      dataStatus: statusA,
      format: formatters,
      maps: {
        createMap: () => ({ map: {}, destroy: vi.fn() }),
        addGeoJson: vi.fn(() => ({})),
        fitBounds: vi.fn()
      }
    };
    const dashContainerA = makeStubContainer();
    const unmountA = await renderDashboard({ container: dashContainerA, services: dashServicesA, navigate: vi.fn() });
    await unmountA();

    expect(statusA.getSnapshotStatus().isStaleFallback).toBe(true);
    expect(statusA.getSnapshotStatus().snapshotSources).toEqual({
      fire_incidents_summary: "local",
      manifest: "local",
      medan_districts_osm: "local"
    });
    expect((await statusA.getManifest()).manifest.sourceTag).toBe("local-manifest");

    // Case B: stale manifest on Supabase + new summary on Supabase -> trips on manifest, never reads remote summary
    const mixedCaseBSupabase = createSnapshotBackedSupabaseClient({
      manifest: { payload: createLegacyManifestSnapshot(), dataset_status: "verified" },
      fire_incidents_summary: { payload: createCompleteSummarySnapshot({ sourceTag: "remote-summary" }), dataset_status: "verified" },
      medan_districts_osm: { payload: remoteGeo, dataset_status: "fallback_osm" }
    });
    const statusB = createDataStatusService("/data", mixedCaseBSupabase);
    expect((await statusB.getManifest()).manifest.sourceTag).toBe("local-manifest");
    expect((await statusB.fetchJson("fire_incidents_summary.json")).sourceTag).toBe("local-summary");
    expect((await statusB.fetchJson("medan_districts_osm.geojson")).sourceTag).toBeUndefined();
    expect(mixedCaseBSupabase.client.from).toHaveBeenCalledTimes(1);
    expect(statusB.getSnapshotStatus().snapshotSources).toEqual({
      manifest: "local",
      fire_incidents_summary: "local",
      medan_districts_osm: "local"
    });
  });

  it("renders Dashboard and About purely from Supabase when complete PR #6 snapshots are present online", async () => {
    const completeSnapshots = {
      manifest: { payload: createCompleteManifestSnapshot(), dataset_status: "verified" },
      fire_incidents_summary: { payload: createCompleteSummarySnapshot(), dataset_status: "verified" },
      medan_districts_osm: { payload: readPublicJson("medan_districts_osm.geojson"), dataset_status: "fallback_osm" }
    };
    const supabase = createSnapshotBackedSupabaseClient(completeSnapshots, []);
    const fetchMock = vi.fn(() => {
      throw new Error("Should not call local fetch when complete Supabase snapshots are active");
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataStatus = createDataStatusService("/data", supabase);
    const services = {
      supabase,
      dataStatus,
      format: formatters,
      maps: {
        createMap: () => ({ map: {}, destroy: vi.fn() }),
        addGeoJson: vi.fn(() => ({})),
        fitBounds: vi.fn()
      }
    };

    const dashContainer = makeStubContainer();
    const unmountDash = await renderDashboard({ container: dashContainer, services, navigate: vi.fn() });
    await unmountDash();
    expect(dashContainer.innerHTML).toContain("100% (target 100%)");
    expect(dashContainer.innerHTML).toContain("13.10 mnt (target 15.00 mnt)");
    expect(dashContainer.innerHTML).toContain("2.218");

    const aboutContainer = makeStubContainer();
    await renderAbout({ container: aboutContainer, services, navigate: vi.fn() });
    expect(aboutContainer.innerHTML).toContain("Pengayaan Kandidat Independen (Belum Terverifikasi)");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dataStatus.getSnapshotStatus().mode).toBe("supabase");
  });

  it("rejects non-finite or non-numeric SPM values in validateSnapshotPayload and triggers fallback", async () => {
    const valid = createCompleteSummarySnapshot();
    expect(validateSnapshotPayload("fire_incidents_summary", valid).valid).toBe(true);

    const brokenSpmCases = [
      [{ ...valid.damkarmat_spm[0] }, { ...valid.damkarmat_spm[1], realization_value: "13.10" }],
      [{ ...valid.damkarmat_spm[0] }, { ...valid.damkarmat_spm[1], realization_value: null }],
      [{ ...valid.damkarmat_spm[0] }, { ...valid.damkarmat_spm[1], realization_value: Number.NaN }],
      [{ ...valid.damkarmat_spm[0] }, { ...valid.damkarmat_spm[1], realization_value: Number.POSITIVE_INFINITY }],
      [{ ...valid.damkarmat_spm[0], target_value: undefined }, { ...valid.damkarmat_spm[1] }],
      [{ ...valid.damkarmat_spm[0] }, { ...valid.damkarmat_spm[1], target_value: "15.00" }]
    ];

    for (const badSpm of brokenSpmCases) {
      const res = validateSnapshotPayload("fire_incidents_summary", {
        ...valid,
        damkarmat_spm: badSpm
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("damkarmat_spm");
    }

    const localManifest = createCompleteManifestSnapshot();
    const localSummary = createCompleteSummarySnapshot();
    const fetchMock = vi.fn(async (url) => {
      if (url === "/data/manifest.json") return { ok: true, json: async () => localManifest };
      if (url === "/data/fire_incidents_summary.json") return { ok: true, json: async () => localSummary };
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const badSpmSupa = createSnapshotBackedSupabaseClient({
      manifest: { payload: localManifest, dataset_status: "verified" },
      fire_incidents_summary: {
        payload: { ...valid, damkarmat_spm: brokenSpmCases[0] },
        dataset_status: "verified"
      }
    });
    const dataStatus = createDataStatusService("/data", badSpmSupa);
    await dataStatus.getManifest();
    const summary = await dataStatus.fetchJson("fire_incidents_summary.json");
    expect(summary.damkarmat_spm[1].realization_value).toBe(13.1);
    expect(dataStatus.getSnapshotStatus()).toMatchObject({
      mode: "local_fallback_stale",
      isFallback: true,
      isStaleFallback: true
    });
  });

  it("handles transient non-stale local_fallback coherently without mixing Supabase and local snapshots and handles failed local manifest reload without TypeError", async () => {
    const localManifest = createCompleteManifestSnapshot({ sourceTag: "local-manifest" });
    const localSummary = createCompleteSummarySnapshot({ sourceTag: "local-summary" });
    const localGeo = readPublicJson("medan_districts_osm.geojson");
    const remoteGeo = { ...localGeo, features: [] };

    function makeQueuedSupabase(handlersByKey) {
      const from = vi.fn(() => {
        let requestedKey = null;
        const query = {
          select: () => query,
          eq: (_col, key) => {
            requestedKey = key;
            return query;
          },
          maybeSingle: async () => handlersByKey[requestedKey]()
        };
        return query;
      });
      return {
        isConfigured: true,
        statusLabel: "Terhubung ke Supabase",
        note: "Terhubung.",
        client: { from }
      };
    }

    // 1. manifest succeeds from Supabase, summary returns error -> coherent local_fallback across Dashboard
    const fetchOkMock = vi.fn(async (url) => {
      if (url === "/data/manifest.json") return { ok: true, json: async () => localManifest };
      if (url === "/data/fire_incidents_summary.json") return { ok: true, json: async () => localSummary };
      if (url === "/data/medan_districts_osm.geojson") return { ok: true, json: async () => localGeo };
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchOkMock);

    const errorSupa = makeQueuedSupabase({
      manifest: async () => ({ data: { payload: createCompleteManifestSnapshot({ sourceTag: "remote-manifest" }) }, error: null }),
      fire_incidents_summary: async () => ({ data: null, error: { message: "statement timeout on summary" } }),
      medan_districts_osm: async () => ({ data: { payload: remoteGeo }, error: null })
    });
    const statusErr = createDataStatusService("/data", errorSupa);
    const dashContainerErr = makeStubContainer();
    const unmountErr = await renderDashboard({
      container: dashContainerErr,
      services: {
        supabase: errorSupa,
        dataStatus: statusErr,
        format: formatters,
        maps: {
          createMap: () => ({ map: {}, destroy: vi.fn() }),
          addGeoJson: vi.fn(() => ({})),
          fitBounds: vi.fn()
        }
      },
      navigate: vi.fn()
    });
    await unmountErr();

    expect(statusErr.getSnapshotStatus()).toMatchObject({
      mode: "local_fallback",
      isFallback: true,
      isStaleFallback: false,
      reason: "statement timeout on summary",
      snapshotSources: {
        manifest: "local",
        fire_incidents_summary: "local",
        medan_districts_osm: "local"
      }
    });
    // GeoJSON must not hit Supabase once local fallback tripped
    expect(errorSupa.client.from).toHaveBeenCalledTimes(2);
    expect((await statusErr.getManifest()).manifest.sourceTag).toBe("local-manifest");
    expect(dashContainerErr.innerHTML).toContain("13.10 mnt (target 15.00 mnt)");

    // 2. manifest and summary succeed from Supabase, GeoJSON missing -> Dashboard reloads BOTH manifest & summary locally
    const geoMissSupa = makeQueuedSupabase({
      manifest: async () => ({ data: { payload: createCompleteManifestSnapshot({ sourceTag: "remote-manifest" }) }, error: null }),
      fire_incidents_summary: async () => ({
        data: {
          payload: {
            ...createCompleteSummarySnapshot(),
            summary_totals: { ...localSummary.summary_totals, year_2025: 99999 }
          }
        },
        error: null
      }),
      medan_districts_osm: async () => ({ data: null, error: null })
    });
    const statusGeoMiss = createDataStatusService("/data", geoMissSupa);
    const dashContainerGeoMiss = makeStubContainer();
    const unmountGeoMiss = await renderDashboard({
      container: dashContainerGeoMiss,
      services: {
        supabase: geoMissSupa,
        dataStatus: statusGeoMiss,
        format: formatters,
        maps: {
          createMap: () => ({ map: {}, destroy: vi.fn() }),
          addGeoJson: vi.fn(() => ({})),
          fitBounds: vi.fn()
        }
      },
      navigate: vi.fn()
    });
    await unmountGeoMiss();

    expect(statusGeoMiss.getSnapshotStatus()).toMatchObject({
      mode: "local_fallback",
      isFallback: true,
      isStaleFallback: false,
      snapshotSources: {
        manifest: "local",
        fire_incidents_summary: "local",
        medan_districts_osm: "local"
      }
    });
    expect(statusGeoMiss.getSnapshotStatus().reason).toContain("medan_districts_osm");
    expect(dashContainerGeoMiss.innerHTML).not.toContain("99.999");

    // 3. manifest reload fails with HTTP 503 after fallback -> renders error panel instead of TypeError
    function makeElement(tagName) {
      const el = {
        tagName,
        className: "",
        textContent: "",
        attributes: {},
        children: [],
        setAttribute: (k, v) => {
          el.attributes[k] = v;
        },
        append: (...nodes) => el.children.push(...nodes),
        appendChild: (node) => el.children.push(node),
        addEventListener: vi.fn()
      };
      return el;
    }
    vi.stubGlobal("document", {
      createElement: (tag) => makeElement(tag),
      addEventListener: vi.fn(),
      activeElement: null
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url === "/data/fire_incidents_summary.json") return { ok: true, json: async () => localSummary };
        if (url === "/data/manifest.json") return { ok: false, status: 503 };
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const reloadFailSupa = makeQueuedSupabase({
      manifest: async () => ({ data: { payload: createCompleteManifestSnapshot() }, error: null }),
      fire_incidents_summary: async () => ({ data: null, error: { message: "upstream 504" } }),
      medan_districts_osm: async () => ({ data: { payload: localGeo }, error: null })
    });
    const statusReloadFail = createDataStatusService("/data", reloadFailSupa);
    let renderedErrorPanel = null;
    const errorDashContainer = {
      innerHTML: "",
      replaceChildren: vi.fn((node) => {
        renderedErrorPanel = node;
      })
    };
    const unmountReloadFail = await renderDashboard({
      container: errorDashContainer,
      services: {
        supabase: reloadFailSupa,
        dataStatus: statusReloadFail,
        format: formatters,
        maps: {
          createMap: () => ({ map: {}, destroy: vi.fn() }),
          addGeoJson: vi.fn(() => ({})),
          fitBounds: vi.fn()
        }
      },
      navigate: vi.fn()
    });
    await unmountReloadFail();

    expect(errorDashContainer.replaceChildren).toHaveBeenCalledTimes(1);
    expect(renderedErrorPanel.attributes["data-state-variant"]).toBe("error");
    expect(renderedErrorPanel.attributes.role).toBe("alert");
    const serializedPanel = JSON.stringify(renderedErrorPanel);
    expect(serializedPanel).toContain("Sebagian berkas spasial gagal dibaca");
    expect(serializedPanel).toContain("HTTP 503");
  });

  it("separates Supabase connection badge from active data source badge in header and About across supabase_pending, supabase, local, local_fallback, and local_fallback_stale", async () => {
    expect(describeActiveDataSource({ mode: "supabase_pending" })).toMatchObject({
      mode: "supabase_pending",
      badgeClass: "status-badge--local",
      label: "Sumber Data: Memeriksa..."
    });
    expect(describeActiveDataSource({ mode: "supabase" })).toMatchObject({
      mode: "supabase",
      badgeClass: "status-badge--active",
      label: "Sumber Data: Supabase Online"
    });
    expect(describeActiveDataSource({ mode: "local" })).toMatchObject({
      mode: "local",
      badgeClass: "status-badge--local",
      label: "Sumber Data: JSON Lokal"
    });
    expect(describeActiveDataSource({ mode: "local_fallback", reason: "query timeout" })).toMatchObject({
      mode: "local_fallback",
      badgeClass: "status-badge--dev",
      label: "Sumber Data: JSON Lokal (Fallback)",
      title: "query timeout"
    });
    expect(
      describeActiveDataSource({ mode: "local_fallback_stale", reason: "Snapshot Supabase usang" })
    ).toMatchObject({
      mode: "local_fallback_stale",
      badgeClass: "status-badge--dev",
      label: "Sumber Data: JSON Lokal (Fallback: Snapshot Supabase Usang)",
      title: "Snapshot Supabase usang"
    });

    function makeShellDomRoot() {
      const markerEl = { textContent: "" };
      const labelEl = { textContent: "" };
      const dataSourceBadge = {
        className: "",
        title: "",
        querySelector: (sel) => (sel === '[data-role="marker"]' ? markerEl : labelEl)
      };
      const stubBtn = { setAttribute: vi.fn(), addEventListener: vi.fn(), focus: vi.fn() };
      const stubSidebar = { classList: { toggle: vi.fn(), contains: () => false }, contains: () => false };
      return {
        dataSourceBadge,
        markerEl,
        labelEl,
        root: {
          innerHTML: "",
          querySelector: (sel) => {
            if (sel === "#mobile-menu-trigger" || sel === "#mobile-menu-close") return stubBtn;
            if (sel === "#app-sidebar") return stubSidebar;
            if (sel === "#sidebar-backdrop") return { hidden: true, addEventListener: vi.fn() };
            if (sel === "#route-outlet" || sel === "#app-notification") return {};
            if (sel === "#data-source-status-badge") return dataSourceBadge;
            return null;
          },
          querySelectorAll: () => []
        }
      };
    }

    vi.stubGlobal("document", { addEventListener: vi.fn(), activeElement: null });

    const localManifest = createCompleteManifestSnapshot();
    const localSummary = createCompleteSummarySnapshot();
    const fetchMock = vi.fn(async (url) => {
      if (url === "/data/manifest.json") return { ok: true, json: async () => localManifest };
      if (url === "/data/fire_incidents_summary.json") return { ok: true, json: async () => localSummary };
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // 1. Mode local (Supabase unconfigured)
    const localSupa = {
      isConfigured: false,
      client: null,
      statusLabel: "Mode Lokal (tanpa Supabase)",
      note: "Menggunakan JSON lokal."
    };
    const localDataStatus = createDataStatusService("/data", localSupa);
    const localShellDom = makeShellDomRoot();
    const localShell = createShellLayout(localShellDom.root, localSupa, localDataStatus.getSnapshotStatus());
    localDataStatus.subscribe((s) => localShell.updateDataSourceStatus(s));
    expect(localShellDom.root.innerHTML).toContain("Koneksi: Mode Lokal (tanpa Supabase)");
    await localDataStatus.getManifest();
    expect(localShellDom.labelEl.textContent).toBe("Sumber Data: JSON Lokal");
    expect(localShellDom.dataSourceBadge.className).toContain("status-badge--local");

    // 2. Mode supabase_pending -> supabase (complete snapshots online)
    const onlineSupa = createSnapshotBackedSupabaseClient({
      manifest: { payload: localManifest, dataset_status: "verified" },
      fire_incidents_summary: { payload: localSummary, dataset_status: "verified" }
    });
    const onlineDataStatus = createDataStatusService("/data", onlineSupa);
    const onlineShellDom = makeShellDomRoot();
    const onlineShell = createShellLayout(onlineShellDom.root, onlineSupa, onlineDataStatus.getSnapshotStatus());
    onlineDataStatus.subscribe((s) => onlineShell.updateDataSourceStatus(s));
    expect(onlineShellDom.root.innerHTML).toContain("Koneksi: Terhubung ke Supabase");
    expect(onlineShellDom.root.innerHTML).toContain("Sumber Data: Memeriksa...");
    await onlineDataStatus.getManifest();
    await onlineDataStatus.fetchJson("fire_incidents_summary.json");
    expect(onlineShellDom.labelEl.textContent).toBe("Sumber Data: Supabase Online");
    expect(onlineShellDom.dataSourceBadge.className).toContain("status-badge--active");

    // 3. Mode local_fallback_stale (Supabase connected, remote summary stale)
    const staleSupa = createSnapshotBackedSupabaseClient({
      manifest: { payload: createCompleteManifestSnapshot(), dataset_status: "verified" },
      fire_incidents_summary: { payload: createLegacySummarySnapshot(), dataset_status: "verified" }
    });
    const staleDataStatus = createDataStatusService("/data", staleSupa);
    const staleShellDom = makeShellDomRoot();
    const staleShell = createShellLayout(staleShellDom.root, staleSupa, staleDataStatus.getSnapshotStatus());
    staleDataStatus.subscribe((s) => staleShell.updateDataSourceStatus(s));
    await staleDataStatus.getManifest();
    await staleDataStatus.fetchJson("fire_incidents_summary.json");

    expect(staleShellDom.root.innerHTML).toContain("Koneksi: Terhubung ke Supabase");
    expect(staleShellDom.labelEl.textContent).toBe(
      "Sumber Data: JSON Lokal (Fallback: Snapshot Supabase Usang)"
    );
    expect(staleShellDom.dataSourceBadge.className).toContain("status-badge--dev");
    expect(staleShellDom.dataSourceBadge.title).toContain("stale/incomplete");

    const staleAboutContainer = makeStubContainer();
    await renderAbout({
      container: staleAboutContainer,
      services: { supabase: staleSupa, dataStatus: staleDataStatus, format: formatters },
      navigate: vi.fn()
    });
    expect(staleAboutContainer.innerHTML).toContain("Koneksi: Terhubung ke Supabase");
    const staleNoteMatch = staleAboutContainer.innerHTML.match(/id="about-active-source-note">[\s\S]*?<\/p>/);
    expect(staleNoteMatch?.[0]).toContain("Sumber Data: JSON Lokal (Fallback: Snapshot Supabase Usang)");
    expect(staleNoteMatch?.[0]).toContain("stale/incomplete");

    // 4. Mode local_fallback (Supabase connected, remote query error)
    const { service: nonStaleErrBaseSupa } = createSupabaseService({
      data: null,
      error: { message: "query timeout on summary" }
    });
    const nonStaleErrSupa = {
      ...nonStaleErrBaseSupa,
      statusLabel: "Terhubung ke Supabase",
      note: "Koneksi Supabase aktif."
    };
    const nonStaleDataStatus = createDataStatusService("/data", nonStaleErrSupa);
    const nonStaleShellDom = makeShellDomRoot();
    const nonStaleShell = createShellLayout(
      nonStaleShellDom.root,
      nonStaleErrSupa,
      nonStaleDataStatus.getSnapshotStatus()
    );
    nonStaleDataStatus.subscribe((s) => nonStaleShell.updateDataSourceStatus(s));
    await nonStaleDataStatus.getManifest();
    await nonStaleDataStatus.fetchJson("fire_incidents_summary.json");

    expect(nonStaleShellDom.root.innerHTML).toContain("Koneksi: Terhubung ke Supabase");
    expect(nonStaleShellDom.labelEl.textContent).toBe("Sumber Data: JSON Lokal (Fallback)");
    expect(nonStaleShellDom.dataSourceBadge.className).toContain("status-badge--dev");
    expect(nonStaleShellDom.dataSourceBadge.title).toContain("query timeout on summary");

    const nonStaleAboutContainer = makeStubContainer();
    await renderAbout({
      container: nonStaleAboutContainer,
      services: { supabase: nonStaleErrSupa, dataStatus: nonStaleDataStatus, format: formatters },
      navigate: vi.fn()
    });
    expect(nonStaleAboutContainer.innerHTML).toContain("Koneksi: Terhubung ke Supabase");
    const fallbackNoteMatch = nonStaleAboutContainer.innerHTML.match(
      /id="about-active-source-note">[\s\S]*?<\/p>/
    );
    expect(fallbackNoteMatch?.[0]).toContain("Sumber Data: JSON Lokal (Fallback)");
    expect(fallbackNoteMatch?.[0]).toContain("query timeout on summary");
  });
});
