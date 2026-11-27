import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResponseAudioController } from "../../src/features/incident-explorer/response-audio.js";
import {
  SIMULATION_ASSUMED_SPEED_KMH,
  buildAdjacencyList,
  findDistrictForPoint,
  findNearestGraphNodes,
  findShortestNetworkRoute,
  getEligibleSimulationStations,
  planFireResponseScenario,
  wgs84ToUtm47n
} from "../../src/features/incident-explorer/response-router.js";

function loadJson(relPath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8"));
}

function makeNode(lon, lat) {
  const [e, n] = wgs84ToUtm47n(lon, lat);
  return [lon, lat, e, n];
}

function makeSyntheticDistricts() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { area_code: "12.71.01", district_name: "Medan Petisah" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [98.64, 3.57],
              [98.7, 3.57],
              [98.7, 3.61],
              [98.64, 3.61],
              [98.64, 3.57]
            ]
          ]
        }
      }
    ]
  };
}

describe("response-router", () => {
  it("excludes district_only stations with geom = null from simulation routing", () => {
    const summary = loadJson("public/data/fire_incidents_summary.json");
    const { eligible, excluded } = getEligibleSimulationStations({
      verifiedStations: summary.verified_stations,
      candidateStations: summary.candidate_stations.stations,
      includeCandidates: true
    });

    expect(eligible.map((s) => s.station_code)).toEqual(["MAKO-00", "UPT-01", "UPT-02", "UPT-05", "UPT-06"]);
    expect(excluded.map((s) => s.station_code)).toEqual(["UPT-03", "UPT-04"]);
    expect(excluded.every((s) => s.location_accuracy === "district_only")).toBe(true);

    const verifiedOnly = getEligibleSimulationStations({
      verifiedStations: summary.verified_stations,
      candidateStations: summary.candidate_stations.stations,
      includeCandidates: false
    });
    expect(verifiedOnly.eligible.map((s) => s.station_code)).toEqual(["MAKO-00"]);
    expect(verifiedOnly.excluded.length).toBe(6);
  });

  it("enforces directed oneway edges in Dijkstra and prefers longer valid route when shortcut is one-way reverse", () => {
    const graph = {
      nodes: [
        makeNode(98.65, 3.58), // 0: start
        makeNode(98.68, 3.58), // 1: target
        makeNode(98.665, 3.595) // 2: detour vertex
      ],
      road_names: ["Jl. Searah Barat", "Jl. Memutar Utara", "Jl. Penghubung Timur"],
      edges: [
        // Reverse-only from 0 -> 1 (dirCode 2 means 1 -> 0 only!), short 200 m
        [0, 1, 200, 2, 1, 0, []],
        // Valid two-way detour 0 -> 2 -> 1 (650 m + 750 m = 1400 m)
        [0, 2, 650, 0, 2, 1, [98.658, 3.588]],
        [2, 1, 750, 1, 2, 2, [98.672, 3.588]]
      ]
    };

    const adj = buildAdjacencyList(graph);
    const route = findShortestNetworkRoute(graph, adj, 0, 1);
    expect(route.found).toBe(true);
    expect(route.distanceM).toBe(1400);
    expect(route.nodePath).toEqual([0, 2, 1]);
    expect(route.polylineLatLng.length).toBe(5);
    expect(route.roadNames).toEqual(["Jl. Memutar Utara", "Jl. Penghubung Timur"]);

    // Going from 1 -> 0 uses the valid oneway edge 1 -> 0 of 200 m
    const reverseRoute = findShortestNetworkRoute(graph, adj, 1, 0);
    expect(reverseRoute.found).toBe(true);
    expect(reverseRoute.distanceM).toBe(200);
  });

  it("rejects coordinates outside Medan and reports disconnected or missing road graph cleanly", () => {
    const districts = makeSyntheticDistricts();
    const outside = planFireResponseScenario({
      targetLon: 98.84,
      targetLat: 3.545,
      districtsGeoJson: districts,
      graph: null,
      adj: null
    });
    expect(outside.ok).toBe(false);
    expect(outside.code).toBe("OUTSIDE_MEDAN");

    const missingGraph = planFireResponseScenario({
      targetLon: 98.67,
      targetLat: 3.59,
      districtsGeoJson: districts,
      graph: { nodes: [], edges: [] },
      adj: []
    });
    expect(missingGraph.ok).toBe(false);
    expect(missingGraph.code).toBe("GRAPH_UNAVAILABLE");

    // Disconnected / unreachable target due to one-way street
    const disconnectedGraph = {
      nodes: [makeNode(98.65, 3.58), makeNode(98.69, 3.6)],
      road_names: ["Jl. Satu Arah Keluar Target"],
      edges: [[1, 0, 500, 1, 1, 0, []]]
    };
    const disconnectedPlan = planFireResponseScenario({
      targetLon: 98.69,
      targetLat: 3.6,
      districtsGeoJson: districts,
      graph: disconnectedGraph,
      adj: buildAdjacencyList(disconnectedGraph),
      verifiedStations: [{ station_code: "MAKO-00", name: "Mako", lat: 3.58, lon: 98.65 }]
    });
    expect(disconnectedPlan.ok).toBe(false);
    expect(disconnectedPlan.code).toBe("ROUTE_NOT_FOUND");
  });

  it("routes inside real Medan OSM road graph with EPSG:32647 distance >= Euclidean and toggles candidate UPTs", () => {
    const districts = loadJson("public/data/medan_districts_osm.geojson");
    const graph = loadJson("public/data/medan_road_graph.json");
    const summary = loadJson("public/data/fire_incidents_summary.json");
    const adj = buildAdjacencyList(graph);

    expect(findDistrictForPoint(98.84, 3.545, districts).inside).toBe(false);
    expect(findDistrictForPoint(98.6412, 3.6025, districts)).toMatchObject({
      inside: true,
      district_name: "Medan Helvetia"
    });

    const nearHelvetia = findNearestGraphNodes(98.6412, 3.6025, graph, { maxSnapMeters: 500, limit: 1 });
    expect(nearHelvetia.length).toBe(1);

    const planWithCandidates = planFireResponseScenario({
      targetLon: 98.6412,
      targetLat: 3.6025,
      districtsGeoJson: districts,
      graph,
      adj,
      verifiedStations: summary.verified_stations,
      candidateStations: summary.candidate_stations.stations,
      includeCandidates: true
    });

    expect(planWithCandidates.ok).toBe(true);
    expect(planWithCandidates.station.station_code).toBe("UPT-05");
    expect(planWithCandidates.station.verification_status).toBe("needs_review");
    expect(planWithCandidates.route.polylineLatLng.length).toBeGreaterThanOrEqual(4);
    expect(planWithCandidates.route.assumedSpeedKmh).toBe(SIMULATION_ASSUMED_SPEED_KMH);

    // Network distance must exceed or equal Euclidean straight-line distance in UTM47N
    const [sx, sy] = wgs84ToUtm47n(
      graph.nodes[findNearestGraphNodes(planWithCandidates.station.lon, planWithCandidates.station.lat, graph)[0].nodeIdx][0],
      graph.nodes[findNearestGraphNodes(planWithCandidates.station.lon, planWithCandidates.station.lat, graph)[0].nodeIdx][1]
    );
    const [tx, ty] = wgs84ToUtm47n(
      graph.nodes[nearHelvetia[0].nodeIdx][0],
      graph.nodes[nearHelvetia[0].nodeIdx][1]
    );
    expect(planWithCandidates.route.distanceM).toBeGreaterThanOrEqual(Math.hypot(tx - sx, ty - sy) - 1);

    const planVerifiedOnly = planFireResponseScenario({
      targetLon: 98.6412,
      targetLat: 3.6025,
      districtsGeoJson: districts,
      graph,
      adj,
      verifiedStations: summary.verified_stations,
      candidateStations: summary.candidate_stations.stations,
      includeCandidates: false
    });
    expect(planVerifiedOnly.ok).toBe(true);
    expect(planVerifiedOnly.station.station_code).toBe("MAKO-00");
    expect(planVerifiedOnly.station.verification_status).toBe("verified");
  });
});

