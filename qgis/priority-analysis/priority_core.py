"""
Logika murni Fire Service Priority Planner Kota Medan (tanpa ketergantungan PyQGIS).

Menghitung indeks prioritas layanan kebakaran untuk 21 kecamatan (`12.71.01`..`12.71.21`)
dengan tiga faktor terintegrasi:
1. hotspot_score (40%): intensitas beban kebakaran historis 2023 per 10.000 penduduk (bukan KDE).
2. coverage_gap_score (35%): rasio wilayah belum terjangkau service area 5 km jaringan jalan OSM.
3. population_exposure_score (25%): kepadatan penduduk BPS 2025 per km2 (indikator paparan, bukan korban/prediksi).
"""

from __future__ import annotations

import math
from typing import Any, Iterable

EXPECTED_AREA_CODES = tuple(f"12.71.{idx:02d}" for idx in range(1, 22))
DEFAULT_WEIGHTS = {
    "hotspot_intensity": 0.40,
    "coverage_gap": 0.35,
    "population_exposure": 0.25,
}
METHOD_VERSION = "priority-v1.0-provisional"
PRIORITY_TIERS = ("Rendah", "Sedang", "Tinggi", "Sangat Tinggi")


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _parse_finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        fval = float(value)
        return fval if math.isfinite(fval) else None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            fval = float(text)
            return fval if math.isfinite(fval) else None
        except ValueError:
            return None
    return None


def validate_weights(weights: dict[str, Any]) -> dict[str, float]:
    """Memastikan bobot ketiga faktor lengkap, non-negatif, dan berjumlah tepat 1.0 (100%)."""
    if not isinstance(weights, dict):
        raise ValueError("Bobot harus berupa dictionary.")
    required = ("hotspot_intensity", "coverage_gap", "population_exposure")
    parsed: dict[str, float] = {}
    for key in required:
        val = weights.get(key)
        if not _is_finite_number(val) or float(val) < 0.0:
            raise ValueError(f"Bobot '{key}' wajib berupa angka >= 0.")
        parsed[key] = float(val)
    total = sum(parsed.values())
    if not math.isclose(total, 1.0, rel_tol=1e-6, abs_tol=1e-6):
        raise ValueError(f"Total bobot wajib berjumlah 1.0 (100%), saat ini {total:.4f}.")
    return parsed


