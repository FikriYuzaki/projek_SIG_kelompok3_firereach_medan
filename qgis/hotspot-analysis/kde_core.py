"""
Logika murni analisis KDE Fire Hotspot Analyzer Kota Medan (tanpa ketergantungan PyQGIS/GDAL).

Modul ini menyediakan:
1. Validasi batas administrasi GeoJSON dan pengujian Point-in-Polygon (Polygon, MultiPolygon, holes, dan titik batas).
2. Validasi ketat record titik kejadian kebakaran sebelum masuk ke perhitungan KDE.
3. Klasifikasi Quantile 4 kelas berdasarkan distribusi nilai raster aktual (membuang NoData dan background nol/negatif).
4. Validasi kontrak output GeoJSON terverifikasi untuk aplikasi web FireReach Medan.
"""

from __future__ import annotations

from datetime import date, datetime
import math
import re
from typing import Any, Iterable

STRICT_KDE_ACCURACIES = ("exact_verified", "address_geocoded_verified")
EXPLORATORY_KDE_ACCURACIES = ("exact_verified", "address_geocoded_verified", "approximate")
ALLOWED_VERIFICATION_STATUS = "verified"
EXPLORATORY_VERIFICATION_STATUSES = ("verified", "needs_review")

DENSITY_TIERS = {
    1: {"rank": 1, "tier": "low", "label": "Rendah"},
    2: {"rank": 2, "tier": "medium", "label": "Sedang"},
    3: {"rank": 3, "tier": "high", "label": "Tinggi"},
    4: {"rank": 4, "tier": "very-high", "label": "Sangat Tinggi"},
}

TIER_LABEL_TO_RANK = {
    "rendah": 1,
    "low": 1,
    "sedang": 2,
    "medium": 2,
    "moderate": 2,
    "tinggi": 3,
    "high": 3,
    "sangat tinggi": 4,
    "very high": 4,
    "very-high": 4,
}

_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ISO_DATETIME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?$")


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _is_valid_wgs84_pair(lon: Any, lat: Any) -> bool:
    if not (_is_finite_number(lon) and _is_finite_number(lat)):
        return False
    lon_f = float(lon)
    lat_f = float(lat)
    return -180.0 <= lon_f <= 180.0 and -90.0 <= lat_f <= 90.0


def normalize_label(value: Any) -> str:
    """Normalisasi spasi ganda/tepi dan huruf besar untuk pemeriksaan label."""
    if value is None:
        return ""
    return " ".join(str(value).strip().split()).upper()


def is_demo_flag(value: Any) -> bool:
    """Memeriksa apakah flag isDemo bernilai benar."""
    if value is True:
        return True
    if isinstance(value, str) and value.strip().lower() == "true":
        return True
    return False


def is_demo_label(value: Any) -> bool:
    """Memeriksa apakah dataLabel merujuk ke data DEMO setelah normalisasi spasi dan kapitalisasi."""
    normalized = normalize_label(value)
    if not normalized:
        return False
    if normalized == "DEMO":
        return True
    return bool(re.search(r"\bDEMO\b", normalized))


def is_valid_incident_date(value: Any) -> bool:
    """Memvalidasi tanggal kejadian kalender nyata berformat ISO YYYY-MM-DD atau ISO-8601 datetime."""
    if not isinstance(value, str):
        return False
    raw = value.strip()
    if not raw:
        return False

    date_match = _ISO_DATE_RE.match(raw)
    if date_match:
        year, month, day = (int(part) for part in date_match.groups())
        if year < 1900 or year > 2100:
            return False
        try:
            date(year, month, day)
            return True
        except ValueError:
            return False

    dt_match = _ISO_DATETIME_RE.match(raw)
    if dt_match:
        year, month, day = (int(dt_match.group(1)), int(dt_match.group(2)), int(dt_match.group(3)))
        if year < 1900 or year > 2100:
            return False
        try:
            date(year, month, day)
            normalized_iso = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
            datetime.fromisoformat(normalized_iso)
            return True
        except ValueError:
            return False

    return False


