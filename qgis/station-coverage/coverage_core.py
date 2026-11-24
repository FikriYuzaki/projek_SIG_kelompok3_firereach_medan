"""
Logika murni analisis jangkauan pos pemadam kebakaran Kota Medan (tanpa ketergantungan PyQGIS).

Menyediakan:
1. Validasi CRS (`EPSG:32647` untuk perhitungan metrik, `EPSG:4326` untuk pertukaran web/PostGIS).
2. Validasi ketat data pos pemadam (menolak fixture DEMO seperti DEMO-UPT-1, status non-verified, dan koordinat di luar batas Medan).
3. Validasi metadata jaringan jalan OSM dan perhitungan waktu skenario berbasis asumsi kecepatan (km/jam).
4. Perhitungan cakupan dan gap kecamatan serta validasi kontrak JSON output `station-coverage`.
"""

from __future__ import annotations

import math
import re
from typing import Any, Iterable

REQUIRED_WORKING_CRS = "EPSG:32647"
REQUIRED_OUTPUT_CRS = "EPSG:4326"
DEFAULT_THRESHOLDS_METERS = (2000, 3000, 5000)
DEFAULT_ASSUMED_SPEED_KMH = 35.0
ALLOWED_DRIVABLE_HIGHWAYS = (
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
    "residential",
    "service",
)
EXPECTED_AREA_CODES = tuple(f"12.71.{idx:02d}" for idx in range(1, 22))
ALLOWED_CANDIDATE_ACCURACIES = ("approximate", "district_only")
CANDIDATE_SCENARIO_LABEL = "SKENARIO_KANDIDAT_BELUM_TERVERIFIKASI"


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _is_valid_wgs84_pair(lon: Any, lat: Any) -> bool:
    if not (_is_finite_number(lon) and _is_finite_number(lat)):
        return False
    return -180.0 <= float(lon) <= 180.0 and -90.0 <= float(lat) <= 90.0


def _normalize_label(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split()).upper()


def is_demo_station_record(station: dict[str, Any]) -> bool:
    if not isinstance(station, dict):
        return True
    if station.get("isDemo") is True or station.get("is_demo") is True:
        return True
    if isinstance(station.get("isDemo"), str) and station["isDemo"].strip().lower() == "true":
        return True
    for key in ("dataLabel", "data_label", "station_code", "source_name", "name"):
        norm = _normalize_label(station.get(key))
        if norm == "DEMO" or re.search(r"\bDEMO\b", norm) or norm.startswith("DEMO-"):
            return True
    return False


def _ring_signed_area(ring: Any) -> float:
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        return 0.0
    total = 0.0
    for i in range(len(ring) - 1):
        p1, p2 = ring[i], ring[i + 1]
        if not (isinstance(p1, (list, tuple)) and isinstance(p2, (list, tuple)) and len(p1) >= 2 and len(p2) >= 2):
            return 0.0
        if not (_is_finite_number(p1[0]) and _is_finite_number(p1[1]) and _is_finite_number(p2[0]) and _is_finite_number(p2[1])):
            return 0.0
        total += float(p1[0]) * float(p2[1]) - float(p2[0]) * float(p1[1])
    return 0.5 * total


def _is_valid_ring(ring: Any, eps: float = 1e-12) -> bool:
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        return False
    for pt in ring:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2 or not _is_valid_wgs84_pair(pt[0], pt[1]):
            return False
    if abs(float(ring[0][0]) - float(ring[-1][0])) > eps or abs(float(ring[0][1]) - float(ring[-1][1])) > eps:
        return False
    return abs(_ring_signed_area(ring)) > 1e-15


