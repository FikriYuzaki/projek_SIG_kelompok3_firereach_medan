/**
 * Road-network routing and spatial validation engine for Damkarmat Response Simulation.
 *
 * Uses WGS 84 / UTM Zone 47N (EPSG:32647) for metric snapping and distance math,
 * respects OSM `oneway` directions (`F`, `B`, `BOTH`) and pre-filtered `access`/`motor_vehicle`
 * drivable edges from `public/data/medan_road_graph.json`, and strictly excludes
 * `district_only` / `geom = null` stations from routing.
 */

export const SIMULATION_ASSUMED_SPEED_KMH = 35;

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
const UTM47N_LON0_RAD = (99 * Math.PI) / 180;
const UTM_K0 = 0.9996;
const UTM_E0 = 500000.0;

/**
 * Project [lon, lat] (EPSG:4326) to [easting, northing] in meters (EPSG:32647).
 */
export function wgs84ToUtm47n(lon, lat) {
  const phi = (Number(lat) * Math.PI) / 180;
  const lam = (Number(lon) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = WGS84_EP2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - UTM47N_LON0_RAD);

  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * Math.pow(WGS84_E2, 3)) / 256) * phi -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 * WGS84_E2) / 32 + (45 * Math.pow(WGS84_E2, 3)) / 1024) * Math.sin(2 * phi) +
      ((15 * WGS84_E2 * WGS84_E2) / 256 + (45 * Math.pow(WGS84_E2, 3)) / 1024) * Math.sin(4 * phi) -
      ((35 * Math.pow(WGS84_E2, 3)) / 3072) * Math.sin(6 * phi));

  const easting =
    UTM_E0 +
    UTM_K0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * Math.pow(A, 5)) / 120);

  const northing =
    UTM_K0 *
    (M +
      N *
        tanPhi *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * Math.pow(A, 6)) / 720));

  return [easting, northing];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(lon, lat, coords) {
  if (!Array.isArray(coords) || coords.length === 0) return false;
  if (!pointInRing(lon, lat, coords[0])) return false;
  for (let h = 1; h < coords.length; h++) {
    if (pointInRing(lon, lat, coords[h])) return false;
  }
  return true;
}

/**
 * Validate whether [lon, lat] falls inside one of the 21 Kota Medan district polygons.
 */
export function findDistrictForPoint(lon, lat, districtsGeoJson) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { inside: false, district_name: null, area_code: null };
  }
  const features = districtsGeoJson?.features || [];
  for (const feat of features) {
    const geom = feat?.geometry;
    if (!geom) continue;
    let matched = false;
    if (geom.type === "Polygon") {
      matched = pointInPolygonCoords(lon, lat, geom.coordinates);
    } else if (geom.type === "MultiPolygon") {
      matched = (geom.coordinates || []).some((poly) => pointInPolygonCoords(lon, lat, poly));
    }
    if (matched) {
      return {
        inside: true,
        district_name: feat.properties?.district_name || null,
        area_code: feat.properties?.area_code || null
      };
    }
  }
  return { inside: false, district_name: null, area_code: null };
}

/**
 * Partition stations into routable simulation candidates vs excluded unlocated records.
 * `district_only` stations or those with `geom === null` are strictly excluded from routing.
 */