def ring_signed_area(ring: Any) -> float:
    """Menghitung luas bertanda (shoelace) sebuah linear ring GeoJSON."""
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        return 0.0
    area_sum = 0.0
    for i in range(len(ring) - 1):
        pt1 = ring[i]
        pt2 = ring[i + 1]
        if not (isinstance(pt1, (list, tuple)) and isinstance(pt2, (list, tuple))):
            return 0.0
        if len(pt1) < 2 or len(pt2) < 2:
            return 0.0
        if not (_is_finite_number(pt1[0]) and _is_finite_number(pt1[1]) and _is_finite_number(pt2[0]) and _is_finite_number(pt2[1])):
            return 0.0
        x1, y1 = float(pt1[0]), float(pt1[1])
        x2, y2 = float(pt2[0]), float(pt2[1])
        area_sum += x1 * y2 - x2 * y1
    return 0.5 * area_sum


def is_valid_linear_ring(ring: Any, eps: float = 1e-12) -> bool:
    """Memastikan linear ring minimal 4 titik, tertutup, koordinat WGS84 valid, dan luas bukan nol."""
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        return False
    for pt in ring:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            return False
        if not _is_valid_wgs84_pair(pt[0], pt[1]):
            return False

    x0, y0 = float(ring[0][0]), float(ring[0][1])
    xn, yn = float(ring[-1][0]), float(ring[-1][1])
    if abs(x0 - xn) > eps or abs(y0 - yn) > eps:
        return False

    return abs(ring_signed_area(ring)) > 1e-15


def _validate_polygon_coords(poly_coords: Any, path_label: str, errors: list[str]) -> int:
    if not isinstance(poly_coords, (list, tuple)) or len(poly_coords) == 0:
        errors.append(f"{path_label}: koordinat Polygon kosong atau bukan array.")
        return 0
    if not is_valid_linear_ring(poly_coords[0]):
        errors.append(f"{path_label}: exterior ring tidak valid, tidak tertutup, atau luas nol.")
        return 0
    hole_count = 0
    for idx, hole in enumerate(poly_coords[1:], start=1):
        if not is_valid_linear_ring(hole):
            errors.append(f"{path_label}: interior ring (hole #{idx}) tidak valid.")
            return hole_count
        hole_count += 1
    return hole_count


def validate_boundary_geojson(geojson: Any) -> dict[str, Any]:
    """Memvalidasi struktur GeoJSON batas poligon (Polygon, MultiPolygon, Feature, FeatureCollection)."""
    errors: list[str] = []
    polygon_count = 0
    hole_count = 0

    def _walk(node: Any, label: str) -> None:
        nonlocal polygon_count, hole_count
        if not isinstance(node, dict):
            errors.append(f"{label}: objek GeoJSON harus berupa dictionary/object.")
            return
        gtype = node.get("type")
        if gtype == "FeatureCollection":
            feats = node.get("features")
            if not isinstance(feats, list) or len(feats) == 0:
                errors.append(f"{label}: FeatureCollection tidak memiliki daftar features yang valid.")
                return
            for i, feat in enumerate(feats):
                _walk(feat, f"{label}.features[{i}]")
        elif gtype == "Feature":
            geom = node.get("geometry")
            if not isinstance(geom, dict):
                errors.append(f"{label}: Feature tidak memiliki geometry yang valid.")
                return
            _walk(geom, f"{label}.geometry")
        elif gtype == "GeometryCollection":
            geoms = node.get("geometries")
            if not isinstance(geoms, list) or len(geoms) == 0:
                errors.append(f"{label}: GeometryCollection kosong.")
                return
            for i, geom in enumerate(geoms):
                _walk(geom, f"{label}.geometries[{i}]")
        elif gtype == "Polygon":
            before = len(errors)
            holes = _validate_polygon_coords(node.get("coordinates"), label, errors)
            if len(errors) == before:
                polygon_count += 1
                hole_count += holes
        elif gtype == "MultiPolygon":
            coords = node.get("coordinates")
            if not isinstance(coords, (list, tuple)) or len(coords) == 0:
                errors.append(f"{label}: MultiPolygon tidak memiliki poligon.")
                return
            for i, poly_coords in enumerate(coords):
                before = len(errors)
                holes = _validate_polygon_coords(poly_coords, f"{label}[{i}]", errors)
                if len(errors) == before:
                    polygon_count += 1
                    hole_count += holes
        else:
            errors.append(f"{label}: tipe geometri batas '{gtype}' tidak didukung (harus Polygon/MultiPolygon).")

    _walk(geojson, "boundary")
    if polygon_count == 0 and not errors:
        errors.append("boundary: tidak ditemukan poligon batas yang valid.")

    return {
        "valid": len(errors) == 0 and polygon_count > 0,
        "errors": errors,
        "polygon_count": polygon_count,
        "hole_count": hole_count,
    }