def validate_boundary_geojson(geojson: Any) -> dict[str, Any]:
    """Memvalidasi GeoJSON batas wilayah atau zona poligon coverage."""
    errors: list[str] = []
    polygon_count = 0

    def _walk(node: Any, label: str) -> None:
        nonlocal polygon_count
        if not isinstance(node, dict):
            errors.append(f"{label}: objek GeoJSON harus berupa dict.")
            return
        gtype = node.get("type")
        if gtype == "FeatureCollection":
            feats = node.get("features")
            if not isinstance(feats, list) or not feats:
                errors.append(f"{label}: FeatureCollection kosong.")
                return
            for idx, feat in enumerate(feats):
                _walk(feat, f"{label}.features[{idx}]")
        elif gtype == "Feature":
            _walk(node.get("geometry"), f"{label}.geometry")
        elif gtype == "GeometryCollection":
            geoms = node.get("geometries")
            if not isinstance(geoms, list) or not geoms:
                errors.append(f"{label}: GeometryCollection kosong.")
                return
            for idx, geom in enumerate(geoms):
                _walk(geom, f"{label}.geometries[{idx}]")
        elif gtype == "Polygon":
            coords = node.get("coordinates")
            if not isinstance(coords, (list, tuple)) or not coords or not _is_valid_ring(coords[0]):
                errors.append(f"{label}: Polygon memiliki ring tidak valid.")
                return
            for hole in coords[1:]:
                if not _is_valid_ring(hole):
                    errors.append(f"{label}: interior hole ring tidak valid.")
                    return
            polygon_count += 1
        elif gtype == "MultiPolygon":
            coords = node.get("coordinates")
            if not isinstance(coords, (list, tuple)) or not coords:
                errors.append(f"{label}: MultiPolygon kosong.")
                return
            for idx, poly in enumerate(coords):
                if not isinstance(poly, (list, tuple)) or not poly or not _is_valid_ring(poly[0]):
                    errors.append(f"{label}[{idx}]: ring MultiPolygon tidak valid.")
                    return
                for hole in poly[1:]:
                    if not _is_valid_ring(hole):
                        errors.append(f"{label}[{idx}]: interior hole ring tidak valid.")
                        return
                polygon_count += 1
        else:
            errors.append(f"{label}: tipe geometri '{gtype}' tidak didukung.")

    _walk(geojson, "geojson")
    return {"valid": len(errors) == 0 and polygon_count > 0, "errors": errors, "polygon_count": polygon_count}


def _is_point_on_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float, eps: float = 1e-12) -> bool:
    dx, dy = x2 - x1, y2 - y1
    seg_len = math.hypot(dx, dy)
    if seg_len <= eps:
        return math.hypot(px - x1, py - y1) <= eps
    perp = abs((py - y1) * dx - (px - x1) * dy) / seg_len
    if perp > eps:
        return False
    return min(x1, x2) - eps <= px <= max(x1, x2) + eps and min(y1, y2) - eps <= py <= max(y1, y2) + eps


def _classify_point_in_ring(lon: float, lat: float, ring: list[Any]) -> str:
    n = len(ring)
    for idx in range(n - 1):
        if _is_point_on_segment(lon, lat, float(ring[idx][0]), float(ring[idx][1]), float(ring[idx + 1][0]), float(ring[idx + 1][1])):
            return "boundary"
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = float(ring[i][0]), float(ring[i][1])
        xj, yj = float(ring[j][0]), float(ring[j][1])
        if (yi > lat) != (yj > lat) and lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi:
            inside = not inside
        j = i
    return "inside" if inside else "outside"


def _point_in_poly_coords(lon: float, lat: float, poly_coords: list[Any]) -> bool:
    if not poly_coords:
        return False
    outer = _classify_point_in_ring(lon, lat, poly_coords[0])
    if outer == "outside":
        return False
    if outer == "boundary":
        return True
    for hole in poly_coords[1:]:
        h_status = _classify_point_in_ring(lon, lat, hole)
        if h_status == "inside":
            return False
        if h_status == "boundary":
            return True
    return True