def _compute_quantile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        raise ValueError("Populasi kosong.")
    pos = q * (len(sorted_vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    return float(sorted_vals[lo] + (pos - lo) * (sorted_vals[hi] - sorted_vals[lo]))


def min_max_normalize(values_by_code: dict[str, Any]) -> dict[str, Any]:
    """
    Normalisasi Min-Max konsisten pada 21 kecamatan: (x - min) / (max - min).

    Menangani:
    - Nilai None/non-finite (ditolak secara eksplisit, tidak pernah dianggap nol diam-diam).
    - Distribusi konstan (max == min -> skor seragam 0.5 dengan catatan peringatan).
    - Deteksi outlier metode IQR (dicatat pada metadata tanpa memanipulasi nilai asli).
    """
    if not values_by_code:
        raise ValueError("Tidak ada nilai untuk dinormalisasi.")

    parsed: dict[str, float] = {}
    for code, raw_val in values_by_code.items():
        if raw_val is None or not _is_finite_number(raw_val):
            raise ValueError(f"Nilai indikator untuk {code} kosong/tidak valid ({raw_val}); tidak boleh dianggap nol.")
        parsed[code] = float(raw_val)

    vals = sorted(parsed.values())
    min_val = vals[0]
    max_val = vals[-1]
    q1 = _compute_quantile(vals, 0.25)
    q3 = _compute_quantile(vals, 0.75)
    iqr = q3 - q1
    upper_fence = q3 + 1.5 * iqr
    lower_fence = q1 - 1.5 * iqr
    outliers = [code for code, v in parsed.items() if iqr > 0 and (v > upper_fence or v < lower_fence)]

    warnings: list[str] = []
    if math.isclose(max_val, min_val, rel_tol=1e-12, abs_tol=1e-12):
        scores = {code: 0.5 for code in parsed}
        warnings.append("Seluruh kecamatan memiliki nilai indikator identik; skor normalisasi diset 0.50.")
    else:
        span = max_val - min_val
        scores = {code: round(max(0.0, min(1.0, (v - min_val) / span)), 6) for code, v in parsed.items()}

    if outliers:
        warnings.append(f"Terdeteksi outlier statistik (metode 1.5*IQR) pada kode: {', '.join(sorted(outliers))}.")

    return {
        "method": "Min-Max ((x - min) / (max - min))",
        "direction": "benefit (nilai mentah lebih tinggi -> skor lebih tinggi -> prioritas lebih tinggi)",
        "min": min_val,
        "max": max_val,
        "outliers": sorted(outliers),
        "warnings": warnings,
        "scores": scores,
    }


def validate_and_join_districts(
    fire_districts: Iterable[dict[str, Any]],
    pop_rows: Iterable[dict[str, Any]],
    boundary_geojson: dict[str, Any],
    coverage_rows: Iterable[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Memvalidasi dan menggabungkan tepat 21 kecamatan menggunakan primary key `area_code` (12.71.01..12.71.21).
    Mendeteksi kode ganda, kecamatan hilang, dan nilai null tanpa mengubah nilai hilang menjadi nol.
    """
    def _index_by_code(items: Iterable[dict[str, Any]], source_label: str) -> dict[str, dict[str, Any]]:
        indexed: dict[str, dict[str, Any]] = {}
        duplicates: list[str] = []
        for row in items:
            if not isinstance(row, dict):
                continue
            code = str(row.get("area_code") or "").strip()
            if not code:
                raise ValueError(f"Ditemukan baris tanpa area_code pada sumber {source_label}.")
            if code in indexed:
                duplicates.append(code)
            else:
                indexed[code] = row
        if duplicates:
            raise ValueError(f"Kode area ganda pada {source_label}: {', '.join(sorted(set(duplicates)))}.")
        missing = [c for c in EXPECTED_AREA_CODES if c not in indexed]
        if missing:
            raise ValueError(f"Kecamatan hilang pada {source_label}: {', '.join(missing)}.")
        extra = [c for c in indexed if c not in EXPECTED_AREA_CODES]
        if extra:
            raise ValueError(f"Kode kecamatan tidak dikenal pada {source_label}: {', '.join(sorted(extra))}.")
        return indexed

    fire_by_code = _index_by_code(fire_districts, "fire_districts_2023")
    pop_by_code = _index_by_code(pop_rows, "population_2025")

    boundary_features = []
    for feat in (boundary_geojson or {}).get("features", []):
        props = feat.get("properties") or {}
        boundary_features.append({"area_code": props.get("area_code"), **props})
    boundary_by_code = _index_by_code(boundary_features, "medan_districts_osm")

    coverage_by_code: dict[str, dict[str, Any]] | None = None
    coverage_available = False
    coverage_note = "Analisis kesenjangan jangkauan layanan (Station Coverage) belum tersedia."

    if coverage_rows is not None:
        cov_list = list(coverage_rows)
        if cov_list:
            coverage_by_code = _index_by_code(cov_list, "station_coverage")
            has_all_gaps = all(
                _is_finite_number(coverage_by_code[c].get("network_5km_gap_ratio"))
                for c in EXPECTED_AREA_CODES
            )
            if has_all_gaps:
                coverage_available = True
                coverage_note = (
                    "Menggunakan kesenjangan jangkauan jaringan jalan 5 km (OSM) dari satu stasiun "
                    "terverifikasi (Mako 0.0); berstatus PROVISIONAL karena pos UPT belum terverifikasi."
                )

    joined: list[dict[str, Any]] = []
    anomalies: list[str] = []
    for code in EXPECTED_AREA_CODES:
        f_row = fire_by_code[code]
        p_row = pop_by_code[code]
        b_row = boundary_by_code[code]

        raw_inc = f_row.get("total_incidents")
        raw_pop = p_row.get("population_2025_bps") if p_row.get("population_2025_bps") is not None else p_row.get("population_2025")
        raw_dens = p_row.get("density_km2_2025_bps") if p_row.get("density_km2_2025_bps") is not None else p_row.get("density_km2_2025")

        inc_2023 = _parse_finite_number(raw_inc)
        pop_2025 = _parse_finite_number(raw_pop)
        dens_2025 = _parse_finite_number(raw_dens)

        if inc_2023 is None or inc_2023 < 0:
            raise ValueError(f"Nilai incidents_2023 pada {code} kosong/tidak valid ({raw_inc}).")
        if pop_2025 is None or pop_2025 <= 0:
            raise ValueError(f"Nilai population_2025 pada {code} kosong/tidak valid ({raw_pop}).")
        if dens_2025 is None or dens_2025 <= 0:
            raise ValueError(f"Nilai density_km2_2025 pada {code} kosong/tidak valid ({raw_dens}).")

        area_name = str(b_row.get("district_name") or p_row.get("district_name") or f_row.get("district_name")).strip()
        scale_disc = int(f_row.get("scale_discrepancy") or 0)
        if scale_disc != 0:
            anomalies.append(f"{area_name} ({code}): selisih {scale_disc:+d} antara rekap objek vs skala 2023.")

        cov_row = coverage_by_code[code] if coverage_by_code else {}
        joined.append(
            {
                "area_code": code,
                "area_name": area_name,
                "incidents_2023": int(round(inc_2023)),
                "scale_discrepancy_2023": scale_disc,
                "population_2025": int(round(pop_2025)),
                "density_km2_2025": float(dens_2025),
                "network_5km_coverage_pct": cov_row.get("network_5km_coverage_pct") if coverage_available else None,
                "network_5km_gap_ratio": float(cov_row["network_5km_gap_ratio"]) if coverage_available else None,
                "centroid_distance_m_mako": cov_row.get("centroid_distance_m_mako") if coverage_available else None,
            }
        )

    return {
        "rows": joined,
        "coverage_available": coverage_available,
        "coverage_note": coverage_note,
        "qa_anomalies": anomalies,
    }


def _assign_priority_tier(score: float, q25: float, q50: float, q75: float) -> str:
    if score <= q25:
        return "Rendah"
    if score <= q50:
        return "Sedang"
    if score <= q75:
        return "Tinggi"
    return "Sangat Tinggi"


def _build_priority_reason(row: dict[str, Any], coverage_available: bool) -> str:
    rate = row["incidents_per_10k_2023"]
    dens = int(round(row["density_km2_2025"]))
    if not coverage_available:
        return (
            f"Hasil parsial (tanpa ranking final): beban historis 2023 sebesar {row['incidents_2023']} kejadian "
            f"({rate:.2f} per 10.000 jiwa) dan kepadatan paparan penduduk {dens:,} jiwa/km2; "
            "coverage_gap_score tidak tersedia."
        ).replace(",", ".")

    contributions = [
        ("beban kebakaran historis 2023", row["hotspot_score"]),
        ("kesenjangan jangkauan jaringan 5 km dari Mako 0.0", row["coverage_gap_score"]),
        ("kepadatan paparan penduduk 2025", row["population_exposure_score"]),
    ]
    contributions.sort(key=lambda item: item[1], reverse=True)
    dominant_label, _ = contributions[0]
    cov_pct = row["network_5km_coverage_pct"]
    return (
        f"Faktor tertinggi berasal dari {dominant_label}. "
        f"Tercatat {row['incidents_2023']} kejadian tahun 2023 ({rate:.2f} per 10.000 jiwa, bukan KDE), "
        f"cakupan jaringan 5 km Mako 0.0 sebesar {cov_pct:.1f}% (gap {(100.0 - cov_pct):.1f}%), "
        f"dan paparan kepadatan {dens:,} jiwa/km2."
    ).replace(",", ".")


def compute_priority_scores(
    joined_rows: list[dict[str, Any]],
    weights: dict[str, float] | None = None,
    coverage_available: bool = True,
    data_label: str = "PROVISIONAL",
) -> dict[str, Any]:
    """Menghitung skor normalisasi, skor komposit, tier kuantil, dan alasan prioritas untuk 21 kecamatan."""
    active_weights = validate_weights(weights or DEFAULT_WEIGHTS)
    if len(joined_rows) != 21:
        raise ValueError(f"Wajib tepat 21 kecamatan, diterima {len(joined_rows)}.")

    rate_map = {
        row["area_code"]: (row["incidents_2023"] / row["population_2025"]) * 10000.0
        for row in joined_rows
    }
    exposure_map = {row["area_code"]: row["density_km2_2025"] for row in joined_rows}

    hotspot_norm = min_max_normalize(rate_map)
    exposure_norm = min_max_normalize(exposure_map)

    all_gaps_present = coverage_available and all(
        _is_finite_number(row.get("network_5km_gap_ratio")) for row in joined_rows
    )

    if not all_gaps_present:
        partial_zones = []
        for row in joined_rows:
            code = row["area_code"]
            inc_rate = round(rate_map[code], 4)
            partial_row = {
                **row,
                "incidents_per_10k_2023": inc_rate,
                "hotspot_score": hotspot_norm["scores"][code],
                "coverage_gap_score": None,
                "population_exposure_score": exposure_norm["scores"][code],
                "composite_score": None,
                "priority_rank": None,
                "priority_tier": "Parsial (Data Jangkauan Belum Tersedia)",
                "isDemo": False,
                "dataLabel": data_label,
            }
            partial_row["priority_reason"] = _build_priority_reason(partial_row, False)
            partial_zones.append(partial_row)

        return {
            "mode": "partial",
            "weights": active_weights,
            "normalization": {
                "hotspot_intensity": hotspot_norm,
                "coverage_gap": None,
                "population_exposure": exposure_norm,
            },
            "tier_breaks": None,
            "zones": partial_zones,
        }

    gap_map = {row["area_code"]: float(row["network_5km_gap_ratio"]) for row in joined_rows}
    gap_norm = min_max_normalize(gap_map)

    scored_rows = []
    for row in joined_rows:
        code = row["area_code"]
        h_score = hotspot_norm["scores"][code]
        c_score = gap_norm["scores"][code]
        p_score = exposure_norm["scores"][code]
        comp = round(
            max(
                0.0,
                min(
                    1.0,
                    active_weights["hotspot_intensity"] * h_score
                    + active_weights["coverage_gap"] * c_score
                    + active_weights["population_exposure"] * p_score,
                ),
            ),
            6,
        )
        scored_rows.append(
            {
                **row,
                "incidents_per_10k_2023": round(rate_map[code], 4),
                "hotspot_score": h_score,
                "coverage_gap_score": c_score,
                "population_exposure_score": p_score,
                "composite_score": comp,
                "isDemo": False,
                "dataLabel": data_label,
            }
        )

    sorted_scores = sorted(r["composite_score"] for r in scored_rows)
    q25 = _compute_quantile(sorted_scores, 0.25)
    q50 = _compute_quantile(sorted_scores, 0.50)
    q75 = _compute_quantile(sorted_scores, 0.75)

    scored_rows.sort(key=lambda r: (-r["composite_score"], -r["incidents_2023"], r["area_code"]))
    for rank, row in enumerate(scored_rows, start=1):
        row["priority_rank"] = rank
        row["priority_tier"] = _assign_priority_tier(row["composite_score"], q25, q50, q75)
        row["priority_reason"] = _build_priority_reason(row, True)

    return {
        "mode": "provisional",
        "weights": active_weights,
        "normalization": {
            "hotspot_intensity": {k: v for k, v in hotspot_norm.items() if k != "scores"},
            "coverage_gap": {k: v for k, v in gap_norm.items() if k != "scores"},
            "population_exposure": {k: v for k, v in exposure_norm.items() if k != "scores"},
        },
        "tier_breaks": {"q25": round(q25, 6), "q50": round(q50, 6), "q75": round(q75, 6)},
        "zones": scored_rows,
    }


def validate_priority_output(payload: Any) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return {"valid": False, "errors": ["Payload priority-planner bukan objek JSON."]}
    if payload.get("isDemo") is not False:
        errors.append("Output resmi/provisional wajib memiliki isDemo === false.")
    label = str(payload.get("dataLabel") or "").strip().upper()
    if not label or "DEMO" in label:
        errors.append("dataLabel tidak boleh kosong atau DEMO.")

    analysis = payload.get("analysis")
    required_meta = (
        "period_label",
        "sources",
        "weights",
        "normalization_method",
        "composite_formula",
        "data_status",
        "limitations",
        "method_version",
    )
    if not isinstance(analysis, dict):
        errors.append("Metadata analysis wajib tersedia.")
    else:
        for key in required_meta:
            if not analysis.get(key):
                errors.append(f"Metadata analysis.{key} wajib tersedia.")

    zones = payload.get("zones")
    if not isinstance(zones, list) or len(zones) != 21:
        errors.append("zones wajib memuat tepat 21 kecamatan.")
    else:
        codes = set()
        required_fields = (
            "area_code",
            "area_name",
            "incidents_2023",
            "population_2025",
            "density_km2_2025",
            "hotspot_score",
            "coverage_gap_score",
            "population_exposure_score",
            "composite_score",
            "priority_tier",
            "priority_reason",
            "isDemo",
            "dataLabel",
        )
        for idx, z in enumerate(zones):
            for f in required_fields:
                if f not in z:
                    errors.append(f"zones[{idx}] kekurangan field '{f}'.")
            codes.add(z.get("area_code"))
            if z.get("isDemo") is not False or "DEMO" in str(z.get("dataLabel") or "").upper():
                errors.append(f"zones[{idx}] berlabel DEMO.")
            for s_key in ("hotspot_score", "coverage_gap_score", "population_exposure_score", "composite_score"):
                val = z.get(s_key)
                if val is not None and (not _is_finite_number(val) or float(val) < 0.0 or float(val) > 1.0):
                    errors.append(f"zones[{idx}].{s_key} di luar rentang [0, 1]: {val}")
        if codes != set(EXPECTED_AREA_CODES):
            errors.append("Kode area kecamatan pada zones tidak lengkap.")

    return {"valid": len(errors) == 0, "errors": errors}