def is_point_on_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float, eps: float = 1e-12) -> bool:
    """Memeriksa apakah titik (px, py) berada pada segmen garis (x1, y1)-(x2, y2) dalam toleransi eps."""
    dx = x2 - x1
    dy = y2 - y1
    seg_len = math.hypot(dx, dy)
    if seg_len <= eps:
        return math.hypot(px - x1, py - y1) <= eps
    perp_dist = abs((py - y1) * dx - (px - x1) * dy) / seg_len
    if perp_dist > eps:
        return False
    return (
        min(x1, x2) - eps <= px <= max(x1, x2) + eps
        and min(y1, y2) - eps <= py <= max(y1, y2) + eps
    )


def classify_point_in_ring(lon: float, lat: float, ring: list[list[float]], eps: float = 1e-12) -> str:
    """Mengklasifikasikan titik terhadap sebuah linear ring: 'boundary', 'inside', atau 'outside'."""
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        return "outside"

    n = len(ring)
    for idx in range(n - 1):
        pt_a = ring[idx]
        pt_b = ring[idx + 1]
        if is_point_on_segment(lon, lat, float(pt_a[0]), float(pt_a[1]), float(pt_b[0]), float(pt_b[1]), eps=eps):
            return "boundary"

    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = float(ring[i][0]), float(ring[i][1])
        xj, yj = float(ring[j][0]), float(ring[j][1])
        if (yi > lat) != (yj > lat):
            intersect_x = ((xj - xi) * (lat - yi)) / (yj - yi) + xi
            if lon < intersect_x:
                inside = not inside
        j = i

    return "inside" if inside else "outside"


def point_in_polygon_coords(lon: float, lat: float, polygon_coords: list[Any]) -> bool:
    """Uji Point-in-Polygon dengan dukungan exterior ring, interior holes, dan titik tepat di batas."""
    if not isinstance(polygon_coords, (list, tuple)) or len(polygon_coords) == 0:
        return False

    outer_status = classify_point_in_ring(lon, lat, polygon_coords[0])
    if outer_status == "outside":
        return False
    if outer_status == "boundary":
        return True

    for hole_ring in polygon_coords[1:]:
        hole_status = classify_point_in_ring(lon, lat, hole_ring)
        if hole_status == "inside":
            return False
        if hole_status == "boundary":
            return True

    return True


def point_in_geojson(lon: float, lat: float, geojson: Any) -> bool:
    """Memeriksa apakah koordinat (lon, lat) berada di dalam atau pada batas geometri GeoJSON."""
    if not _is_valid_wgs84_pair(lon, lat) or not isinstance(geojson, dict):
        return False
    lon_f = float(lon)
    lat_f = float(lat)

    gtype = geojson.get("type")
    if gtype == "Polygon":
        return point_in_polygon_coords(lon_f, lat_f, geojson.get("coordinates") or [])
    if gtype == "MultiPolygon":
        coords = geojson.get("coordinates")
        return isinstance(coords, (list, tuple)) and any(
            point_in_polygon_coords(lon_f, lat_f, poly_coords) for poly_coords in coords
        )
    if gtype == "GeometryCollection":
        geoms = geojson.get("geometries")
        return isinstance(geoms, (list, tuple)) and any(point_in_geojson(lon_f, lat_f, g) for g in geoms)
    if gtype == "Feature":
        return point_in_geojson(lon_f, lat_f, geojson.get("geometry"))
    if gtype == "FeatureCollection":
        feats = geojson.get("features")
        return isinstance(feats, (list, tuple)) and any(point_in_geojson(lon_f, lat_f, f) for f in feats)
    return False