def point_in_geojson(lon: float, lat: float, geojson: Any) -> bool:
    if not _is_valid_wgs84_pair(lon, lat) or not isinstance(geojson, dict):
        return False
    gtype = geojson.get("type")
    lon_f, lat_f = float(lon), float(lat)
    if gtype == "Polygon":
        return _point_in_poly_coords(lon_f, lat_f, geojson.get("coordinates") or [])
    if gtype == "MultiPolygon":
        return any(_point_in_poly_coords(lon_f, lat_f, p) for p in (geojson.get("coordinates") or []))
    if gtype == "GeometryCollection":
        return any(point_in_geojson(lon_f, lat_f, g) for g in (geojson.get("geometries") or []))
    if gtype == "Feature":
        return point_in_geojson(lon_f, lat_f, geojson.get("geometry"))
    if gtype == "FeatureCollection":
        return any(point_in_geojson(lon_f, lat_f, f) for f in (geojson.get("features") or []))
    return False


def validate_crs_config(working_crs: str, output_crs: str) -> dict[str, Any]:
    errors = []
    if str(working_crs or "").strip().upper() != REQUIRED_WORKING_CRS:
        errors.append(f"CRS kerja wajib {REQUIRED_WORKING_CRS}, bukan '{working_crs}'.")
    if str(output_crs or "").strip().upper() != REQUIRED_OUTPUT_CRS:
        errors.append(f"CRS output web wajib {REQUIRED_OUTPUT_CRS}, bukan '{output_crs}'.")
    return {"valid": len(errors) == 0, "errors": errors}


def validate_road_network_metadata(meta: Any) -> dict[str, Any]:
    errors = []
    if not isinstance(meta, dict):
        return {"valid": False, "errors": ["Metadata jaringan jalan harus berupa objek."]}
    if not isinstance(meta.get("segment_count"), int) or meta["segment_count"] <= 0:
        errors.append("segment_count jaringan jalan wajib integer > 0.")
    if not _is_finite_number(meta.get("total_length_km")) or float(meta["total_length_km"]) <= 0:
        errors.append("total_length_km jaringan jalan wajib > 0.")
    if str(meta.get("working_crs") or "").upper() != REQUIRED_WORKING_CRS:
        errors.append(f"CRS jaringan jalan wajib {REQUIRED_WORKING_CRS}.")
    if "openstreetmap" not in str(meta.get("attribution") or "").lower():
        errors.append("Atribusi OpenStreetMap wajib dicantumkan.")
    return {"valid": len(errors) == 0, "errors": errors}


def validate_station_records(stations: Iterable[Any], boundary_geojson: Any) -> dict[str, Any]:
    """Memvalidasi daftar pos pemadam kebakaran dan menolak DEMO/unverified/di luar Medan."""
    boundary_check = validate_boundary_geojson(boundary_geojson)
    if not boundary_check["valid"]:
        raise ValueError("Boundary Kota Medan tidak valid: " + "; ".join(boundary_check["errors"]))

    station_list = list(stations or [])
    seen_codes: set[str] = set()
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    reason_counts: dict[str, int] = {}

    def _add_reason(reasons: list[str], code: str) -> None:
        if code not in reasons:
            reasons.append(code)
            reason_counts[code] = reason_counts.get(code, 0) + 1

    for idx, item in enumerate(station_list):
        reasons: list[str] = []
        if not isinstance(item, dict):
            _add_reason(reasons, "invalid_station_object")
            rejected.append({"index": idx, "station_code": None, "reasons": reasons})
            continue

        code = str(item.get("station_code") or "").strip()
        if not code:
            _add_reason(reasons, "missing_station_code")
        elif code in seen_codes:
            _add_reason(reasons, "duplicate_station_code")
        else:
            seen_codes.add(code)

        if is_demo_station_record(item):
            _add_reason(reasons, "demo_station_rejected")

        status = str(item.get("verification_status") or "").strip().lower()
        if status != "verified":
            _add_reason(reasons, "unverified_station_status")

        lon = item.get("lon")
        lat = item.get("lat")
        if lon is None and lat is None and isinstance(item.get("geometry"), dict) and item["geometry"].get("type") == "Point":
            coords = item["geometry"].get("coordinates")
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                lon, lat = coords[0], coords[1]

        if not _is_valid_wgs84_pair(lon, lat):
            _add_reason(reasons, "invalid_coordinates")
        elif not point_in_geojson(float(lon), float(lat), boundary_geojson):
            _add_reason(reasons, "outside_medan_boundary")

        if reasons:
            rejected.append({"index": idx, "station_code": code or None, "reasons": reasons})
            continue

        accepted.append(
            {
                "station_code": code,
                "name": str(item.get("name") or code).strip(),
                "station_type": str(item.get("station_type") or "upt").strip(),
                "address": str(item.get("address") or "-").strip(),
                "lat": float(lat),
                "lon": float(lon),
                "verification_status": "verified",
                "isDemo": False,
                "source_name": str(item.get("source_name") or "Satu Data Medan").strip(),
                "source_url": str(item.get("source_url") or "").strip(),
            }
        )

    return {
        "accepted": accepted,
        "rejected": rejected,
        "summary": {
            "total_input": len(station_list),
            "accepted_count": len(accepted),
            "rejected_count": len(rejected),
            "rejection_reasons": reason_counts,
        },
    }


