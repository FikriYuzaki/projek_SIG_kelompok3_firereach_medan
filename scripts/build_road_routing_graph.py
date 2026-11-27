"""
Build compact, deterministic OSM road network routing graph for FireReach Medan.

Reads `data/interim/medan_roads_utm.gpkg` (EPSG:32647, already filtered for
drivable highways and excluding access=private/no & motor_vehicle=private/no),
splits ways at shared road intersections, preserves exact EPSG:32647 metric
edge lengths and oneway directions ('F', 'B', 'BOTH'), simplifies intermediate
geometry vertices in metric CRS, extracts the largest weakly connected
component, and exports `public/data/medan_road_graph.json` and
`data/processed/medan_road_graph.json`.

Run with QGIS Python:
  "C:/Program Files/QGIS 3.44.13/bin/python-qgis-ltr.bat" scripts/build_road_routing_graph.py
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
import hashlib
import heapq
import json
import math
from pathlib import Path
import shutil
import sys

from osgeo import ogr, osr

REPO_ROOT = Path(__file__).resolve().parents[1]
ROADS_GPKG = REPO_ROOT / "data" / "interim" / "medan_roads_utm.gpkg"
ROADS_META = REPO_ROOT / "data" / "interim" / "medan_roads_meta.json"
SUMMARY_JSON = REPO_ROOT / "public" / "data" / "fire_incidents_summary.json"
STATION_CAND_JSON = REPO_ROOT / "public" / "data" / "damkarmat_station_candidates.json"
OUT_PROCESSED = REPO_ROOT / "data" / "processed" / "medan_road_graph.json"
OUT_PUBLIC = REPO_ROOT / "public" / "data" / "medan_road_graph.json"

ROUTING_HIGHWAYS = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
}

SNAP_GRID_M = 1.0
SIMPLIFY_TOL_M = 15.0
MAX_EDGE_STEP_M = 250.0
ASSUMED_SPEED_KMH = 35.0
MAX_STATION_SNAP_M = 500.0


def _snap_key(x: float, y: float) -> tuple[int, int]:
    return (int(round(x / SNAP_GRID_M)), int(round(y / SNAP_GRID_M)))


def _perp_dist(pt: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    if a == b:
        return math.hypot(pt[0] - a[0], pt[1] - a[1])
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy))


def _simplify_polyline_utm(pts: list[tuple[float, float]], tol_m: float) -> list[tuple[float, float]]:
    if len(pts) <= 2:
        return pts

    def dp(seq: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(seq) <= 2:
            return seq
        dmax = 0.0
        idx = 0
        for i in range(1, len(seq) - 1):
            d = _perp_dist(seq[i], seq[0], seq[-1])
            if d > dmax:
                dmax = d
                idx = i
        if dmax > tol_m:
            left = dp(seq[: idx + 1])
            right = dp(seq[idx:])
            return left[:-1] + right
        return [seq[0], seq[-1]]

    return dp(pts)


def _polyline_length_m(pts: list[tuple[float, float]]) -> float:
    total = 0.0
    for i in range(len(pts) - 1):
        total += math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    return total


def _subdivide_polyline(pts: list[tuple[float, float]], max_step_m: float) -> list[list[tuple[float, float]]]:
    """Split long road edges into <= max_step_m chunks along real polyline geometry."""
    if _polyline_length_m(pts) <= max_step_m:
        return [pts]
    chunks: list[list[tuple[float, float]]] = []
    cur_chunk: list[tuple[float, float]] = [pts[0]]
    cur_len = 0.0
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        seg_len = math.hypot(bx - ax, by - ay)
        if seg_len <= 0.1:
            continue
        rem_ax, rem_ay = ax, ay
        rem_len = seg_len
        while cur_len + rem_len > max_step_m:
            need = max_step_m - cur_len
            t = max(0.0, min(1.0, need / rem_len))
            mx = rem_ax + t * (bx - rem_ax)
            my = rem_ay + t * (by - rem_ay)
            cur_chunk.append((mx, my))
            chunks.append(cur_chunk)
            cur_chunk = [(mx, my)]
            cur_len = 0.0
            rem_ax, rem_ay = mx, my
            rem_len = math.hypot(bx - rem_ax, by - rem_ay)
        cur_chunk.append((bx, by))
        cur_len += rem_len
    if len(cur_chunk) >= 2 and _polyline_length_m(cur_chunk) > 0.2:
        chunks.append(cur_chunk)
    elif chunks and len(cur_chunk) == 1:
        chunks[-1].append(cur_chunk[0])
    return chunks or [pts]


def _dijkstra(adj: list[list[tuple[int, float]]], start: int, end: int) -> float | None:
    dist = {start: 0.0}
    pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == end:
            return d
        if d > dist.get(u, float("inf")):
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return None


def build_road_graph() -> dict:
    if not ROADS_GPKG.exists():
        raise RuntimeError(f"Road GeoPackage not found: {ROADS_GPKG}")

    roads_meta = json.loads(ROADS_META.read_text(encoding="utf-8"))

    utm_srs = osr.SpatialReference()
    utm_srs.ImportFromEPSG(32647)
    utm_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    wgs_srs = osr.SpatialReference()
    wgs_srs.ImportFromEPSG(4326)
    wgs_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    to_wgs = osr.CoordinateTransformation(utm_srs, wgs_srs)
    to_utm = osr.CoordinateTransformation(wgs_srs, utm_srs)

    ds = ogr.Open(str(ROADS_GPKG), 0)
    if ds is None:
        raise RuntimeError(f"Failed to open {ROADS_GPKG}")
    layer = ds.GetLayer("medan_roads_utm")

    raw_ways: list[tuple[list[tuple[int, int]], list[tuple[float, float]], str, str, str]] = []
    vertex_way_count: Counter[tuple[int, int]] = Counter()
    endpoint_keys: set[tuple[int, int]] = set()
    key_coords_sum: dict[tuple[int, int], list[float]] = defaultdict(lambda: [0.0, 0.0, 0])

    for feat in layer:
        hw = str(feat.GetField("highway") or "").strip().lower()
        if hw not in ROUTING_HIGHWAYS:
            continue
        oneway_dir = str(feat.GetField("oneway_dir") or "BOTH").strip().upper()
        if oneway_dir not in ("F", "B", "BOTH"):
            oneway_dir = "BOTH"
        name = str(feat.GetField("name") or "").strip()
        geom = feat.GetGeometryRef()
        if geom is None or geom.IsEmpty():
            continue

        pts_raw = geom.GetPoints()
        if not pts_raw or len(pts_raw) < 2:
            continue

        pts_utm = [(float(p[0]), float(p[1])) for p in pts_raw]
        keys: list[tuple[int, int]] = []
        clean_pts: list[tuple[float, float]] = []
        for x, y in pts_utm:
            k = _snap_key(x, y)
            if not keys or keys[-1] != k:
                keys.append(k)
                clean_pts.append((x, y))
                acc = key_coords_sum[k]
                acc[0] += x
                acc[1] += y
                acc[2] += 1
        if len(keys) < 2:
            continue

        endpoint_keys.add(keys[0])
        endpoint_keys.add(keys[-1])
        for k in set(keys):
            vertex_way_count[k] += 1

        raw_ways.append((keys, clean_pts, hw, oneway_dir, name))

    ds = None

    split_keys = {k for k, cnt in vertex_way_count.items() if cnt >= 2} | endpoint_keys

    # Average coordinates per split node
    node_xy_by_key: dict[tuple[int, int], tuple[float, float]] = {}
    for k in split_keys:
        sx, sy, cnt = key_coords_sum[k]
        node_xy_by_key[k] = (sx / cnt, sy / cnt)

    # Split ways into topological edges between split_keys
    raw_edges: list[tuple[tuple[int, int], tuple[int, int], float, str, str, str, list[tuple[float, float]]]] = []
    for keys, pts, hw, oneway_dir, name in raw_ways:
        start_idx = 0
        for idx in range(1, len(keys)):
            if keys[idx] in split_keys or idx == len(keys) - 1:
                u_key = keys[start_idx]
                v_key = keys[idx]
                seg_pts = list(pts[start_idx : idx + 1])
                seg_pts[0] = node_xy_by_key[u_key]
                seg_pts[-1] = node_xy_by_key[v_key]
                if u_key != v_key and _polyline_length_m(seg_pts) > 0.2:
                    sub_chunks = _subdivide_polyline(seg_pts, MAX_EDGE_STEP_M)
                    for ci, chunk in enumerate(sub_chunks):
                        cu_key = u_key if ci == 0 else _snap_key(chunk[0][0], chunk[0][1])
                        cv_key = v_key if ci == len(sub_chunks) - 1 else _snap_key(chunk[-1][0], chunk[-1][1])
                        if cu_key not in node_xy_by_key:
                            node_xy_by_key[cu_key] = chunk[0]
                        if cv_key not in node_xy_by_key:
                            node_xy_by_key[cv_key] = chunk[-1]
                        chunk_len = _polyline_length_m(chunk)
                        if cu_key != cv_key and chunk_len > 0.2:
                            raw_edges.append((cu_key, cv_key, chunk_len, oneway_dir, hw, name, chunk))
                start_idx = idx

    # Build temporary undirected graph to find largest weakly connected component
    temp_adj: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for u_key, v_key, *_ in raw_edges:
        temp_adj[u_key].append(v_key)
        temp_adj[v_key].append(u_key)

    visited: set[tuple[int, int]] = set()
    components: list[set[tuple[int, int]]] = []
    for k in temp_adj:
        if k in visited:
            continue
        comp: set[tuple[int, int]] = set()
        q = deque([k])
        visited.add(k)
        while q:
            cur = q.popleft()
            comp.add(cur)
            for nxt in temp_adj[cur]:
                if nxt not in visited:
                    visited.add(nxt)
                    q.append(nxt)
        components.append(comp)

    components.sort(key=len, reverse=True)
    largest_comp = components[0] if components else set()

    # Deterministic node ordering: sort by (utm_x, utm_y)
    sorted_node_keys = sorted(largest_comp, key=lambda k: (round(node_xy_by_key[k][0], 2), round(node_xy_by_key[k][1], 2)))
    node_idx_by_key = {k: i for i, k in enumerate(sorted_node_keys)}

    nodes_out: list[list[float]] = []
    for k in sorted_node_keys:
        ux, uy = node_xy_by_key[k]
        lon, lat, _ = to_wgs.TransformPoint(ux, uy)
        nodes_out.append([round(lon, 5), round(lat, 5), round(ux, 1), round(uy, 1)])

    hw_list = sorted(ROUTING_HIGHWAYS)
    hw_to_idx = {h: i for i, h in enumerate(hw_list)}

    road_names_set = sorted({e[5] for e in raw_edges if e[0] in largest_comp and e[1] in largest_comp})
    name_to_idx = {n: i for i, n in enumerate(road_names_set)}

    dir_map = {"BOTH": 0, "F": 1, "B": 2}
    oneway_counts = Counter()
    edges_out: list[list] = []
    excluded_disconnected_edges = 0

    for u_key, v_key, length_m, oneway_dir, hw, name, seg_pts in raw_edges:
        if u_key not in largest_comp or v_key not in largest_comp:
            excluded_disconnected_edges += 1
            continue
        u_idx = node_idx_by_key[u_key]
        v_idx = node_idx_by_key[v_key]
        dcode = dir_map[oneway_dir]
        oneway_counts[oneway_dir] += 1

        simp = _simplify_polyline_utm(seg_pts, SIMPLIFY_TOL_M)
        interior = simp[1:-1]
        if interior:
            shape_flat: list[float] = []
            for ix, iy in interior:
                ilon, ilat, _ = to_wgs.TransformPoint(ix, iy)
                shape_flat.append(round(ilon, 5))
                shape_flat.append(round(ilat, 5))
            edges_out.append([u_idx, v_idx, round(length_m, 1), dcode, hw_to_idx[hw], name_to_idx[name], shape_flat])
        else:
            edges_out.append([u_idx, v_idx, round(length_m, 1), dcode, hw_to_idx[hw], name_to_idx[name]])

    # Deterministic sort of edges
    edges_out.sort(key=lambda e: (e[0], e[1], e[2], e[3], e[4], e[5]))

    # Self-check station snapping & connectivity
    adj: list[list[tuple[int, float]]] = [[] for _ in range(len(nodes_out))]
    for e in edges_out:
        u, v, w, dcode = e[0], e[1], float(e[2]), e[3]
        if dcode in (0, 1):
            adj[u].append((v, w))
        if dcode in (0, 2):
            adj[v].append((u, w))

    summary_doc = json.loads(SUMMARY_JSON.read_text(encoding="utf-8"))
    cand_doc = json.loads(STATION_CAND_JSON.read_text(encoding="utf-8"))
    stations_to_check = list(summary_doc.get("verified_stations") or []) + [
        s for s in (cand_doc.get("stations") or []) if s.get("location_accuracy") == "approximate"
    ]

    station_snap_checks = {}
    mako_node = None
    for st in stations_to_check:
        sx, sy, _ = to_utm.TransformPoint(float(st["lon"]), float(st["lat"]))
        best_i = -1
        best_d = float("inf")
        for i, n in enumerate(nodes_out):
            d = math.hypot(n[2] - sx, n[3] - sy)
            if d < best_d:
                best_d = d
                best_i = i
        if best_d > MAX_STATION_SNAP_M:
            raise RuntimeError(f"Station {st['station_code']} snaps {best_d:.1f}m > {MAX_STATION_SNAP_M}m")
        station_snap_checks[st["station_code"]] = round(best_d, 1)
        if st["station_code"] == "MAKO-00":
            mako_node = best_i

    # Check reachability from MAKO-00 to the other geolocated stations
    assert mako_node is not None
    for st in stations_to_check:
        if st["station_code"] == "MAKO-00":
            continue
        sx, sy, _ = to_utm.TransformPoint(float(st["lon"]), float(st["lat"]))
        target_i = min(range(len(nodes_out)), key=lambda i: math.hypot(nodes_out[i][2] - sx, nodes_out[i][3] - sy))
        d_m = _dijkstra(adj, mako_node, target_i)
        if d_m is None:
            raise RuntimeError(f"No directed road route from MAKO-00 to {st['station_code']}")

    total_length_km = round(sum(float(e[2]) for e in edges_out) / 1000.0, 2)
    graph_payload = {
        "metadata": {
            "source_name": roads_meta["source_name"],
            "source_url": roads_meta["source_url"],
            "attribution": roads_meta["attribution"],
            "license": roads_meta["license"],
            "extract_date": roads_meta["extract_date"],
            "generated_at": "2026-11-27",
            "crs_metric": "EPSG:32647",
            "crs_web": "EPSG:4326",
            "assumed_speed_kmh": ASSUMED_SPEED_KMH,
            "included_highways": hw_list,
            "snap_grid_m": SNAP_GRID_M,
            "simplify_tol_m": SIMPLIFY_TOL_M,
            "total_nodes": len(nodes_out),
            "total_edges": len(edges_out),
            "total_length_km": total_length_km,
            "connected_components_total": len(components),
            "excluded_disconnected_edges": excluded_disconnected_edges,
            "oneway_counts": {k: int(oneway_counts[k]) for k in ("BOTH", "F", "B")},
            "station_snap_distances_m": station_snap_checks,
        },
        "highways": hw_list,
        "road_names": road_names_set,
        "nodes": nodes_out,
        "edges": edges_out,
    }

    OUT_PROCESSED.parent.mkdir(parents=True, exist_ok=True)
    OUT_PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(graph_payload, separators=(",", ":"), ensure_ascii=False)
    OUT_PROCESSED.write_text(serialized, encoding="utf-8", newline="\n")
    shutil.copy2(OUT_PROCESSED, OUT_PUBLIC)

    sha = hashlib.sha256(OUT_PUBLIC.read_bytes()).hexdigest()
    print(
        f"Road graph built: {len(nodes_out)} nodes, {len(edges_out)} edges, "
        f"{total_length_km} km, {OUT_PUBLIC.stat().st_size} bytes, sha256={sha[:16]}..."
    )
    print("Station snap distances (m):", station_snap_checks)
    return graph_payload


if __name__ == "__main__":
    build_road_graph()