def extract_geojson_point(geometry: Any) -> tuple[float | None, float | None, str | None]:
    """Mengekstrak koordinat Point GeoJSON secara ketat beserta kode error jika tidak valid."""
    if geometry is None:
        return None, None, "missing_geometry"
    if not isinstance(geometry, dict):
        return None, None, "invalid_geometry_type"
    if geometry.get("type") != "Point":
        return None, None, "invalid_geometry_type"

    coords = geometry.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) not in (2, 3):
        return None, None, "malformed_coordinates"

    lon_raw, lat_raw = coords[0], coords[1]
    if not (_is_finite_number(lon_raw) and _is_finite_number(lat_raw)):
        return None, None, "non_finite_coordinates"

    lon = float(lon_raw)
    lat = float(lat_raw)
    if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        return None, None, "out_of_wgs84_range"

    return lon, lat, None


def _extract_props_and_geom(raw_record: Any) -> tuple[dict[str, Any], Any]:
    if not isinstance(raw_record, dict):
        return {}, None
    if raw_record.get("type") == "Feature" and isinstance(raw_record.get("properties"), dict):
        props = dict(raw_record["properties"])
        if "id" in raw_record and "incident_id" not in props:
            props["incident_id"] = raw_record.get("id")
        return props, raw_record.get("geometry")
    geom = raw_record.get("geometry") if "geometry" in raw_record else raw_record.get("geom")
    return dict(raw_record), geom


def validate_kde_input_features(
    features: Iterable[Any],
    boundary_geojson: Any,
    mode: str = "strict",
) -> dict[str, Any]:
    """
    Memvalidasi seluruh record input sebelum KDE secara eksplisit tanpa mengubah data mentah.

    Mode 'strict' (resmi):
    - verification_status == "verified"
    - location_accuracy hanya "exact_verified" atau "address_geocoded_verified"

    Mode 'exploratory' (analisis publik terdokumentasi):
    - mengizinkan status "verified" atau "needs_review" serta akurasi "approximate" (ruas/landmark OSM)
    - tetap menolak "district_only", "unknown", geom null, DEMO, duplikat, dan koordinat luar Medan
    """
    if mode not in ("strict", "exploratory"):
        raise ValueError(f"Mode validasi KDE tidak dikenal: {mode}")
    allowed_statuses = (ALLOWED_VERIFICATION_STATUS,) if mode == "strict" else EXPLORATORY_VERIFICATION_STATUSES
    allowed_accuracies = STRICT_KDE_ACCURACIES if mode == "strict" else EXPLORATORY_KDE_ACCURACIES

    boundary_check = validate_boundary_geojson(boundary_geojson)
    if not boundary_check["valid"]:
        raise ValueError(
            "Boundary administrasi Kota Medan tidak valid: " + "; ".join(boundary_check["errors"])
        )

    feature_list = list(features or [])
    seen_ids: set[str] = set()
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    reason_counts: dict[str, int] = {}

    def _add_reason(reasons: list[str], code: str) -> None:
        if code not in reasons:
            reasons.append(code)
            reason_counts[code] = reason_counts.get(code, 0) + 1

    for idx, raw_item in enumerate(feature_list):
        reasons: list[str] = []
        if not isinstance(raw_item, dict):
            _add_reason(reasons, "invalid_record_object")
            rejected.append({"index": idx, "incident_id": None, "reasons": reasons})
            continue

        props, geom = _extract_props_and_geom(raw_item)
        raw_id = props.get("incident_id")
        incident_id = (
            raw_id.strip()
            if isinstance(raw_id, str)
            else (str(raw_id).strip() if isinstance(raw_id, int) and not isinstance(raw_id, bool) else "")
        )

        if not incident_id:
            _add_reason(reasons, "missing_incident_id")
        elif incident_id in seen_ids:
            _add_reason(reasons, "duplicate_incident_id")
        else:
            seen_ids.add(incident_id)

        if not is_valid_incident_date(props.get("incident_date")):
            _add_reason(reasons, "invalid_incident_date")

        if is_demo_flag(props.get("isDemo")) or is_demo_flag(props.get("is_demo")):
            _add_reason(reasons, "demo_record_flagged")

        if is_demo_label(props.get("dataLabel")) or is_demo_label(props.get("data_label")):
            _add_reason(reasons, "demo_data_label")

        verification_status = str(props.get("verification_status") or "").strip()
        if verification_status not in allowed_statuses:
            _add_reason(reasons, "invalid_verification_status")

        location_accuracy = str(props.get("location_accuracy") or "").strip()
        if location_accuracy not in allowed_accuracies:
            _add_reason(reasons, "disallowed_location_accuracy")

        lon, lat, geom_err = extract_geojson_point(geom)
        if geom_err is not None or lon is None or lat is None:
            _add_reason(reasons, geom_err or "invalid_geometry")
        elif not point_in_geojson(lon, lat, boundary_geojson):
            _add_reason(reasons, "outside_medan_boundary")

        if reasons:
            rejected.append({"index": idx, "incident_id": incident_id or None, "reasons": reasons})
            continue

        accepted.append(
            {
                "type": "Feature",
                "properties": {
                    "incident_id": incident_id,
                    "incident_date": str(props["incident_date"]).strip(),
                    "verification_status": verification_status,
                    "location_accuracy": location_accuracy,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat],
                },
            }
        )

    summary = {
        "total_input": len(feature_list),
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
        "points_used_for_kde": len(accepted),
        "rejection_reasons": reason_counts,
        "rejected_samples": rejected[:20],
    }

    return {
        "accepted": accepted,
        "rejected": rejected,
        "summary": summary,
    }