def compute_scenario_time_minutes(distance_meters: float, assumed_speed_kmh: float = DEFAULT_ASSUMED_SPEED_KMH) -> float:
    if not _is_finite_number(distance_meters) or float(distance_meters) <= 0:
        raise ValueError("Jarak skenario harus angka positif.")
    if not _is_finite_number(assumed_speed_kmh) or float(assumed_speed_kmh) <= 0:
        raise ValueError("Asumsi kecepatan (km/jam) harus angka positif.")
    return round((float(distance_meters) / 1000.0) / float(assumed_speed_kmh) * 60.0, 2)


def compute_district_coverage_row(
    area_code: str,
    district_name: str,
    total_area_km2: float,
    network_3km_km2: float,
    network_5km_km2: float,
    euclidean_5km_km2: float,
    centroid_distance_m: float,
) -> dict[str, Any]:
    if not _is_finite_number(total_area_km2) or float(total_area_km2) <= 0:
        raise ValueError(f"Luas wilayah kecamatan {area_code} wajib > 0.")
    for label, val in (
        ("network_3km_km2", network_3km_km2),
        ("network_5km_km2", network_5km_km2),
        ("euclidean_5km_km2", euclidean_5km_km2),
        ("centroid_distance_m", centroid_distance_m),
    ):
        if not _is_finite_number(val) or float(val) < 0:
            raise ValueError(f"Nilai {label} pada {area_code} tidak valid: {val}")

    tot = float(total_area_km2)
    net3_ratio = max(0.0, min(1.0, float(network_3km_km2) / tot))
    net5_ratio = max(0.0, min(1.0, float(network_5km_km2) / tot))
    euc5_ratio = max(0.0, min(1.0, float(euclidean_5km_km2) / tot))

    return {
        "area_code": area_code,
        "district_name": district_name,
        "district_area_km2": round(tot, 4),
        "network_3km_covered_km2": round(float(network_3km_km2), 4),
        "network_3km_coverage_pct": round(net3_ratio * 100.0, 2),
        "network_5km_covered_km2": round(float(network_5km_km2), 4),
        "network_5km_coverage_pct": round(net5_ratio * 100.0, 2),
        "network_5km_gap_ratio": round(1.0 - net5_ratio, 6),
        "euclidean_5km_covered_km2": round(float(euclidean_5km_km2), 4),
        "euclidean_5km_coverage_pct": round(euc5_ratio * 100.0, 2),
        "centroid_distance_m_mako": round(float(centroid_distance_m), 1),
    }