export function getEligibleSimulationStations({
  verifiedStations = [],
  candidateStations = [],
  includeCandidates = true
} = {}) {
  const eligible = [];
  const excluded = [];

  for (const st of verifiedStations || []) {
    if (!st || st.isDemo) continue;
    const lat = Number(st.lat);
    const lon = Number(st.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      excluded.push({ ...st, excludeReason: "Koordinat pos tidak tersedia" });
      continue;
    }
    eligible.push({
      station_code: st.station_code,
      name: st.name,
      station_type: st.station_type || "mako",
      address: st.address || "-",
      district_name: st.district_name || "Medan Petisah",
      lat,
      lon,
      location_accuracy: st.location_accuracy || "exact_verified",
      verification_status: "verified",
      source_name: st.source_name || "Satu Data Medan",
      source_url: st.source_url || "",
      isCandidate: false
    });
  }

  for (const st of candidateStations || []) {
    if (!st || st.isDemo) continue;
    const acc = String(st.location_accuracy || "unknown");
    const hasPoint =
      acc === "approximate" &&
      st.geom &&
      st.geom.type === "Point" &&
      Number.isFinite(Number(st.lat)) &&
      Number.isFinite(Number(st.lon));

    if (!hasPoint) {
      excluded.push({
        station_code: st.station_code,
        name: st.name,
        district_name: st.district_name || "-",
        location_accuracy: acc,
        verification_status: st.verification_status || "needs_review",
        excludeReason:
          acc === "district_only"
            ? "Status district_only (geom = null); dilarang dipakai untuk routing titik"
            : "Tidak memiliki geometri titik valid"
      });
      continue;
    }

    if (!includeCandidates) {
      excluded.push({
        station_code: st.station_code,
        name: st.name,
        district_name: st.district_name || "-",
        location_accuracy: acc,
        verification_status: st.verification_status || "needs_review",
        excludeReason: "Mode hanya pos terverifikasi aktif (kandidat needs_review dinonaktifkan)"
      });
      continue;
    }

    eligible.push({
      station_code: st.station_code,
      name: st.name,
      station_type: st.station_type || "upt",
      address: st.address || "-",
      district_name: st.district_name || "-",
      lat: Number(st.lat),
      lon: Number(st.lon),
      location_accuracy: acc,
      verification_status: st.verification_status || "needs_review",
      source_name: st.source_name || "Sumber Publik",
      source_url: st.source_url || "",
      osm_ref: st.osm_ref || null,
      isCandidate: true
    });
  }

  return { eligible, excluded };
}

/**
 * Build directed adjacency list from compact graph JSON, honoring oneway codes:
 * `0 = BOTH`, `1 = F (u -> v)`, `2 = B (v -> u)`.
 */
export function buildAdjacencyList(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const adj = Array.from({ length: nodes.length }, () => []);

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const u = e[0];
    const v = e[1];
    const lengthM = Number(e[2]);
    const dirCode = e[3];
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;
    if (dirCode === 0 || dirCode === 1) {
      adj[u].push({ to: v, weight: lengthM, edgeIdx: ei, reverse: false });
    }
    if (dirCode === 0 || dirCode === 2) {
      adj[v].push({ to: u, weight: lengthM, edgeIdx: ei, reverse: true });
    }
  }
  return adj;
}

/**
 * Snap a WGS84 point to the closest road graph nodes in EPSG:32647 metric meters.
 */
export function findNearestGraphNodes(lon, lat, graph, { maxSnapMeters = 1500, limit = 5 } = {}) {
  const nodes = graph?.nodes || [];
  if (!nodes.length) return [];
  const [qx, qy] = wgs84ToUtm47n(lon, lat);
  const candidates = [];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const distM = Math.hypot(n[2] - qx, n[3] - qy);
    if (distM <= maxSnapMeters) {
      candidates.push({
        nodeIdx: i,
        snapDistanceM: Math.round(distM * 10) / 10,
        coord: [n[0], n[1]]
      });
    }
  }

  candidates.sort((a, b) => a.snapDistanceM - b.snapDistanceM);
  return candidates.slice(0, limit);
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(item) {
    this.items.push(item);
    let idx = this.items.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.items[parent][0] <= this.items[idx][0]) break;
      const tmp = this.items[parent];
      this.items[parent] = this.items[idx];
      this.items[idx] = tmp;
      idx = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let idx = 0;
      const len = this.items.length;
      while (true) {
        let smallest = idx;
        const left = 2 * idx + 1;
        const right = 2 * idx + 2;
        if (left < len && this.items[left][0] < this.items[smallest][0]) smallest = left;
        if (right < len && this.items[right][0] < this.items[smallest][0]) smallest = right;
        if (smallest === idx) break;
        const tmp = this.items[idx];
        this.items[idx] = this.items[smallest];
        this.items[smallest] = tmp;
        idx = smallest;
      }
    }
    return top;
  }
}