def _flatten_values_and_mask(values: Any, mask: Any = None) -> Iterable[tuple[Any, bool]]:
    if isinstance(values, (list, tuple)):
        if mask is not None and isinstance(mask, (list, tuple)) and len(mask) == len(values):
            for sub_val, sub_mask in zip(values, mask):
                yield from _flatten_values_and_mask(sub_val, sub_mask)
        else:
            for sub_val in values:
                yield from _flatten_values_and_mask(sub_val, mask)
    else:
        yield values, True if mask is None else bool(mask)


def _is_nodata_value(val: float, nodata: float | None) -> bool:
    if nodata is None:
        return False
    if isinstance(nodata, float) and math.isnan(nodata):
        return False
    return math.isclose(val, float(nodata), rel_tol=1e-9, abs_tol=1e-9)


def filter_raster_population(
    values: Any,
    nodata: float | None = None,
    mask: Any = None,
    exclude_non_positive: bool = True,
) -> tuple[list[float], dict[str, int]]:
    """
    Menyaring populasi piksel raster KDE ke nilai valid di dalam batas Kota Medan.

    - Selalu membuang piksel di luar mask, None, NaN/Inf, dan nilai NoData.
    - Jika exclude_non_positive=True (default), nilai <= 0 (background kosong di luar radius kernel)
      dikeluarkan agar area nol yang luas tidak menarik batas Q1/Q2/Q3 ke nol.
    """
    total_pixels = 0
    masked_out_pixels = 0
    nodata_pixels = 0
    zero_or_background_pixels = 0
    valid_values: list[float] = []

    for raw_val, inside_mask in _flatten_values_and_mask(values, mask):
        total_pixels += 1
        if not inside_mask:
            masked_out_pixels += 1
            continue
        if raw_val is None or isinstance(raw_val, bool):
            nodata_pixels += 1
            continue
        try:
            num = float(raw_val)
        except (TypeError, ValueError):
            nodata_pixels += 1
            continue
        if not math.isfinite(num) or _is_nodata_value(num, nodata):
            nodata_pixels += 1
            continue
        if exclude_non_positive and num <= 0.0:
            zero_or_background_pixels += 1
            continue
        valid_values.append(num)

    valid_values.sort()
    stats = {
        "total_pixels": total_pixels,
        "masked_out_pixels": masked_out_pixels,
        "nodata_pixels": nodata_pixels,
        "zero_or_background_pixels": zero_or_background_pixels,
        "valid_positive_pixels": len(valid_values),
    }
    return valid_values, stats