def validate_candidate_station_records(
    candidates: Any,
    boundary_geojson: Any,
    verified_codes: set[str] | None = None,
) -> dict[str, Any]:
    """Memvalidasi daftar kandidat pos UPT publik tanpa mencampurkannya ke pos verified."""
    boundary_check = validate_boundary_geojson(boundary_geojson)
    if not boundary_check["valid"]:
        raise ValueError("Boundary Kota Medan tidak valid: " + "; ".join(boundary_check["errors"]))

    candidate_list = list(candidates or []) if isinstance(candidates, Iterable) and not isinstance(candidates, (str, bytes, dict)) else ([] if candidates is None else [candidates])
    known_verified = {str(c).strip() for c in (verified_codes or set()) if str(c).strip()}
    seen_codes: set[str] = set()
    accepted: list[dict[str, Any]] = []
    geolocated: list[dict[str, Any]] = []
    district_only: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    reason_counts: dict[str, int] = {}

    def _add_reason(reasons: list[str], code: str) -> None:
        if code not in reasons:
            reasons.append(code)
            reason_counts[code] = reason_counts.get(code, 0) + 1

    for idx, item in enumerate(candidate_list):
        reasons: list[str] = []
        if not isinstance(item, dict):
            _add_reason(reasons, "invalid_candidate_object")
            rejected.append({"index": idx, "station_code": None, "reasons": reasons})
            continue

        code = str(item.get("station_code") or "").strip()
        if not code:
            _add_reason(reasons, "missing_station_code")
        elif code in known_verified:
            _add_reason(reasons, "duplicate_verified_station_code")
        elif code in seen_codes:
            _add_reason(reasons, "duplicate_station_code")
        else:
            seen_codes.add(code)

        if is_demo_station_record(item):
            _add_reason(reasons, "demo_station_rejected")

        status = str(item.get("verification_status") or "").strip().lower()
        if status != "needs_review":
            _add_reason(reasons, "must_remain_needs_review")

        acc = str(item.get("location_accuracy") or "").strip().lower()
        if acc not in ALLOWED_CANDIDATE_ACCURACIES:
            _add_reason(reasons, "invalid_location_accuracy")

        source_url = str(item.get("source_url") or "").strip()
        if not source_url.startswith("https://"):
            _add_reason(reasons, "invalid_source_url")

        if (
            not str(item.get("source_name") or "").strip()
            or not str(item.get("retrieved_at") or "").strip()
            or not str(item.get("limitation_note") or "").strip()
        ):
            _add_reason(reasons, "missing_provenance_fields")

        lat = item.get("lat")
        lon = item.get("lon")
        geom = item.get("geom")

        if acc == "approximate":
            if not _is_valid_wgs84_pair(lon, lat):
                _add_reason(reasons, "invalid_coordinates")
            else:
                lon_f, lat_f = float(lon), float(lat)
                if (
                    not isinstance(geom, dict)
                    or geom.get("type") != "Point"
                    or not isinstance(geom.get("coordinates"), (list, tuple))
                    or len(geom["coordinates"]) < 2
                    or abs(float(geom["coordinates"][0]) - lon_f) > 1e-6
                    or abs(float(geom["coordinates"][1]) - lat_f) > 1e-6
                ):
                    _add_reason(reasons, "invalid_point_geom")
                elif not point_in_geojson(lon_f, lat_f, boundary_geojson):
                    _add_reason(reasons, "outside_medan_boundary")
            if not str(item.get("osm_ref") or "").strip():
                _add_reason(reasons, "missing_osm_ref")
        elif acc == "district_only":
            if lat is not None or lon is not None or geom is not None:
                _add_reason(reasons, "district_only_must_have_null_geom")

        if reasons:
            rejected.append({"index": idx, "station_code": code or None, "reasons": reasons})
            continue

        evidence_urls = [str(u).strip() for u in (item.get("evidence_urls") or []) if str(u).strip().startswith("https://")]
        if source_url not in evidence_urls:
            evidence_urls.insert(0, source_url)

        normalized = {
            "station_code": code,
            "name": str(item.get("name") or code).strip(),
            "station_type": str(item.get("station_type") or "upt").strip(),
            "address": str(item.get("address") or "-").strip(),
            "district_name": str(item.get("district_name") or "").strip(),
            "area_code": str(item.get("area_code") or "").strip() or None,
            "lat": float(lat) if acc == "approximate" else None,
            "lon": float(lon) if acc == "approximate" else None,
            "geom": {"type": "Point", "coordinates": [float(lon), float(lat)]} if acc == "approximate" else None,
            "location_accuracy": acc,
            "validity_category": str(item.get("validity_category") or ("kandidat_publik_ruas_osm" if acc == "approximate" else "kandidat_publik_kecamatan_saja")).strip(),
            "verification_status": "needs_review",
            "osm_ref": str(item.get("osm_ref")).strip() if item.get("osm_ref") else None,
            "source_name": str(item.get("source_name")).strip(),
            "source_url": source_url,
            "evidence_urls": evidence_urls,
            "retrieved_at": str(item.get("retrieved_at")).strip(),
            "limitation_note": str(item.get("limitation_note")).strip(),
            "isDemo": False,
        }
        accepted.append(normalized)
        if acc == "approximate":
            geolocated.append(normalized)
        else:
            district_only.append(normalized)

    return {
        "accepted": accepted,
        "geolocated": geolocated,
        "district_only": district_only,
        "rejected": rejected,
        "summary": {
            "total_input": len(candidate_list),
            "accepted_count": len(accepted),
            "geolocated_count": len(geolocated),
            "district_only_count": len(district_only),
            "rejected_count": len(rejected),
            "rejection_reasons": reason_counts,
        },
    }