/**
 * Shortest-path Dijkstra from startNodeIdx to endNodeIdx.
 */
export function findShortestNetworkRoute(graph, adj, startNodeIdx, endNodeIdx) {
  const n = graph?.nodes?.length || 0;
  if (!n || startNodeIdx < 0 || endNodeIdx < 0 || startNodeIdx >= n || endNodeIdx >= n) {
    return { found: false, distanceM: Infinity, polylineLatLng: [], roadNames: [] };
  }

  if (startNodeIdx === endNodeIdx) {
    const pt = graph.nodes[startNodeIdx];
    return {
      found: true,
      distanceM: 0,
      nodePath: [startNodeIdx],
      edgeSteps: [],
      polylineLatLng: [[pt[1], pt[0]]],
      roadNames: []
    };
  }

  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const prevNode = new Int32Array(n);
  prevNode.fill(-1);
  const prevEdge = new Int32Array(n);
  prevEdge.fill(-1);
  const prevRev = new Uint8Array(n);

  dist[startNodeIdx] = 0;
  const heap = new MinHeap();
  heap.push([0, startNodeIdx]);

  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (u === endNodeIdx) break;
    if (d > dist[u]) continue;
    const neighbors = adj[u] || [];
    for (let i = 0; i < neighbors.length; i++) {
      const edge = neighbors[i];
      const nd = d + edge.weight;
      if (nd < dist[edge.to]) {
        dist[edge.to] = nd;
        prevNode[edge.to] = u;
        prevEdge[edge.to] = edge.edgeIdx;
        prevRev[edge.to] = edge.reverse ? 1 : 0;
        heap.push([nd, edge.to]);
      }
    }
  }

  if (!Number.isFinite(dist[endNodeIdx])) {
    return { found: false, distanceM: Infinity, polylineLatLng: [], roadNames: [] };
  }

  const edgeSteps = [];
  const nodePath = [endNodeIdx];
  let cur = endNodeIdx;
  while (cur !== startNodeIdx) {
    const pn = prevNode[cur];
    if (pn < 0) break;
    edgeSteps.push({ edgeIdx: prevEdge[cur], reverse: prevRev[cur] === 1 });
    nodePath.push(pn);
    cur = pn;
  }
  edgeSteps.reverse();
  nodePath.reverse();

  const nodes = graph.nodes;
  const edges = graph.edges;
  const roadNamesDict = graph.road_names || [];
  const polylineLatLng = [[nodes[nodePath[0]][1], nodes[nodePath[0]][0]]];
  const roadNames = [];

  for (const step of edgeSteps) {
    const e = edges[step.edgeIdx];
    const nameStr = roadNamesDict[e[5]] || "";
    if (nameStr && roadNames[roadNames.length - 1] !== nameStr) {
      roadNames.push(nameStr);
    }
    const shape = e[6];
    if (Array.isArray(shape) && shape.length >= 2) {
      if (!step.reverse) {
        for (let k = 0; k < shape.length; k += 2) {
          polylineLatLng.push([shape[k + 1], shape[k]]);
        }
      } else {
        for (let k = shape.length - 2; k >= 0; k -= 2) {
          polylineLatLng.push([shape[k + 1], shape[k]]);
        }
      }
    }
    const destNode = step.reverse ? nodes[e[0]] : nodes[e[1]];
    polylineLatLng.push([destNode[1], destNode[0]]);
  }

  return {
    found: true,
    distanceM: Math.round(dist[endNodeIdx] * 10) / 10,
    nodePath,
    edgeSteps,
    polylineLatLng,
    roadNames
  };
}

/**
 * Plan a complete scenario response from the nearest routable station along the OSM road network.
 */