def compute_percentile(sorted_values: list[float], q: float) -> float:
    """Menghitung persentil empiris dengan interpolasi linear (metode Type 7 / NumPy standar)."""
    if not sorted_values:
        raise ValueError("Tidak dapat menghitung persentil dari populasi kosong.")
    if q <= 0.0:
        return float(sorted_values[0])
    if q >= 1.0:
        return float(sorted_values[-1])

    n = len(sorted_values)
    pos = q * (n - 1)
    lower = int(math.floor(pos))
    upper = int(math.ceil(pos))
    if lower == upper:
        return float(sorted_values[lower])
    frac = pos - lower
    return float(sorted_values[lower] + frac * (sorted_values[upper] - sorted_values[lower]))


def compute_quantile_classification(
    values: Any,
    nodata: float | None = None,
    mask: Any = None,
    exclude_non_positive: bool = True,
) -> dict[str, Any]:
    """
    Menghitung batas klasifikasi Quantile 4 kelas (25%, 50%, 75%) dari distribusi raster KDE aktual.

    Menangani secara eksplisit:
    - Populasi kosong (mengembalikan status 'empty').
    - Seluruh nilai identik (mengembalikan 1 kelas 'Rendah' dengan catatan peringatan).
    - Quantile kembar akibat nilai berulang (mengidentifikasi kelas yang tidak dapat dibagi/kosong).
    """
    sorted_vals, pop_stats = filter_raster_population(
        values,
        nodata=nodata,
        mask=mask,
        exclude_non_positive=exclude_non_positive,
    )

    background_policy = (
        "exclude_non_positive_zero_and_negative_kde"
        if exclude_non_positive
        else "include_all_finite_non_nodata"
    )

    if not sorted_vals:
        return {
            "method": "Quantile",
            "percentile_method": "linear_type7",
            "background_policy": background_policy,
            "status": "empty",
            "class_count": 0,
            "population": pop_stats,
            "breaks": None,
            "thresholds": [],
            "empty_ranks": [1, 2, 3, 4],
            "warnings": ["Tidak ada piksel KDE bernilai positif di dalam batas administrasi Kota Medan."],
        }

    min_val = float(sorted_vals[0])
    max_val = float(sorted_vals[-1])
    p25 = compute_percentile(sorted_vals, 0.25)
    p50 = compute_percentile(sorted_vals, 0.50)
    p75 = compute_percentile(sorted_vals, 0.75)

    breaks = {
        "min": min_val,
        "p25": p25,
        "p50": p50,
        "p75": p75,
        "max": max_val,
    }

    if math.isclose(min_val, max_val, rel_tol=1e-12, abs_tol=1e-15):
        total = len(sorted_vals)
        return {
            "method": "Quantile",
            "percentile_method": "linear_type7",
            "background_policy": background_policy,
            "status": "degenerate_constant",
            "class_count": 1,
            "population": pop_stats,
            "breaks": breaks,
            "thresholds": [
                {
                    "rank": 1,
                    "tier": DENSITY_TIERS[1]["tier"],
                    "label": DENSITY_TIERS[1]["label"],
                    "lower_bound": min_val,
                    "upper_bound": max_val,
                    "lower_inclusive": True,
                    "upper_inclusive": True,
                    "pixel_count": total,
                    "share_pct": 100.0,
                }
            ],
            "empty_ranks": [2, 3, 4],
            "warnings": [
                "Seluruh piksel positif bernilai identik sehingga tidak dapat dibagi menjadi 4 kelas Quantile."
            ],
        }

    counts = {1: 0, 2: 0, 3: 0, 4: 0}
    for val in sorted_vals:
        if val <= p25:
            counts[1] += 1
        elif val <= p50:
            counts[2] += 1
        elif val <= p75:
            counts[3] += 1
        else:
            counts[4] += 1

    total = len(sorted_vals)
    bounds_spec = [
        (1, min_val, p25, True, True),
        (2, p25, p50, False, True),
        (3, p50, p75, False, True),
        (4, p75, max_val, False, True),
    ]

    thresholds = []
    empty_ranks = []
    for rank, lower, upper, lower_inc, upper_inc in bounds_spec:
        cnt = counts[rank]
        if cnt == 0:
            empty_ranks.append(rank)
        thresholds.append(
            {
                "rank": rank,
                "tier": DENSITY_TIERS[rank]["tier"],
                "label": DENSITY_TIERS[rank]["label"],
                "lower_bound": lower,
                "upper_bound": upper,
                "lower_inclusive": lower_inc,
                "upper_inclusive": upper_inc,
                "pixel_count": cnt,
                "share_pct": round((cnt / total) * 100.0, 2),
            }
        )

    warnings: list[str] = []
    status = "ok"
    if empty_ranks or p25 == p50 or p50 == p75 or min_val == p25 or p75 == max_val:
        status = "degenerate_tied_quantiles"
        warnings.append(
            "Distribusi nilai memiliki ikatan persentil (tied quantiles); sebagian interval kelas kosong: "
            + ", ".join(str(r) for r in empty_ranks)
            if empty_ranks
            else "Distribusi nilai memiliki ikatan batas persentil (tied quantiles)."
        )

    populated_classes = sum(1 for r in (1, 2, 3, 4) if counts[r] > 0)
    return {
        "method": "Quantile",
        "percentile_method": "linear_type7",
        "background_policy": background_policy,
        "status": status,
        "class_count": populated_classes,
        "population": pop_stats,
        "breaks": breaks,
        "thresholds": thresholds,
        "empty_ranks": empty_ranks,
        "warnings": warnings,
    }