def validate_candidate_coverage_scenario(scenario: Any) -> dict[str, Any]:
    """Memvalidasi blok skenario sensitivitas kandidat agar tidak pernah menyamar sebagai cakupan resmi."""
    errors: list[str] = []
    if not isinstance(scenario, dict):
        return {"valid": False, "errors": ["candidate_coverage_scenario harus berupa objek JSON."]}

    if scenario.get("isDemo") is not False:
        errors.append("candidate_coverage_scenario wajib memiliki isDemo === false.")
    if scenario.get("is_official_coverage") is not False:
        errors.append("candidate_coverage_scenario wajib memiliki is_official_coverage === false.")

    label = str(scenario.get("dataLabel") or "").strip()
    norm_label = _normalize_label(label)
    if not norm_label or "DEMO" in norm_label or "KANDIDAT" not in norm_label:
        errors.append("dataLabel skenario kandidat wajib menyebut KANDIDAT dan bukan DEMO.")

    if not str(scenario.get("disclaimer") or "").strip():
        errors.append("Disclaimer skenario kandidat wajib tersedia.")

    crs_check = validate_crs_config(scenario.get("working_crs", ""), scenario.get("output_crs", ""))
    errors.extend(crs_check["errors"])

    if not _is_finite_number(scenario.get("assumed_speed_kmh")) or float(scenario["assumed_speed_kmh"]) <= 0:
        errors.append("assumed_speed_kmh skenario kandidat wajib angka positif.")

    included = scenario.get("included_station_codes")
    if not isinstance(included, list) or len(included) < 2:
        errors.append("included_station_codes skenario kandidat minimal memuat 2 kode pos.")

    comp = scenario.get("threshold_comparison")
    if not isinstance(comp, list) or len(comp) == 0:
        errors.append("threshold_comparison skenario kandidat wajib non-kosong.")

    for layer_key in ("euclidean_buffers", "network_service_areas"):
        fc = scenario.get(layer_key)
        check = validate_boundary_geojson(fc)
        if not check["valid"]:
            errors.append(f"Layer skenario {layer_key} tidak valid: {'; '.join(check['errors'])}")

    dc = scenario.get("district_coverage")
    if not isinstance(dc, list) or len(dc) != 21:
        errors.append("district_coverage skenario kandidat wajib memuat tepat 21 kecamatan.")
    else:
        codes = {row.get("area_code") for row in dc if isinstance(row, dict)}
        if codes != set(EXPECTED_AREA_CODES):
            errors.append("Kode area district_coverage skenario kandidat tidak lengkap (12.71.01..12.71.21).")

    return {"valid": len(errors) == 0, "errors": errors}