describe("response-audio", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("starts muted with zero autoplay and degrades cleanly when AudioContext is absent", () => {
    globalThis.window = {};
    const audio = createResponseAudioController();
    expect(audio.isSupported()).toBe(false);
    expect(audio.isMuted()).toBe(true);

    audio.setPhase("en_route");
    audio.setMuted(false);
    audio.pause();
    audio.resume();
    audio.stop();
    audio.destroy();
  });

  it("never constructs AudioContext while muted and cleans up nodes on destroy", () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const stopSpy = vi.fn();
    const disconnectSpy = vi.fn();
    const FakeNode = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: vi.fn() },
      Q: { value: 0 },
      gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: disconnectSpy,
      start: vi.fn(),
      stop: stopSpy
    });
    const ctorSpy = vi.fn(function MockAudioContext() {
      return {
        state: "running",
        sampleRate: 44100,
        currentTime: 0,
        destination: {},
        createGain: FakeNode,
        createOscillator: FakeNode,
        createBiquadFilter: FakeNode,
        createBufferSource: FakeNode,
        createBuffer: () => ({ getChannelData: () => new Float32Array(44100 * 2) }),
        resume: vi.fn().mockResolvedValue(undefined),
        close: closeSpy
      };
    });
    globalThis.window = { AudioContext: ctorSpy };

    const audio = createResponseAudioController();
    expect(audio.isSupported()).toBe(true);
    expect(audio.isMuted()).toBe(true);

    audio.setPhase("en_route");
    expect(ctorSpy).toHaveBeenCalledTimes(0);

    audio.setMuted(false);
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    audio.setPhase("extinguishing", 0.7);
    audio.setPhase("completed", 0);
    audio.pause();
    audio.resume();
    audio.destroy();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