def classify_value(
    val: Any,
    classification: dict[str, Any],
    nodata: float | None = None,
    exclude_non_positive: bool = True,
) -> int | None:
    """Mengklasifikasikan satu nilai piksel raster menjadi rank 1..4 atau None untuk NoData/background."""
    if classification.get("status") == "empty" or not classification.get("breaks"):
        return None
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or _is_nodata_value(num, nodata):
        return None
    if exclude_non_positive and num <= 0.0:
        return None

    breaks = classification["breaks"]
    if classification.get("status") == "degenerate_constant":
        return 1

    if num <= breaks["p25"]:
        return 1
    if num <= breaks["p50"]:
        return 2
    if num <= breaks["p75"]:
        return 3
    return 4


def classify_grid(
    values: Any,
    classification: dict[str, Any],
    nodata: float | None = None,
    mask: Any = None,
    output_nodata: int = -9999,
    exclude_non_positive: bool = True,
) -> Any:
    """Mengklasifikasikan grid 1D/2D sesuai hasil compute_quantile_classification tanpa PyQGIS."""
    if isinstance(values, (list, tuple)):
        if mask is not None and isinstance(mask, (list, tuple)) and len(mask) == len(values):
            return [
                classify_grid(
                    v,
                    classification,
                    nodata=nodata,
                    mask=m,
                    output_nodata=output_nodata,
                    exclude_non_positive=exclude_non_positive,
                )
                for v, m in zip(values, mask)
            ]
        return [
            classify_grid(
                v,
                classification,
                nodata=nodata,
                mask=mask,
                output_nodata=output_nodata,
                exclude_non_positive=exclude_non_positive,
            )
            for v in values
        ]

    if mask is not None and not bool(mask):
        return output_nodata
    rank = classify_value(
        values,
        classification,
        nodata=nodata,
        exclude_non_positive=exclude_non_positive,
    )
    return rank if rank is not None else output_nodata