def validate_station_coverage_output(payload: Any) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return {"valid": False, "errors": ["Payload output station-coverage bukan objek JSON."]}

    if payload.get("isDemo") is not False:
        errors.append("Output resmi/provisional wajib memiliki isDemo === false.")
    label = str(payload.get("dataLabel") or "").strip()
    if not label or "DEMO" in _normalize_label(label):
        errors.append("dataLabel tidak boleh kosong atau DEMO.")

    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        errors.append("Field analysis wajib tersedia.")
    else:
        crs_check = validate_crs_config(analysis.get("working_crs", ""), analysis.get("output_crs", ""))
        errors.extend(crs_check["errors"])
        if not str(analysis.get("disclaimer") or "").strip():
            errors.append("Disclaimer asumsi skenario waktu tempuh wajib tersedia.")
        if not _is_finite_number(analysis.get("assumed_speed_kmh")) or float(analysis["assumed_speed_kmh"]) <= 0:
            errors.append("assumed_speed_kmh wajib angka positif.")

    road_meta_check = validate_road_network_metadata(payload.get("road_network"))
    errors.extend(road_meta_check["errors"])

    verified_codes: set[str] = set()
    stations = payload.get("stations")
    if not isinstance(stations, list) or len(stations) == 0:
        errors.append("Minimal satu stasiun terverifikasi wajib tersedia.")
    else:
        for st in stations:
            if is_demo_station_record(st) or st.get("verification_status") != "verified":
                errors.append(f"Stasiun tidak terverifikasi/DEMO terdeteksi di output: {st.get('station_code')}")
            elif st.get("station_code"):
                verified_codes.add(str(st["station_code"]).strip())

    for layer_key in ["euclidean_buffers", "network_service_areas"]:
        fc = payload.get(layer_key)
        check = validate_boundary_geojson(fc)
        if not check["valid"]:
            errors.append(f"Layer {layer_key} tidak valid: {'; '.join(check['errors'])}")

    dc = payload.get("district_coverage")
    if not isinstance(dc, list) or len(dc) != 21:
        errors.append("district_coverage wajib memuat tepat 21 kecamatan.")
    else:
        codes = {row.get("area_code") for row in dc if isinstance(row, dict)}
        if codes != set(EXPECTED_AREA_CODES):
            errors.append("Kode area district_coverage tidak lengkap (12.71.01..12.71.21).")

    if payload.get("candidate_stations") is not None:
        raw_cands = payload.get("candidate_stations")
        if not isinstance(raw_cands, list):
            errors.append("candidate_stations wajib berupa array jika tersedia.")
        else:
            medan_bbox_geojson = {
                "type": "Polygon",
                "coordinates": [[[98.55, 3.45], [98.78, 3.45], [98.78, 3.85], [98.55, 3.85], [98.55, 3.45]]],
            }
            cand_val = validate_candidate_station_records(raw_cands, medan_bbox_geojson, verified_codes=verified_codes)
            if cand_val["rejected"]:
                errors.append("Terdapat kandidat pos yang gagal validasi pada candidate_stations.")

    if payload.get("candidate_coverage_scenario") is not None:
        scen_check = validate_candidate_coverage_scenario(payload.get("candidate_coverage_scenario"))
        if not scen_check["valid"]:
            errors.extend(scen_check["errors"])

    return {"valid": len(errors) == 0, "errors": errors}