export function planFireResponseScenario({
  targetLon,
  targetLat,
  districtsGeoJson,
  graph,
  adj,
  verifiedStations = [],
  candidateStations = [],
  includeCandidates = true,
  assumedSpeedKmh = SIMULATION_ASSUMED_SPEED_KMH
} = {}) {
  const districtCheck = findDistrictForPoint(targetLon, targetLat, districtsGeoJson);
  if (!districtCheck.inside) {
    return {
      ok: false,
      code: "OUTSIDE_MEDAN",
      message:
        "Titik api berada di luar batas administratif 21 kecamatan Kota Medan. Pilih lokasi di dalam Kota Medan."
    };
  }

  if (!graph?.nodes?.length || !graph?.edges?.length || !adj?.length) {
    return {
      ok: false,
      code: "GRAPH_UNAVAILABLE",
      message: "Graf jaringan jalan OSM belum dimuat atau tidak memiliki segmen jalan."
    };
  }

  const { eligible, excluded } = getEligibleSimulationStations({
    verifiedStations,
    candidateStations,
    includeCandidates
  });

  if (!eligible.length) {
    return {
      ok: false,
      code: "NO_ELIGIBLE_STATION",
      message: "Tidak ada pos skenario berkoordinat yang memenuhi syarat untuk simulasi rute.",
      excludedStations: excluded
    };
  }

  const targetSnaps = findNearestGraphNodes(targetLon, targetLat, graph, {
    maxSnapMeters: 1500,
    limit: 4
  });

  if (!targetSnaps.length) {
    return {
      ok: false,
      code: "TARGET_TOO_FAR_FROM_ROAD",
      message:
        "Titik yang dipilih terlalu jauh (> 1,5 km) dari jaringan jalan arteri/kolektor yang dimodelkan. Pilih titik lebih dekat ke jalan utama."
    };
  }

  let bestOption = null;
  let evaluatedCount = 0;

  for (const station of eligible) {
    const stationSnaps = findNearestGraphNodes(station.lon, station.lat, graph, {
      maxSnapMeters: 1000,
      limit: 3
    });
    if (!stationSnaps.length) continue;

    let bestForStation = null;
    for (const sSnap of stationSnaps) {
      for (const tSnap of targetSnaps) {
        const res = findShortestNetworkRoute(graph, adj, sSnap.nodeIdx, tSnap.nodeIdx);
        if (!res.found) continue;
        if (!bestForStation || res.distanceM < bestForStation.route.distanceM) {
          bestForStation = {
            station,
            startSnap: sSnap,
            endSnap: tSnap,
            route: res
          };
        }
        break;
      }
      if (bestForStation) break;
    }

    if (bestForStation) {
      evaluatedCount += 1;
      if (!bestOption || bestForStation.route.distanceM < bestOption.route.distanceM) {
        bestOption = bestForStation;
      }
    }
  }

  if (!bestOption) {
    return {
      ok: false,
      code: "ROUTE_NOT_FOUND",
      message:
        "Tidak ditemukan rute jalan searah yang terhubung dari pos skenario ke titik api yang dipilih.",
      excludedStations: excluded
    };
  }

  const rawDistM = Math.max(1, bestOption.route.distanceM);
  const distanceKm = Math.round((rawDistM / 1000) * 100) / 100;
  const scenarioMinutes = Math.round(((rawDistM / 1000) / assumedSpeedKmh) * 60 * 10) / 10;

  // Prepend station coordinate and append exact picked target coordinate for visual continuity
  const fullPolyline = [
    [bestOption.station.lat, bestOption.station.lon],
    ...bestOption.route.polylineLatLng,
    [targetLat, targetLon]
  ];

  return {
    ok: true,
    target: {
      lat: targetLat,
      lon: targetLon,
      district_name: districtCheck.district_name,
      area_code: districtCheck.area_code,
      snapDistanceM: bestOption.endSnap.snapDistanceM
    },
    station: bestOption.station,
    route: {
      distanceM: rawDistM,
      distanceKm,
      scenarioMinutes,
      assumedSpeedKmh,
      startSnapM: bestOption.startSnap.snapDistanceM,
      endSnapM: bestOption.endSnap.snapDistanceM,
      polylineLatLng: fullPolyline,
      roadNames: bestOption.route.roadNames.slice(0, 8),
      segmentCount: bestOption.route.edgeSteps.length
    },
    excludedStations: excluded,
    evaluatedCount
  };
}