def validate_verified_hotspot_output(payload: Any) -> dict[str, Any]:
    """Memvalidasi payload GeoJSON output KDE terverifikasi sebelum dipublikasikan ke web."""
    errors: list[str] = []
    if not isinstance(payload, dict):
        return {"valid": False, "errors": ["Payload output bukan objek JSON."]}

    if payload.get("isDemo") is not False:
        errors.append("Payload resmi wajib memiliki isDemo === false.")

    data_label = payload.get("dataLabel")
    if not isinstance(data_label, str) or not data_label.strip():
        errors.append("Payload resmi wajib memiliki dataLabel non-kosong.")
    elif is_demo_label(data_label):
        errors.append("Payload resmi dilarang memiliki dataLabel DEMO.")

    fc = payload.get("zones") if isinstance(payload.get("zones"), dict) else payload
    if fc.get("type") != "FeatureCollection" or not isinstance(fc.get("features"), list):
        errors.append("Output wajib berupa FeatureCollection GeoJSON dengan daftar features.")
    elif len(fc["features"]) == 0:
        errors.append("FeatureCollection output tidak boleh kosong.")

    analysis = payload.get("analysis") if isinstance(payload.get("analysis"), dict) else payload.get("metadata")
    if not isinstance(analysis, dict):
        errors.append("Metadata analisis KDE wajib tersedia pada field 'analysis'.")
    else:
        for req_str in ("source", "period_label", "kernel_method", "working_crs", "classification_method"):
            val = analysis.get(req_str)
            if not isinstance(val, str) or not val.strip():
                errors.append(f"Metadata analysis.{req_str} wajib berupa string non-kosong.")
            elif req_str in ("source", "period_label") and is_demo_label(val):
                errors.append(f"Metadata analysis.{req_str} tidak boleh berlabel DEMO.")

        for req_pos in ("bandwidth_meters", "pixel_size_meters"):
            val = analysis.get(req_pos)
            if not _is_finite_number(val) or float(val) <= 0:
                errors.append(f"Metadata analysis.{req_pos} wajib angka positif.")

        inc_count = analysis.get("incident_count_used")
        if not isinstance(inc_count, int) or isinstance(inc_count, bool) or inc_count < 1:
            errors.append("Metadata analysis.incident_count_used wajib bilangan bulat >= 1.")

    if isinstance(fc, dict) and isinstance(fc.get("features"), list):
        for idx, feat in enumerate(fc["features"]):
            if not isinstance(feat, dict) or feat.get("type") != "Feature":
                errors.append(f"features[{idx}] bukan GeoJSON Feature.")
                continue
            geom_check = validate_boundary_geojson(feat.get("geometry"))
            if not geom_check["valid"]:
                errors.append(f"features[{idx}].geometry tidak valid: {'; '.join(geom_check['errors'])}")
            props = feat.get("properties")
            if not isinstance(props, dict):
                errors.append(f"features[{idx}].properties wajib berupa objek.")
                continue
            if props.get("isDemo") is True:
                errors.append(f"features[{idx}] memiliki isDemo === true.")
            if is_demo_label(props.get("dataLabel")):
                errors.append(f"features[{idx}] memiliki dataLabel DEMO.")
            if not isinstance(props.get("zone_id"), str) or not props["zone_id"].strip():
                errors.append(f"features[{idx}].properties.zone_id wajib string non-kosong.")

            rank = props.get("density_rank")
            if not isinstance(rank, int) or isinstance(rank, bool) or rank not in DENSITY_TIERS:
                errors.append(f"features[{idx}].properties.density_rank harus integer 1..4.")
            d_class = str(props.get("density_class") or "").strip()
            if is_demo_label(d_class):
                errors.append(f"features[{idx}].properties.density_class mengandung label DEMO.")
            mapped_rank = TIER_LABEL_TO_RANK.get(d_class.lower())
            if mapped_rank is None or (rank in DENSITY_TIERS and mapped_rank != rank):
                errors.append(f"features[{idx}] density_class '{d_class}' tidak cocok dengan density_rank {rank}.")

            area = props.get("area_km2")
            if not _is_finite_number(area) or float(area) < 0:
                errors.append(f"features[{idx}].properties.area_km2 harus angka >= 0.")

    return {"valid": len(errors) == 0, "errors": errors}
