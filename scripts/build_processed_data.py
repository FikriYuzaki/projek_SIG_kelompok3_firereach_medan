"""Reproducible builder that validates and structures raw FireReach Medan data."""

import csv
import hashlib
import json
import math
import os
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_SATU = ROOT / "data" / "raw" / "satudata-medan"
RAW_OSM = ROOT / "data" / "raw" / "osm-overpass"
PROCESSED = ROOT / "data" / "processed"
PUBLIC_DATA = ROOT / "public" / "data"
PUBLIC_DEMO = PUBLIC_DATA / "demo"

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

MEDAN_BOUNDS = {"min_lon": 98.55, "max_lon": 98.78, "min_lat": 3.45, "max_lat": 3.85}


def col_to_idx(ref: str) -> int:
    col = "".join(c for c in ref if c.isalpha())
    idx = 0
    for ch in col:
        idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
    return idx - 1


def read_xlsx_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path, "r") as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("a:si", NS):
                shared.append(
                    "".join(
                        t.text or ""
                        for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                    )
                )
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        first_sheet = wb.find(".//a:sheet", NS)
        rid = first_sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = rel_map[rid].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        sroot = ET.fromstring(z.read(target))
        rows = []
        for row in sroot.findall(".//a:sheetData/a:row", NS):
            vals = {}
            max_c = -1
            for c in row.findall("a:c", NS):
                idx = col_to_idx(c.attrib.get("r", "A1"))
                max_c = max(max_c, idx)
                t = c.attrib.get("t", "")
                v_el = c.find("a:v", NS)
                is_el = c.find("a:is", NS)
                val = ""
                if t == "s" and v_el is not None and v_el.text is not None:
                    val = shared[int(v_el.text)]
                elif t == "inlineStr" and is_el is not None:
                    val = "".join(
                        x.text or ""
                        for x in is_el.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                    )
                elif v_el is not None and v_el.text is not None:
                    val = v_el.text
                vals[idx] = val.strip()
            if max_c >= 0:
                arr = [vals.get(i, "") for i in range(max_c + 1)]
                if any(arr):
                    rows.append(arr)
        return rows


def clean_int(val: str) -> int:
    s = val.replace("\xa0", "").strip()
    if s in ("", "-", "–"):
        return 0
    val_int = int(float(s))
    assert val_int >= 0, f"Unexpected negative integer in spreadsheet: {val!r}"
    return val_int


def norm_label(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()
    return " ".join(w.capitalize() for w in cleaned.split(" ")) if cleaned else ""


def norm_district(name: str) -> str:
    return norm_label(name)


def parse_dotted_int(val: str) -> int | None:
    digits = re.sub(r"[^\d]", "", val or "")
    return int(digits) if digits else None


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_canonical_text_bytes(path: Path) -> bytes:
    """Return UTF-8 bytes with CRLF and CR normalized to LF for cross-OS determinism."""
    return path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def sha256_text_asset(path: Path) -> tuple[str, int]:
    """Compute deterministic SHA-256 hex digest and LF byte size for text JSON assets."""
    normalized = read_canonical_text_bytes(path)
    return hashlib.sha256(normalized).hexdigest(), len(normalized)


def perp_dist(pt, a, b):
    if a == b:
        return math.hypot(pt[0] - a[0], pt[1] - a[1])
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy))


def simplify_ring(ring: list[list[float]], tol: float = 0.00022) -> list[list[float]]:
    if len(ring) <= 12:
        return [[round(p[0], 5), round(p[1], 5)] for p in ring]

    def dp(pts):
        if len(pts) <= 2:
            return pts
        dmax = 0.0
        idx = 0
        for i in range(1, len(pts) - 1):
            d = perp_dist(pts[i], pts[0], pts[-1])
            if d > dmax:
                dmax = d
                idx = i
        if dmax > tol:
            left = dp(pts[: idx + 1])
            right = dp(pts[idx:])
            return left[:-1] + right
        return [pts[0], pts[-1]]

    out = dp(ring[:-1])
    if len(out) < 3:
        out = ring[:-1]
    rounded = [[round(p[0], 5), round(p[1], 5)] for p in out]
    if rounded[0] != rounded[-1]:
        rounded.append(rounded[0])
    return rounded


MONTH_NAME_TO_NUM = {
    "januari": 1,
    "februari": 2,
    "maret": 3,
    "april": 4,
    "mei": 5,
    "juni": 6,
    "juli": 7,
    "agustus": 8,
    "september": 9,
    "oktober": 10,
    "november": 11,
    "desember": 12,
}


def norm_bpbd_district(raw_name: str) -> str:
    stripped = re.sub(r"^\s*kecamatan\s+", "", str(raw_name or ""), flags=re.IGNORECASE)
    return norm_district(stripped)


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_geom(lon: float, lat: float, geom: dict) -> bool:
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        if not coords or not point_in_ring(lon, lat, coords[0]):
            return False
        return not any(point_in_ring(lon, lat, hole) for hole in coords[1:])
    if gtype == "MultiPolygon":
        for poly in coords:
            if poly and point_in_ring(lon, lat, poly[0]):
                if not any(point_in_ring(lon, lat, hole) for hole in poly[1:]):
                    return True
        return False
    return False


def validate_ring_extent(ring: list[list[float]], label: str):
    assert len(ring) >= 4, f"{label}: ring has fewer than 4 points"
    assert ring[0] == ring[-1], f"{label}: ring is not closed"
    for lon, lat in ring:
        assert MEDAN_BOUNDS["min_lon"] <= lon <= MEDAN_BOUNDS["max_lon"], f"{label}: lon {lon} out of extent"
        assert MEDAN_BOUNDS["min_lat"] <= lat <= MEDAN_BOUNDS["max_lat"], f"{label}: lat {lat} out of extent"


def parse_monthly_2016_2021(annual_lookup: dict[int, int]) -> list[dict]:
    rows = read_xlsx_rows(
        RAW_SATU / "Daftar_Jumlah_Kebakaran_Per_Bulan_Di_Kota_Medan_Tahun_2016_-_2021_Bulanan.xlsx"
    )
    assert len(rows) == 73, f"Expected 73 rows in 2016-2021 monthly workbook, got {len(rows)}"
    parsed = []
    seen = set()
    for r in rows[1:]:
        mname = norm_label(r[0])
        mnum = MONTH_NAME_TO_NUM[mname.lower()]
        yr = int(float(r[2]))
        assert 2016 <= yr <= 2021, f"Unexpected year in 2016-2021 monthly: {yr}"
        assert (yr, mnum) not in seen, f"Duplicate month {(yr, mnum)}"
        seen.add((yr, mnum))
        total = clean_int(r[1])
        parsed.append({
            "period_year": yr,
            "month_number": mnum,
            "month_name": mname,
            "display_label": f"{mname} {yr}",
            "total_incidents": total,
            "granularity": "monthly_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "source_name": "Satu Data Medan (Dinas Damkarmat)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01jrymvexvvp9g4bg9z50xpvxp",
        })
    parsed.sort(key=lambda x: (x["period_year"], x["month_number"]))
    assert len(parsed) == 72
    assert sum(p["total_incidents"] for p in parsed) == 1372
    for yr in range(2016, 2022):
        yr_sum = sum(p["total_incidents"] for p in parsed if p["period_year"] == yr)
        assert yr_sum == annual_lookup[yr], f"2016-2021 monthly mismatch for {yr}: {yr_sum} != {annual_lookup[yr]}"
    return parsed


def parse_bpbd_comparison(pop_by_name: dict, annual_lookup: dict[int, int]) -> dict:
    bpbd21_rows = read_xlsx_rows(RAW_SATU / "BPBD_Rekapitulasi_Bencana_Tahun_2021.xlsx")
    district_2021 = []
    for raw_r in bpbd21_rows[1:]:
        r = list(raw_r) + [""] * max(0, 9 - len(raw_r))
        dname = norm_bpbd_district(r[0])
        meta = pop_by_name[dname]
        keb = clean_int(r[1])
        banjir = clean_int(r[2])
        angin = clean_int(r[3])
        longsor = clean_int(r[4])
        lain = clean_int(r[5])
        district_2021.append({
            "area_code": meta["area_code"],
            "district_name": dname,
            "period_year": 2021,
            "fire_incidents": keb,
            "flood_events": banjir,
            "wind_events": angin,
            "landslide_events": longsor,
            "other_events": lain,
            "total_disasters": keb + banjir + angin + longsor + lain,
            "affected_people": clean_int(r[6]),
            "fatalities": clean_int(r[7]),
            "injured": clean_int(r[8]),
            "granularity": "district_aggregate",
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "geom": None,
            "source_name": "BPBD Kota Medan (via Satu Data Medan)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01k3msptkv0gdddt5d97r55rk2",
        })
    assert len(district_2021) == 21
    assert sum(d["fire_incidents"] for d in district_2021) == 108
    assert sum(d["total_disasters"] for d in district_2021) == 152

    bpbd22_rows = read_xlsx_rows(RAW_SATU / "BPBD_Rekapitulasi_Kebencanaan_Perkecamatan_Tahun_2022.xlsx")
    b21_by_name = {d["district_name"]: d for d in district_2021}
    district_2022 = []
    reported_total_row = None
    for raw_r in bpbd22_rows[1:]:
        r = list(raw_r) + [""] * max(0, 6 - len(raw_r))
        if norm_label(r[0]).lower() == "jumlah":
            reported_total_row = r
            continue
        dname = norm_bpbd_district(r[0])
        meta = pop_by_name[dname]
        keb = clean_int(r[1])
        banjir = clean_int(r[2])
        angin = clean_int(r[3])
        longsor = clean_int(r[4])
        tot = clean_int(r[5])
        assert keb + banjir + angin + longsor == tot, f"BPBD 2022 row mismatch in {dname}"
        d21 = b21_by_name[dname]
        district_2022.append({
            "area_code": meta["area_code"],
            "district_name": dname,
            "period_year": 2022,
            "total_incidents": keb,
            "fire_incidents": keb,
            "fire_incidents_2021": d21["fire_incidents"],
            "flood_events": banjir,
            "wind_events": angin,
            "landslide_events": longsor,
            "total_disasters": tot,
            "total_disasters_2021": d21["total_disasters"],
            "granularity": "district_aggregate",
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "geom": None,
            "source_name": "BPBD Kota Medan (via Satu Data Medan)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01jvv2a8j83ybhn6z5xjpw9znp",
        })
    assert len(district_2022) == 21
    assert sum(d["fire_incidents"] for d in district_2022) == 138
    assert sum(d["total_disasters"] for d in district_2022) == 187
    assert reported_total_row is not None and clean_int(reported_total_row[4]) == 0

    def parse_bpbd_monthly(fp: Path, year: int, resource_id: str) -> list[dict]:
        rows = read_xlsx_rows(fp)
        out = []
        for idx, r in enumerate(rows[1:], start=1):
            mname = norm_label(r[0])
            keb = clean_int(r[1])
            banjir = clean_int(r[2])
            angin = clean_int(r[3])
            longsor = clean_int(r[4])
            tot = clean_int(r[5])
            assert keb + banjir + angin + longsor == tot, f"BPBD monthly mismatch {year} {mname}"
            out.append({
                "period_year": year,
                "month_number": idx,
                "month_name": mname,
                "display_label": f"{mname} {year}",
                "fire_incidents": keb,
                "flood_events": banjir,
                "wind_events": angin,
                "landslide_events": longsor,
                "total_disasters": tot,
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "verification_status": "unlocated",
                "geom": None,
                "source_name": "BPBD Kota Medan (via Satu Data Medan)",
                "source_url": f"https://medanterkini.medan.go.id/api/resources/download/{resource_id}",
            })
        assert len(out) == 12
        return out

    monthly_2022 = parse_bpbd_monthly(
        RAW_SATU / "BPBD_Rekapitulasi_Bencana_Jenis_Bulanan_2022.xlsx",
        2022,
        "01k46rrywpd6yjr87zjn6mpgy9",
    )
    monthly_2023 = parse_bpbd_monthly(
        RAW_SATU / "BPBD_Jumlah_Kejadian_Kebencanaan_Jenis_Bulanan_2023.xlsx",
        2023,
        "01k4pb0g0t6x05m7r8setmd2sk",
    )
    assert sum(m["fire_incidents"] for m in monthly_2022) == 138
    assert sum(m["fire_incidents"] for m in monthly_2023) == 87

    bpbd_ann_rows = read_xlsx_rows(RAW_SATU / "BPBD_Data_Rekapitulasi_Kebencanaan_2021_2022.xlsx")
    bpbd_ann_map = {clean_int(re.sub(r"[^\d]", "", r[0])): clean_int(r[1]) for r in bpbd_ann_rows[1:]}
    assert bpbd_ann_map[2021] == 152 and bpbd_ann_map[2022] == 187

    annual_summary = [
        {
            "year": 2021,
            "bpbd_fire_incidents": 108,
            "bpbd_total_disasters": bpbd_ann_map[2021],
            "damkarmat_fire_incidents": annual_lookup[2021],
            "difference_damkar_minus_bpbd": annual_lookup[2021] - 108,
            "has_district_breakdown": True,
            "note": "BPBD mencatat kejadian berstatus bencana/kedaruratan (108 kebakaran); Damkarmat mencatat total operasi penanggulangan kebakaran (207).",
        },
        {
            "year": 2022,
            "bpbd_fire_incidents": 138,
            "bpbd_total_disasters": bpbd_ann_map[2022],
            "damkarmat_fire_incidents": annual_lookup[2022],
            "difference_damkar_minus_bpbd": annual_lookup[2022] - 138,
            "has_district_breakdown": True,
            "note": "BPBD mencatat 138 kebakaran (kecamatan & bulanan konsisten); Damkarmat mencatat 216 kejadian.",
        },
        {
            "year": 2023,
            "bpbd_fire_incidents": 87,
            "bpbd_total_disasters": sum(m["total_disasters"] for m in monthly_2023),
            "damkarmat_fire_incidents": annual_lookup[2023],
            "difference_damkar_minus_bpbd": annual_lookup[2023] - 87,
            "has_district_breakdown": False,
            "note": "BPBD 2023 hanya tersedia pada granularitas bulanan (87 kebakaran / 116 bencana) sedangkan Damkarmat 2023 mencatat 219 kebakaran.",
        },
    ]

    return {
        "is_comparison_only": True,
        "scope_note": "Dataset BPBD Kota Medan disajikan sebagai pembanding lintas instansi dan tidak digabung ke angka resmi Dinas Damkarmat karena perbedaan definisi pencatatan kejadian.",
        "annual_summary": annual_summary,
        "district_2021": district_2021,
        "district_2022": district_2022,
        "monthly_2022": monthly_2022,
        "monthly_2023": monthly_2023,
    }


def parse_damkarmat_spm() -> list[dict]:
    rows = read_xlsx_rows(
        RAW_SATU / "Target_Dan_Realisasi_Pencapaian_Standar_Pelayanan_Dinas_Pemadam_Kebakaran_Dan_Penyelamatan..xlsx"
    )
    assert len(rows) == 3, f"Expected 3 rows in SPM workbook, got {len(rows)}"
    out = []
    for r in rows[1:]:
        indicator = re.sub(r"\s+", " ", r[1]).strip()
        target_val = float(r[2])
        real_val = float(r[3])
        capaian_val = float(r[4])
        unit = "menit" if "menit" in indicator.lower() or "respons time" in indicator.lower() else "%"
        out.append({
            "indicator_number": int(float(r[0])),
            "indicator_name": indicator,
            "unit": unit,
            "target_value": target_val,
            "realization_value": real_val,
            "achievement_pct": capaian_val,
            "raw_target": r[2],
            "raw_realization": r[3],
            "source_name": "Satu Data Medan (Dinas Damkarmat)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01k87f0pqenry2bkvy0mvazah2",
        })
    return out


def parse_non_fire_rescues() -> dict:
    specs = [
        (2023, "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2023.xlsx", 1, "01m36gzes0mxtmd6ykm1367ggn"),
        (2024, "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2024.xlsx", 0, "01m36ja2y8a9j0h0mdadc7f4sx"),
        (2025, "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2025.xlsx", 0, "01m36kf1esskwdhks8xh35z5sj"),
    ]
    monthly_series = []
    annual_totals = []
    anomalies_detected = []
    for yr, fname, hdr_idx, res_id in specs:
        rows = read_xlsx_rows(RAW_SATU / fname)
        headers = [re.sub(r"\s+", " ", h).strip().upper() for h in rows[hdr_idx]]
        cat_headers = headers[3:-1]
        year_sum_reported = 0
        year_sum_right = 0
        for r in rows[hdr_idx + 1 : -1]:
            mnum = int(float(r[0]))
            mname = norm_label(r[1])
            left_total = clean_int(r[2])
            right_total = clean_int(r[-1])
            cat_values = {}
            for col_idx, ch in enumerate(cat_headers, start=3):
                val = clean_int(r[col_idx]) if col_idx < len(r) else 0
                if val > 0:
                    cat_values[ch.lower().replace(" / ", "_").replace(" ", "_")] = val
            right_calc = sum(cat_values.values())
            assert right_calc == right_total, f"Non-fire right sum mismatch {yr} {mname}: {right_calc} vs {right_total}"
            discrepancy = left_total - right_total
            if discrepancy != 0:
                anomalies_detected.append(
                    f"{mname} {yr}: total kolom kiri={left_total} vs jumlah kategori kanan={right_total} (selisih {discrepancy:+d})"
                )
            year_sum_reported += left_total
            year_sum_right += right_total
            top_cat_key = max(cat_values, key=lambda k: cat_values[k]) if cat_values else None
            monthly_series.append({
                "period_year": yr,
                "month_number": mnum,
                "month_name": mname,
                "display_label": f"{mname} {yr}",
                "total_incidents": left_total,
                "total_rescues": left_total,
                "category_sum_total": right_total,
                "left_vs_category_discrepancy": discrepancy,
                "dominant_rescue_type": top_cat_key,
                "dominant_rescue_count": cat_values.get(top_cat_key, 0) if top_cat_key else 0,
                "rescue_categories": cat_values,
                "is_fire_incident": False,
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "verification_status": "unlocated",
                "geom": None,
                "source_name": "Satu Data Medan (Dinas Damkarmat Non-Kebakaran)",
                "source_url": f"https://medanterkini.medan.go.id/api/resources/download/{res_id}",
            })
        assert year_sum_reported == clean_int(rows[-1][2])
        assert year_sum_right == clean_int(rows[-1][-1])
        annual_totals.append({
            "year": yr,
            "total_rescues": year_sum_reported,
            "is_fire_incident": False,
            "source_url": f"https://medanterkini.medan.go.id/api/resources/download/{res_id}",
        })
    return {
        "is_fire_incident": False,
        "scope_note": "Operasi penyelamatan non-kebakaran Dinas Damkarmat (evakuasi ular, tawon, kucing, cincin, pohon, dll.). Disimpan terpisah dan tidak pernah digabung ke jumlah kejadian kebakaran.",
        "annual_totals": annual_totals,
        "combined_total": sum(a["total_rescues"] for a in annual_totals),
        "monthly_series": monthly_series,
        "row_discrepancies": anomalies_detected,
    }


def validate_and_emit_independent_candidates(district_features: list[dict]) -> tuple[dict, dict]:
    raw_input_path = PROCESSED / "independent_enrichment_input.json"
    raw_ind = json.loads(raw_input_path.read_text(encoding="utf-8"))
    poly_by_name = {f["properties"]["district_name"]: f["geometry"] for f in district_features}
    valid_districts = set(poly_by_name.keys())
    allowed_types = {"rumah", "ruko", "travo_kabel", "gudang_pabrik", "kendaraan", "lahan", "fasilitas_umum", "lain_lain"}

    incidents = raw_ind.get("incident_candidates") or []
    stations = raw_ind.get("station_candidates") or []
    assert len(incidents) == 27, f"Expected 27 independent incident candidates, got {len(incidents)}"
    assert len(stations) == 6, f"Expected 6 UPT station candidates, got {len(stations)}"

    seen_ids = set()
    seen_urls = set()
    approx_count = 0
    dist_only_count = 0

    for rec in incidents:
        rid = rec["source_record_id"]
        assert rid not in seen_ids, f"Duplicate candidate id {rid}"
        seen_ids.add(rid)
        url = rec["source_url"]
        assert url.startswith("https://"), f"Candidate URL must be https: {url}"
        assert url not in seen_urls, f"Duplicate candidate URL {url}"
        seen_urls.add(url)
        assert rec.get("source_name"), f"Missing source_name in {rid}"
        assert rec.get("published_at"), f"Missing published_at in {rid}"
        assert rec.get("occurred_on"), f"Missing occurred_on in {rid}"
        assert rec.get("verification_status") == "needs_review", f"Candidate {rid} cannot be verified"
        assert rec.get("kde_eligible") is False, f"Candidate {rid} cannot be kde_eligible"
        assert rec.get("object_type") in allowed_types, f"Unexpected object_type in {rid}"
        dname = rec.get("district_name")
        assert dname in valid_districts, f"Invalid district_name {dname!r} in {rid}"
        assert rec.get("privacy_generalized") is True, f"privacy_generalized must be True on {rid}"
        assert not re.search(r"\bNo\.?\s*\d+", rec.get("address_text") or "", flags=re.IGNORECASE), (
            f"Candidate {rid} address contains specific building number: {rec.get('address_text')}"
        )

        otime = rec.get("occurred_time_wib")
        oat = rec.get("occurred_at")
        assert otime != "00:00", f"Forbidden 00:00 placeholder time in {rid}"
        if otime is None:
            assert oat is None, f"occurred_at must remain null when occurred_time_wib is null ({rid})"
        else:
            assert isinstance(oat, str) and not oat.endswith("T00:00:00+07:00") and not oat.endswith("T00:00:00Z"), (
                f"Forbidden 00:00 timestamp in {rid}: {oat}"
            )

        acc = rec.get("location_accuracy")
        assert acc in ("approximate", "district_only"), f"Forbidden accuracy {acc!r} in {rid}"
        if acc == "approximate":
            approx_count += 1
            lat, lon, geom = rec.get("lat"), rec.get("lon"), rec.get("geom")
            assert isinstance(lat, (int, float)) and isinstance(lon, (int, float)), f"Missing coords in {rid}"
            assert isinstance(geom, dict) and geom.get("type") == "Point", f"Invalid geom in {rid}"
            assert geom.get("coordinates") == [lon, lat], f"Coord/geom mismatch in {rid}"
            assert MEDAN_BOUNDS["min_lat"] <= lat <= MEDAN_BOUNDS["max_lat"], f"lat out of bounds in {rid}"
            assert MEDAN_BOUNDS["min_lon"] <= lon <= MEDAN_BOUNDS["max_lon"], f"lon out of bounds in {rid}"
            assert point_in_geom(lon, lat, poly_by_name[dname]), (
                f"Candidate {rid} point ({lat}, {lon}) outside expected district polygon {dname}"
            )
        else:
            dist_only_count += 1
            assert rec.get("geom") is None and rec.get("lat") is None and rec.get("lon") is None, (
                f"district_only record {rid} must keep null geom/lat/lon"
            )

    seen_st = set()
    st_approx = 0
    st_dist_only = 0
    for st in stations:
        sc = st["station_code"]
        assert sc not in seen_st and sc != "MAKO-00"
        seen_st.add(sc)
        assert st.get("verification_status") == "needs_review"
        dname = st.get("district_name")
        assert dname in valid_districts
        acc = st.get("location_accuracy")
        if acc == "approximate":
            st_approx += 1
            lat, lon, geom = st.get("lat"), st.get("lon"), st.get("geom")
            assert isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            assert isinstance(geom, dict) and geom.get("coordinates") == [lon, lat]
            assert point_in_geom(lon, lat, poly_by_name[dname]), f"Station {sc} point outside {dname}"
        else:
            st_dist_only += 1
            assert acc == "district_only" and st.get("geom") is None

    inc_payload = {
        "isDemo": False,
        "dataLabel": "UNVERIFIED_CANDIDATES",
        "generated_from": "data/processed/independent_enrichment_input.json",
        "metadata": raw_ind["metadata"],
        "summary": {
            "total_candidates": len(incidents),
            "approximate_point_count": approx_count,
            "district_only_count": dist_only_count,
            "deduplicated_articles_count": sum(
                1 for e in raw_ind["excluded_or_deduplicated_articles"] if e["reason"] == "duplicate_incident"
            ),
            "excluded_non_medan_count": sum(
                1 for e in raw_ind["excluded_or_deduplicated_articles"] if e["reason"] == "outside_kota_medan"
            ),
            "by_year": {
                "2024": sum(1 for r in incidents if r["period_year"] == 2024),
                "2025": sum(1 for r in incidents if r["period_year"] == 2025),
                "2026": sum(1 for r in incidents if r["period_year"] == 2026),
            },
            "kde_eligible_count": 0,
            "verified_count": 0,
        },
        "excluded_or_deduplicated_articles": raw_ind["excluded_or_deduplicated_articles"],
        "records": incidents,
    }
    st_ref_articles = raw_ind.get("station_reference_articles", [])
    for ref in st_ref_articles:
        pub_ref = str(ref.get("published_at", ""))
        assert pub_ref and "T00:00:00" not in pub_ref, (
            f"Forbidden placeholder T00:00:00 in station_reference_articles: {ref.get('url')} -> {pub_ref}"
        )

    st_payload = {
        "isDemo": False,
        "dataLabel": "UNVERIFIED_CANDIDATES",
        "generated_from": "data/processed/independent_enrichment_input.json",
        "summary": {
            "total_candidates": len(stations),
            "approximate_point_count": st_approx,
            "district_only_count": st_dist_only,
            "verified_station_count": 0,
            "p2k_medan_blocked": raw_ind["metadata"]["p2k_medan_blocked"],
        },
        "reference_articles": st_ref_articles,
        "stations": stations,
    }
    return inc_payload, st_payload


def build_supabase_staging_bundle(
    *,
    summary_payload: dict,
    bpbd_comparison: dict,
    monthly_2016_2021: list[dict],
    inc_payload: dict,
    st_payload: dict,
    manifest: dict,
) -> dict:
    register_path = ROOT / "data" / "metadata" / "source-register.csv"
    data_sources_rows = []
    with register_path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            raw_gran = row["granularity"].strip()
            mapped_gran = "policy_table" if raw_gran == "annual_aggregate" else raw_gran
            notes_val = row["notes"].strip()
            if raw_gran == "annual_aggregate":
                notes_val = f"[original_granularity: annual_aggregate] {notes_val}".strip()
            data_sources_rows.append({
                "source_code": row["source_id"].strip(),
                "dataset_name": row["dataset_name"].strip(),
                "category": row["category"].strip(),
                "publisher": row["publisher"].strip(),
                "source_url": row["url"].strip(),
                "access_date": row["access_date"].strip(),
                "period_label": row["period"].strip(),
                "license_label": row["license"].strip() or "Portal Data Publik",
                "granularity": mapped_gran,
                "sha256_hash": row["sha256"].strip() or None,
                "notes": notes_val,
            })

    agg_rows = []
    for d in summary_payload["district_2023"]:
        agg_rows.append({
            "aggregate_key": f"DAMKAR-DIST-2023-{d['area_code']}",
            "aggregate_type": "district_aggregate",
            "period_year": 2023,
            "period_month": None,
            "area_code": d["area_code"],
            "district_name": d["district_name"],
            "total_incidents": d["total_incidents"],
            "categories": d["categories"],
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "source_name": d["source_name"],
            "source_url": d["source_url"],
            "notes": f"Damkarmat 2023 skala besar={d['scale_besar']}, kecil={d['scale_kecil']}, selisih_skala={d['scale_discrepancy']}",
        })
    for m in summary_payload["monthly_2024"]:
        agg_rows.append({
            "aggregate_key": f"DAMKAR-MONTHLY-2024-{m['month_number']:02d}",
            "aggregate_type": "monthly_aggregate",
            "period_year": 2024,
            "period_month": m["month_number"],
            "area_code": None,
            "district_name": None,
            "total_incidents": m["total_incidents"],
            "categories": m["categories"],
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "source_name": m["source_name"],
            "source_url": m["source_url"],
            "notes": f"Damkarmat {m['month_name']} 2024",
        })
    for m in summary_payload["monthly_2025"]:
        agg_rows.append({
            "aggregate_key": f"DAMKAR-MONTHLY-2025-{m['month_number']:02d}",
            "aggregate_type": "monthly_aggregate",
            "period_year": 2025,
            "period_month": m["month_number"],
            "area_code": None,
            "district_name": None,
            "total_incidents": m["total_incidents"],
            "categories": m["categories"],
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "source_name": m["source_name"],
            "source_url": m["source_url"],
            "notes": f"Damkarmat {m['month_name']} 2025",
        })
    for a in summary_payload["annual_series"]:
        agg_rows.append({
            "aggregate_key": f"DAMKAR-ANNUAL-{a['year']}",
            "aggregate_type": "annual_aggregate",
            "period_year": a["year"],
            "period_month": None,
            "area_code": None,
            "district_name": None,
            "total_incidents": a["total_incidents"],
            "categories": {
                "comparison_outside_medan": a["comparison_total_with_outside_medan"],
                "comparison_rekap_total": a["comparison_rekap_total"],
            },
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "source_name": "Satu Data Medan (Dinas Damkarmat)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01k3mt7nj297gv1qqrc9h0qmj5",
            "notes": a["consistency_note"] or f"Rekap tahunan resmi Damkarmat {a['year']}",
        })
    for m in monthly_2016_2021:
        agg_rows.append({
            "aggregate_key": f"DAMKAR-MONTHLY-{m['period_year']}-{m['month_number']:02d}",
            "aggregate_type": "monthly_aggregate",
            "period_year": m["period_year"],
            "period_month": m["month_number"],
            "area_code": None,
            "district_name": None,
            "total_incidents": m["total_incidents"],
            "categories": {},
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "source_name": m["source_name"],
            "source_url": m["source_url"],
            "notes": f"Damkarmat bulanan historis {m['display_label']}",
        })
    for d in bpbd_comparison["district_2021"]:
        agg_rows.append({
            "aggregate_key": f"BPBD-DIST-2021-{d['area_code']}",
            "aggregate_type": "district_aggregate",
            "period_year": 2021,
            "period_month": None,
            "area_code": d["area_code"],
            "district_name": d["district_name"],
            "total_incidents": d["fire_incidents"],
            "categories": {
                "kebakaran": d["fire_incidents"],
                "banjir": d["flood_events"],
                "angin_puting_beliung": d["wind_events"],
                "tanah_longsor": d["landslide_events"],
                "lain_lain": d["other_events"],
            },
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "source_name": d["source_name"],
            "source_url": d["source_url"],
            "notes": "BPBD pembanding 2021 (hanya total kebakaran pada kolom utama; total bencana=" + str(d["total_disasters"]) + ")",
        })
    for d in bpbd_comparison["district_2022"]:
        agg_rows.append({
            "aggregate_key": f"BPBD-DIST-2022-{d['area_code']}",
            "aggregate_type": "district_aggregate",
            "period_year": 2022,
            "period_month": None,
            "area_code": d["area_code"],
            "district_name": d["district_name"],
            "total_incidents": d["fire_incidents"],
            "categories": {
                "kebakaran": d["fire_incidents"],
                "banjir": d["flood_events"],
                "angin_puting_beliung": d["wind_events"],
                "tanah_longsor": d["landslide_events"],
            },
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "source_name": d["source_name"],
            "source_url": d["source_url"],
            "notes": "BPBD pembanding 2022 (total bencana=" + str(d["total_disasters"]) + ")",
        })
    for m in bpbd_comparison["monthly_2022"]:
        agg_rows.append({
            "aggregate_key": f"BPBD-MONTHLY-2022-{m['month_number']:02d}",
            "aggregate_type": "monthly_aggregate",
            "period_year": 2022,
            "period_month": m["month_number"],
            "area_code": None,
            "district_name": None,
            "total_incidents": m["fire_incidents"],
            "categories": {
                "kebakaran": m["fire_incidents"],
                "banjir": m["flood_events"],
                "angin_puting_beliung": m["wind_events"],
                "tanah_longsor": m["landslide_events"],
            },
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "source_name": m["source_name"],
            "source_url": m["source_url"],
            "notes": f"BPBD pembanding bulanan {m['display_label']} (total bencana={m['total_disasters']})",
        })
    for m in bpbd_comparison["monthly_2023"]:
        agg_rows.append({
            "aggregate_key": f"BPBD-MONTHLY-2023-{m['month_number']:02d}",
            "aggregate_type": "monthly_aggregate",
            "period_year": 2023,
            "period_month": m["month_number"],
            "area_code": None,
            "district_name": None,
            "total_incidents": m["fire_incidents"],
            "categories": {
                "kebakaran": m["fire_incidents"],
                "banjir": m["flood_events"],
                "angin_puting_beliung": m["wind_events"],
                "tanah_longsor": m["landslide_events"],
            },
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "source_name": m["source_name"],
            "source_url": m["source_url"],
            "notes": f"BPBD pembanding bulanan {m['display_label']} (total bencana={m['total_disasters']})",
        })

    fire_stations_rows = []
    for st in summary_payload["verified_stations"]:
        fire_stations_rows.append({
            "station_code": st["station_code"],
            "name": st["name"],
            "station_type": st["station_type"],
            "address": st["address"],
            "district_name": "Medan Petisah",
            "geom": {"type": "Point", "coordinates": [st["lon"], st["lat"]]},
            "source_name": st["source_name"],
            "source_url": st["source_url"],
            "verification_status": "verified",
            "verified_at": "2026-11-19T12:00:00+07:00",
        })
    for st in st_payload["stations"]:
        fire_stations_rows.append({
            "station_code": st["station_code"],
            "name": st["name"],
            "station_type": st["station_type"],
            "address": st["address"],
            "district_name": st["district_name"],
            "geom": st["geom"],
            "source_name": st["source_name"],
            "source_url": st["source_url"],
            "verification_status": st["verification_status"],
            "verified_at": None,
        })

    fire_incidents_rows = []
    for rec in inc_payload["records"]:
        fire_incidents_rows.append({
            "source_record_id": rec["source_record_id"],
            "occurred_at": rec["occurred_at"],
            "period_year": rec["period_year"],
            "period_month": rec["period_month"],
            "address_text": rec["address_text"],
            "district_name": rec["district_name"],
            "subdistrict_name": rec["subdistrict_name"],
            "object_type": rec["object_type"],
            "cause_category": rec["cause_category"],
            "location_accuracy": rec["location_accuracy"],
            "verification_status": rec["verification_status"],
            "source_name": rec["source_name"],
            "source_url": rec["source_url"],
            "geom": rec["geom"],
        })

    geo_json_rel = "public/data/" + "medan_districts_osm.geojson"
    snapshot_files = [
        ("manifest", "verified", "public/data/manifest.json"),
        ("fire_incidents_summary", "verified", "public/data/fire_incidents_summary.json"),
        ("medan_districts_osm", "fallback_osm", geo_json_rel),
        ("station_coverage_provisional", "provisional", "public/data/station-coverage.provisional.json"),
        ("priority_planner_provisional", "provisional", "public/data/priority-planner.provisional.json"),
    ]
    app_data_snapshots = []
    for skey, dstatus, rel_path in snapshot_files:
        fpath = ROOT / rel_path
        if fpath.exists():
            content_sha256, byte_size = sha256_text_asset(fpath)
            app_data_snapshots.append({
                "snapshot_key": skey,
                "dataset_status": dstatus,
                "public_file_path": rel_path,
                "content_sha256": content_sha256,
                "byte_size": byte_size,
            })

    return {
        "generated_at": "2026-11-23T07:00:00+07:00",
        "staging_only": True,
        "remote_db_modified": False,
        "summary_counts": {
            "data_sources": len(data_sources_rows),
            "fire_incident_aggregates": len(agg_rows),
            "fire_stations": len(fire_stations_rows),
            "fire_incidents": len(fire_incidents_rows),
            "app_data_snapshots": len(app_data_snapshots),
            "non_fire_rescues_separate": len(summary_payload["non_fire_rescues"]["monthly_series"]),
            "damkarmat_spm_separate": len(summary_payload["damkarmat_spm"]),
        },
        "tables": {
            "data_sources": data_sources_rows,
            "fire_incident_aggregates": agg_rows,
            "fire_stations": fire_stations_rows,
            "fire_incidents": fire_incidents_rows,
            "app_data_snapshots": app_data_snapshots,
        },
        "separated_non_fire_and_spm": {
            "non_fire_rescues": summary_payload["non_fire_rescues"],
            "damkarmat_spm": summary_payload["damkarmat_spm"],
        },
        "schema_recommendations": [
            {
                "table": "public.fire_incidents",
                "reason": "Artikel berita sering hanya mencantumkan tanggal kejadian (tanpa jam kejadian yang terpisah dari jam laporan/publikasi), jendela pemadaman, koordinat perkiraan OSM, dan URL duplikat.",
                "proposed_columns": [
                    "occurred_on date",
                    "occurred_time_precision text check (occurred_time_precision in ('exact_minute','date_only_unknown_time','approximate_window'))",
                    "reported_at timestamptz",
                    "published_at timestamptz",
                    "geocoding_method text",
                    "geocoding_source text",
                    "osm_ref text",
                    "additional_source_urls jsonb default '[]'::jsonb",
                ],
                "migration_applied": False,
            },
            {
                "table": "public.fire_stations",
                "reason": "Skema saat ini belum membedakan akurasi titik pos kandidat (approximate ruas jalan vs district_only geom=null) maupun status operasional hasil peresmian.",
                "proposed_columns": [
                    "location_accuracy text check (location_accuracy in ('exact_verified','address_geocoded_verified','approximate','district_only','unknown'))",
                    "operational_status text",
                    "conflict_notes text",
                    "osm_ref text",
                ],
                "migration_applied": False,
            },
            {
                "table": "public.data_sources",
                "reason": "Constraint check (granularity in (...)) saat ini belum mengizinkan nilai 'annual_aggregate' yang ada pada source-register.csv.",
                "proposed_change": "Perluas check constraint granularity agar menerima 'annual_aggregate'.",
                "migration_applied": False,
            },
            {
                "table": "public.non_fire_rescues & public.damkarmat_spm_metrics (tabel baru opsional)",
                "reason": "Data penyelamatan non-kebakaran (2023-2025, 2.218 kasus) dan indikator SPM (13,10 menit vs target 15 menit) tidak boleh dicampur ke public.fire_incident_aggregates.",
                "proposed_change": "Tambah tabel relasional terpisah untuk layanan non-kebakaran dan SPM apabila diperlukan query SQL langsung.",
                "migration_applied": False,
            },
        ],
    }


def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    PUBLIC_DEMO.mkdir(parents=True, exist_ok=True)

    # 1. Parse population 2022-2024 (has BPS area codes 12.71.01..12.71.21) & population 2025
    pop24_rows = read_xlsx_rows(RAW_SATU / "JUMLAH_PENDUDUK_KOTA_MEDAN_BERDASARKAN_KECAMATAN_2022-2024.xlsx")
    pop_by_name = {}
    for row in pop24_rows[1:]:
        code, wil, p22, p23, p24 = row[0], norm_district(row[1]), int(row[2]), int(row[3]), int(row[4])
        pop_by_name[wil] = {
            "area_code": code,
            "district_name": wil,
            "population_2022": p22,
            "population_2023_capil": p23,
            "population_2024": p24,
        }

    pop25_rows = read_xlsx_rows(
        RAW_SATU / "Jumlah_Penduduk_Kepadatan_Penduduk_dan_Distribusi_Penduduk_Kota_Medan_Menurut_Kecamatan_Tahun_2025.xlsx"
    )
    for row in pop25_rows[1:]:
        name = norm_district(row[1])
        if name == "Kota Medan":
            continue
        pop_by_name[name]["population_2025"] = int(float(row[2]))
        pop_by_name[name]["density_km2_2025"] = int(float(row[3]))
        pop_by_name[name]["distribution_pct_2025"] = round(float(row[4]), 2)

    assert len(pop_by_name) == 21, f"Expected 21 districts in pop_by_name, got {len(pop_by_name)}"

    # Write clean population CSV
    pop_csv = PROCESSED / "medan_population_2022_2025.csv"
    with pop_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "area_code",
            "district_name",
            "population_2022",
            "population_2023_disdukcapil",
            "population_2024_disdukcapil",
            "population_2025_bps",
            "density_km2_2025_bps",
            "distribution_pct_2025_bps",
        ])
        for d in sorted(pop_by_name.values(), key=lambda x: x["area_code"]):
            writer.writerow([
                d["area_code"],
                d["district_name"],
                d["population_2022"],
                d["population_2023_capil"],
                d["population_2024"],
                d["population_2025"],
                d["density_km2_2025"],
                d["distribution_pct_2025"],
            ])

    # 2. Parse 2023 district-level fires (categories + scale)
    f23_cat_rows = read_xlsx_rows(RAW_SATU / "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx")
    f23_scale_rows = read_xlsx_rows(RAW_SATU / "Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Kecamatan_Tahun_2023.xlsx")

    scale_map = {}
    for row in f23_scale_rows[1:]:
        dname = norm_district(row[0])
        if dname == "Jumlah":
            continue
        scale_map[dname] = {
            "besar": clean_int(row[1]),
            "kecil": clean_int(row[2]),
            "raw_area_value": row[3],
        }

    district_2023 = []
    for row in f23_cat_rows[1:]:
        dname = norm_district(row[1])
        if dname == "Jumlah":
            continue
        cats = {
            "rumah": clean_int(row[3]),
            "ruko": clean_int(row[4]),
            "travo_kabel": clean_int(row[5]),
            "gudang_pabrik": clean_int(row[6]),
            "kendaraan": clean_int(row[7]),
            "lahan": clean_int(row[8]),
            "fasilitas_umum": clean_int(row[9]),
            "lain_lain": clean_int(row[10]),
        }
        total = clean_int(row[2])
        assert sum(cats.values()) == total, f"2023 category sum mismatch in {dname}: {cats} vs {total}"
        sc = scale_map[dname]
        scale_sum = sc["besar"] + sc["kecil"]
        meta = pop_by_name[dname]
        district_2023.append({
            "area_code": meta["area_code"],
            "district_name": dname,
            "period_year": 2023,
            "total_incidents": total,
            "scale_besar": sc["besar"],
            "scale_kecil": sc["kecil"],
            "scale_total": scale_sum,
            "scale_discrepancy": total - scale_sum,
            "raw_area_reported": sc["raw_area_value"],
            "area_anomaly_flag": "." in str(sc["raw_area_value"]),
            "area_anomaly_note": (
                f"Nilai mentah '{sc['raw_area_value']}' menggunakan pemisah titik terpotong pada Excel sumber; dipertahankan tanpa fabrikasi angka."
                if "." in str(sc["raw_area_value"])
                else None
            ),
            "categories": cats,
            "population_2025": meta["population_2025"],
            "density_km2_2025": meta["density_km2_2025"],
            "granularity": "district_aggregate",
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "geom": None,
            "source_name": "Satu Data Medan (Dinas Damkarmat)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01m36hqs3de8k1qab30hf8qthr",
        })

    assert len({d["district_name"] for d in district_2023}) == 21, "Duplicate or missing 2023 districts"
    assert sum(d["total_incidents"] for d in district_2023) == 219

    # 3. Parse 2024 & 2025 monthly fire aggregates
    def parse_monthly_object_table(fp: Path, year: int, start_idx: int, resource_id: str) -> list[dict]:
        rows = read_xlsx_rows(fp)
        out = []
        seen_months = set()
        for r in rows[start_idx:]:
            if r[0].upper().startswith("JUMLAH") or r[1].upper().startswith("JUMLAH"):
                continue
            month_num = int(float(r[0]))
            month_name = norm_label(r[1])
            assert month_num not in seen_months, f"Duplicate month {month_num} in {year}"
            seen_months.add(month_num)
            total = clean_int(r[2])
            cats = {
                "rumah": clean_int(r[3]),
                "ruko": clean_int(r[4]),
                "travo_kabel": clean_int(r[5]),
                "gudang_pabrik": clean_int(r[6]),
                "kendaraan": clean_int(r[7]),
                "lahan": clean_int(r[8]),
                "fasilitas_umum": clean_int(r[9]),
                "lain_lain": clean_int(r[10]),
            }
            assert sum(cats.values()) == total, f"{year} {month_name} sum mismatch: {cats} vs {total}"
            out.append({
                "period_year": year,
                "month_number": month_num,
                "month_name": month_name,
                "total_incidents": total,
                "categories": cats,
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "verification_status": "unlocated",
                "geom": None,
                "source_name": "Satu Data Medan (Dinas Damkarmat)",
                "source_url": f"https://medanterkini.medan.go.id/api/resources/download/{resource_id}",
            })
        assert len(out) == 12, f"Expected 12 monthly rows in {year}, got {len(out)}"
        return out

    monthly_2024 = parse_monthly_object_table(
        RAW_SATU / "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2024.xlsx",
        2024,
        3,
        "01m36j14dc1thkhnag7p7sdm5w",
    )
    monthly_2025 = parse_monthly_object_table(
        RAW_SATU / "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2025.xlsx",
        2025,
        1,
        "01m36kqphpwh98z8q5q7y3bfaa",
    )
    assert sum(m["total_incidents"] for m in monthly_2024) == 269
    assert sum(m["total_incidents"] for m in monthly_2025) == 251

    # 4. Parse 2023 monthly impact (casualties & loss) and 2023 monthly scale/area
    imp_rows = read_xlsx_rows(RAW_SATU / "Jumlah_Kebakaran_Dirinci_Menurut_Korban_Jiwa_Dan_Material_Tahun_2023.xlsx")
    monthly_scale_rows = read_xlsx_rows(
        RAW_SATU / "Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Luas_Lokasi_Tahun_2023.xlsx"
    )
    monthly_scale_map = {}
    for r in monthly_scale_rows[1:-1]:
        mname = norm_label(r[0])
        monthly_scale_map[mname] = {
            "besar": clean_int(r[1]),
            "kecil": clean_int(r[2]),
            "raw_area_reported": r[3],
        }

    reported_loss_total = parse_dotted_int(imp_rows[-1][4])
    other_11_months_sum = sum(
        parse_dotted_int(r[4]) or 0 for r in imp_rows[1:-1] if norm_label(r[0]) != "Maret"
    )
    monthly_2023_impact = []
    for idx, r in enumerate(imp_rows[1:-1], start=1):
        mname = norm_label(r[0])
        sc_m = monthly_scale_map[mname]
        raw_loss = r[4].strip()
        is_maret_outlier = mname == "Maret" and raw_loss == "776"
        loss_note = (
            f"Nilai mentah '776' tercatat tanpa akhiran ribuan; selisih total tahunan ({reported_loss_total:,}) terhadap 11 bulan lain ({other_11_months_sum:,}) bernilai 776.000, namun nilai asli dipertahankan tanpa tebakan satuan.".replace(",", ".")
            if is_maret_outlier
            else "Header asli tidak mencantumkan satuan mata uang eksplisit; angka dipertahankan mentah."
        )
        monthly_2023_impact.append({
            "period_year": 2023,
            "month_number": idx,
            "month_name": mname,
            "total_incidents": clean_int(r[1]),
            "injured": clean_int(r[2]),
            "fatalities": clean_int(r[3]),
            "raw_material_loss": raw_loss,
            "loss_anomaly_flag": is_maret_outlier,
            "loss_anomaly_note": loss_note,
            "scale_besar_monthly": sc_m["besar"],
            "scale_kecil_monthly": sc_m["kecil"],
            "raw_area_reported_monthly": sc_m["raw_area_reported"],
            "granularity": "monthly_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "source_name": "Satu Data Medan (Dinas Damkarmat)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01k4rt314v47hhc1pta428scq0",
        })
    assert len(monthly_2023_impact) == 12
    assert sum(m["total_incidents"] for m in monthly_2023_impact) == 219

    # 5. Historical annual series 2016-2025 with 2016-2022 cross-file scope audit
    hist_rows = read_xlsx_rows(RAW_SATU / "Jumlah_Kebakaran_Di_Kota_Medan_Tahun_2016_-_2022.xlsx")
    outside_scope_files = {
        2016: "Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi_Bulan_Januari_-_Desember_Tahun_2016.xlsx",
        2017: "Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi_Bulan_Januari_-_Desember_Tahun_2017.xlsx",
        2018: "Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi_Bulan_Januari_-_Desember_Tahun_2018.xlsx",
        2019: "Data_Kebakaran_Kota_Medan_dan_Diluar_Kota_Medan_yang_Ditanggulangi_Bulan_Januari_Desember_Tahun_2019.xlsx",
        2020: "Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi_Bulan_Januari_-_Desember_Tahun_2020.xlsx",
        2021: "Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi_Bulan_Januari_-_Desember_Tahun_2021.xlsx",
        2022: "Data_Kebakaran_Kota_Medan_Dan_Diluar_Kota_Medan_Yang_Ditanggulangi_Bulan_Januari_-_Desember_Tahun_2022.xlsx",
    }
    rekap_scope_files = {
        2020: "Rekapitulasi_Kejadian_Kebakaran_Tahun_2020.xlsx",
        2022: "Rekapitulasi_Kejadian_Kebakaran_Tahun_2022.xlsx",
    }

    annual_series = []
    for r in hist_rows[1:]:
        yr = int(r[0])
        base_total = int(r[1])
        ext_rows = read_xlsx_rows(RAW_SATU / outside_scope_files[yr])
        ext_total = sum(clean_int(er[1]) for er in ext_rows[1:])
        rekap_total = None
        if yr in rekap_scope_files:
            rek_rows = read_xlsx_rows(RAW_SATU / rekap_scope_files[yr])
            rekap_total = sum(clean_int(rr[2]) for rr in rek_rows[1:])

        differs = ext_total != base_total or (rekap_total is not None and rekap_total != base_total)
        note = None
        if differs:
            parts = [f"rekap Kota Medan = {base_total}", f"penanggulangan Medan+luar kota = {ext_total}"]
            if rekap_total is not None:
                parts.append(f"rekap bulanan {yr} = {rekap_total}")
            note = "Perbedaan cakupan wilayah penanggulangan: " + "; ".join(parts) + "."

        annual_series.append({
            "year": yr,
            "total_incidents": base_total,
            "granularity": "annual_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "comparison_total_with_outside_medan": ext_total,
            "comparison_rekap_total": rekap_total,
            "consistency_flag": differs,
            "consistency_note": note,
            "source_file": "Jumlah_Kebakaran_Di_Kota_Medan_Tahun_2016_-_2022.xlsx",
        })

    annual_series.extend([
        {
            "year": 2023,
            "total_incidents": 219,
            "granularity": "district_aggregate",
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "geom": None,
            "comparison_total_with_outside_medan": None,
            "comparison_rekap_total": None,
            "consistency_flag": True,
            "consistency_note": "Total 219 sama di ketiga tabel 2023, tetapi 8 kecamatan selisih +/-1 dan rincian skala berbeda (30/189 vs 25/194).",
            "source_file": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx",
        },
        {
            "year": 2024,
            "total_incidents": 269,
            "granularity": "monthly_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "comparison_total_with_outside_medan": None,
            "comparison_rekap_total": None,
            "consistency_flag": False,
            "consistency_note": None,
            "source_file": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2024.xlsx",
        },
        {
            "year": 2025,
            "total_incidents": 251,
            "granularity": "monthly_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "comparison_total_with_outside_medan": None,
            "comparison_rekap_total": None,
            "consistency_flag": False,
            "consistency_note": None,
            "source_file": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2025.xlsx",
        },
    ])
    annual_series.sort(key=lambda x: x["year"])
    assert len({a["year"] for a in annual_series}) == 10

    # 5b. Parse newly integrated official workbooks (2016-2021 monthly, BPBD comparison, SPM, Non-fire rescues)
    annual_lookup = {a["year"]: a["total_incidents"] for a in annual_series}
    monthly_2016_2021 = parse_monthly_2016_2021(annual_lookup)
    bpbd_comparison = parse_bpbd_comparison(pop_by_name, annual_lookup)
    damkarmat_spm = parse_damkarmat_spm()
    non_fire_rescues = parse_non_fire_rescues()

    # 6. Verified Mako 0.0 HQ coordinates from official Damkarmat knowledge spreadsheet
    know_rows = read_xlsx_rows(
        RAW_SATU / "Data_Informasi_Knowledge_Whatsapp_AI_Dinas_Pemadam_Kebakaran_dan_Penyelamatan_Kota_Medan.xlsx"
    )
    coord_text = know_rows[1][5]
    lat_str, lon_str = [s.strip() for s in coord_text.split(",")]
    lat, lon = float(lat_str), float(lon_str)
    assert MEDAN_BOUNDS["min_lat"] <= lat <= MEDAN_BOUNDS["max_lat"]
    assert MEDAN_BOUNDS["min_lon"] <= lon <= MEDAN_BOUNDS["max_lon"]

    verified_stations = [
        {
            "station_code": "MAKO-00",
            "name": "Mako 0.0 Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan",
            "station_type": "mako",
            "address": "Jl. Candi Borobudur No. 2, Kota Medan",
            "lat": lat,
            "lon": lon,
            "verification_status": "verified",
            "source_name": "Satu Data Medan (Knowledge Informasi Damkarmat)",
            "source_url": "https://medanterkini.medan.go.id/api/resources/download/01m36k3bxe062dr4dw7raan3qe",
        }
    ]

    # 7. Unlocated / Needs-review register (never silently discard)
    hist_total_16_22 = sum(a["total_incidents"] for a in annual_series if a["year"] <= 2022)
    unlocated_register = [
        {
            "batch_id": "UNLOC-2025-MONTHLY",
            "period_label": "Januari - Desember 2025",
            "record_count": 251,
            "granularity": "monthly_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "reason": "File resmi Tahun 2025 hanya menyediakan rekapitulasi bulanan menurut 8 kategori objek tanpa kolom kecamatan, alamat jalan, atau koordinat individual.",
            "source_file": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2025.xlsx",
        },
        {
            "batch_id": "UNLOC-2024-MONTHLY",
            "period_label": "Januari - Desember 2024",
            "record_count": 269,
            "granularity": "monthly_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "reason": "File resmi Tahun 2024 hanya menyediakan rekapitulasi bulanan menurut 8 kategori objek tanpa kolom kecamatan, alamat jalan, atau koordinat individual.",
            "source_file": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2024.xlsx",
        },
        {
            "batch_id": "DIST-2023-KECAMATAN",
            "period_label": "Tahun 2023 (21 Kecamatan)",
            "record_count": 219,
            "granularity": "district_aggregate",
            "location_accuracy": "district_only",
            "verification_status": "needs_review",
            "geom": None,
            "reason": "Agregasi tingkat kecamatan tersedia untuk 21 wilayah, namun belum memiliki alamat kejadian individual maupun koordinat titik untuk KDE.",
            "source_file": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx",
        },
        {
            "batch_id": "UNLOC-2016-2022-ANNUAL",
            "period_label": "Tahun 2016 - 2022",
            "record_count": hist_total_16_22,
            "granularity": "annual_aggregate",
            "location_accuracy": "unknown",
            "verification_status": "unlocated",
            "geom": None,
            "reason": "Arsip historis 2016-2022 hanya memuat jumlah kejadian tahunan/bulanan level kota tanpa atribut kecamatan maupun koordinat individual.",
            "source_file": "Jumlah_Kebakaran_Di_Kota_Medan_Tahun_2016_-_2022.xlsx",
        },
    ]

    data_quality_anomalies = [
        {
            "anomaly_id": "QA-2023-WHITESPACE",
            "period": "2023 - 2025",
            "severity": "normalisasi",
            "summary": "Spasi ganda 'Medan  Kota', spasi di ujung nama kecamatan/bulan ('Medan Denai ', 'Maret ', 'MEI ', 'November '), dan nilai kosong '\\xa0-'.",
            "resolution": "Dinormalisasi otomatis di build_processed_data.py dan helper runtime tanpa mengubah angka kejadian.",
            "source_files": "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx",
        },
        {
            "anomaly_id": "QA-2023-DIST-SCALE-DIFF",
            "period": "2023",
            "severity": "perlu_review",
            "summary": "Selisih +/-1 kejadian di 8 kecamatan (Medan Kota, Tembung, Baru, Petisah, Timur, Sunggal, Helvetia, Labuhan) antara rekap objek vs skala kecamatan; empat +1 dan empat -1 sehingga total kota tetap 219.",
            "resolution": "Selisih dicatat eksplisit pada atribut scale_discrepancy tiap kecamatan dan ditampilkan di tab QA.",
            "source_files": "Rekapitulasi_2023 vs Skala_dan_Kecamatan_2023",
        },
        {
            "anomaly_id": "QA-2023-SCALE-SPLIT-DIFF",
            "period": "2023",
            "severity": "perlu_review",
            "summary": "Rincian skala kebakaran 2023 berbeda antara file kecamatan (30 Besar / 189 Kecil) dan file bulanan (25 Besar / 194 Kecil), keduanya berjumlah 219.",
            "resolution": "Kedua rincian disimpan terpisah (scale_besar/kecil vs scale_besar_monthly/kecil_monthly) tanpa memilih satu pihak secara diam-diam.",
            "source_files": "Skala_dan_Kecamatan_2023 vs Skala_dan_Luas_Lokasi_2023",
        },
        {
            "anomaly_id": "QA-2023-AREA-FORMAT",
            "period": "2023",
            "severity": "anomali_satuan",
            "summary": "Kolom luas lokasi kecamatan mencampur bilangan meter (968, 3963) dan desimal terpotong (1.84, 5.53, 4.33, 5.46, baris total 77.03 vs jumlah bulanan 77.030).",
            "resolution": "Nilai asli dipertahankan apa adanya pada raw_area_reported dengan flag area_anomaly_flag.",
            "source_files": "Jumlah_Kebakaran_Dirinci_Menurut_Skala_dan_Kecamatan_Tahun_2023.xlsx",
        },
        {
            "anomaly_id": "QA-2023-LOSS-OUTLIER",
            "period": "2023 (Maret)",
            "severity": "anomali_satuan",
            "summary": "Kerugian bulan Maret tercatat '776' (sementara total tahunan 58.365.000 dikurangi 11 bulan lain 57.589.000 berselisih 776.000) dan header tidak menyebut satuan rupiah.",
            "resolution": "Nilai '776' dipertahankan mentah pada raw_material_loss bersama loss_anomaly_flag dan catatan verifikasi.",
            "source_files": "Jumlah_Kebakaran_Dirinci_Menurut_Korban_Jiwa_Dan_Material_Tahun_2023.xlsx",
        },
        {
            "anomaly_id": "QA-2016-2022-SCOPE",
            "period": "2019, 2020, 2021",
            "severity": "perbedaan_cakupan",
            "summary": "Arsip 'Kota Medan' berbeda dengan arsip '+Di Luar Kota Medan': 2019 (275 vs 341), 2020 (227 vs 228 vs 264 pada rekap bulanan), dan 2021 (207 vs 208).",
            "resolution": "Total pembanding dan consistency_flag disimpan pada annual_series agar pengguna mengetahui perbedaan cakupan wilayah.",
            "source_files": "Jumlah_Kebakaran_2016-2022 vs arsip penanggulangan bulanan",
        },
        {
            "anomaly_id": "QA-BPBD-VS-DAMKAR-SCOPE",
            "period": "2021 - 2023",
            "severity": "perbedaan_cakupan",
            "summary": "Rekapitulasi BPBD Medan mencatat 108 kebakaran (2021), 138 (2022), dan 87 (2023 bulanan), lebih rendah daripada Damkarmat (207, 216, 219) karena perbedaan kriteria insiden bencana vs seluruh operasi pemadaman.",
            "resolution": "Dataset BPBD disimpan terpisah di bawah blok bpbd_comparison dan tidak digabung ke statistik resmi Damkarmat.",
            "source_files": "BPBD_Rekapitulasi_Bencana_Tahun_2021.xlsx; BPBD_Jumlah_Kejadian_Kebencanaan_Jenis_Bulanan_2023.xlsx",
        },
        {
            "anomaly_id": "QA-BPBD-2022-TOTAL-ROW",
            "period": "2022 (BPBD)",
            "severity": "perlu_review",
            "summary": "Pada BPBD_Rekapitulasi_Kebencanaan_Perkecamatan_Tahun_2022.xlsx, Kecamatan Medan Tuntungan mencatat 1 kejadian tanah longsor (total bencana = 187), namun baris JUMLAH di dasar tabel mencetak 0 pada kolom tanah longsor.",
            "resolution": "Baris 21 kecamatan dipertahankan apa adanya (tanah longsor = 1 di Medan Tuntungan) dan anomali baris jumlah didokumentasikan tanpa mengubah file mentah.",
            "source_files": "BPBD_Rekapitulasi_Kebencanaan_Perkecamatan_Tahun_2022.xlsx",
        },
        {
            "anomaly_id": "QA-NONFIRE-2024-OCT-NOV",
            "period": "2024 (Non-Kebakaran)",
            "severity": "perlu_review",
            "summary": "Pada rekap penyelamatan non-kebakaran 2024, Oktober mencatat 62 di kolom total kiri vs 61 di jumlah kategori kanan (+1), sedangkan November mencatat 73 vs 74 (-1); keduanya tetap berjumlah 691 untuk setahun.",
            "resolution": "Kedua kolom disimpan terpisah (total_rescues dan category_sum_total) serta dipisahkan sepenuhnya dari kejadian kebakaran.",
            "source_files": "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2024.xlsx",
        },
    ]

    # 8. Build clean GeoJSON of 21 Medan Kecamatan joined with verified attributes
    raw_geo = json.loads((RAW_OSM / "medan_boundaries_osm_raw.geojson").read_text(encoding="utf-8"))
    d23_lookup = {d["district_name"]: d for d in district_2023}
    district_features = []
    for feat in raw_geo["features"]:
        props = feat["properties"]
        if props.get("target_admin_level") != 7:
            continue
        dname = norm_district(props["district_name"])
        geom = feat["geometry"]
        if geom["type"] == "Polygon":
            new_coords = []
            for ring in geom["coordinates"]:
                sr = simplify_ring(ring)
                validate_ring_extent(sr, dname)
                new_coords.append(sr)
            clean_geom = {"type": "Polygon", "coordinates": new_coords}
        elif geom["type"] == "MultiPolygon":
            new_polys = []
            for poly in geom["coordinates"]:
                new_rings = []
                for ring in poly:
                    sr = simplify_ring(ring)
                    validate_ring_extent(sr, dname)
                    new_rings.append(sr)
                new_polys.append(new_rings)
            clean_geom = {"type": "MultiPolygon", "coordinates": new_polys}
        else:
            raise ValueError(f"Unsupported geometry type for {dname}: {geom['type']}")

        d23 = d23_lookup[dname]
        pop = pop_by_name[dname]
        district_features.append({
            "type": "Feature",
            "properties": {
                "area_code": pop["area_code"],
                "district_name": dname,
                "osm_id": props.get("osm_id"),
                "incidents_2023": d23["total_incidents"],
                "incidents_2023_besar": d23["scale_besar"],
                "incidents_2023_kecil": d23["scale_kecil"],
                "categories_2023": d23["categories"],
                "population_2024": pop["population_2024"],
                "population_2025": pop["population_2025"],
                "density_km2_2025": pop["density_km2_2025"],
                "distribution_pct_2025": pop["distribution_pct_2025"],
                "granularity": "district_aggregate",
                "boundary_source": "OpenStreetMap Nominatim (Fallback Geoportal Medan)",
                "attribution": "© OpenStreetMap contributors",
            },
            "geometry": clean_geom,
        })

    assert len(district_features) == 21, f"Expected 21 district features, got {len(district_features)}"
    district_features.sort(key=lambda x: x["properties"]["area_code"])

    districts_geojson = {
        "type": "FeatureCollection",
        "name": "medan_districts_osm",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "metadata": {
            "source": "OpenStreetMap Nominatim (Fallback Geoportal Kota Medan)",
            "attribution": "© OpenStreetMap contributors",
            "license": "ODbL 1.0",
            "attribute_sources": [
                "Rekapitulasi Data Kejadian Kebakaran di Kota Medan Tahun 2023.xlsx",
                "Jumlah Kebakaran Dirinci Menurut Skala dan Kecamatan Tahun 2023.xlsx",
                "Jumlah Penduduk Kepadatan Penduduk dan Distribusi Penduduk Kota Medan Menurut Kecamatan Tahun 2025.xlsx",
            ],
        },
        "features": district_features,
    }

    geo_out = PROCESSED / "medan_districts_osm.geojson"
    geo_out.write_text(json.dumps(districts_geojson, ensure_ascii=False), encoding="utf-8", newline="\n")
    shutil.copy2(geo_out, PUBLIC_DATA / "medan_districts_osm.geojson")

    inc_payload, st_payload = validate_and_emit_independent_candidates(district_features)
    inc_cand_out = PROCESSED / "public_incident_candidates.json"
    inc_cand_out.write_text(json.dumps(inc_payload, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    shutil.copy2(inc_cand_out, PUBLIC_DATA / "public_incident_candidates.json")

    st_cand_out = PROCESSED / "damkarmat_station_candidates.json"
    st_cand_out.write_text(json.dumps(st_payload, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    shutil.copy2(st_cand_out, PUBLIC_DATA / "damkarmat_station_candidates.json")

    spm_response_row = next((s for s in damkarmat_spm if s["unit"] == "menit"), None)
    summary_payload = {
        "generated_from": "data/raw/satudata-medan",
        "crs": "EPSG:4326",
        "summary_totals": {
            "year_2023": 219,
            "year_2024": 269,
            "year_2025": 251,
            "district_count": 21,
            "individual_geocoded_count": 0,
            "verified_station_count": 1,
            "population_2025_total": sum(p["population_2025"] for p in pop_by_name.values()),
            "monthly_2016_2021_total": sum(m["total_incidents"] for m in monthly_2016_2021),
            "bpbd_fire_2021": 108,
            "bpbd_fire_2022": 138,
            "bpbd_fire_2023": 87,
            "non_fire_rescues_2023_2025_total": non_fire_rescues["combined_total"],
            "spm_response_time_minutes": spm_response_row["realization_value"] if spm_response_row else None,
            "independent_candidate_incidents_total": inc_payload["summary"]["total_candidates"],
            "independent_candidate_incidents_approximate": inc_payload["summary"]["approximate_point_count"],
            "independent_candidate_incidents_district_only": inc_payload["summary"]["district_only_count"],
            "candidate_station_count": st_payload["summary"]["total_candidates"],
        },
        "district_2023": district_2023,
        "monthly_2024": monthly_2024,
        "monthly_2025": monthly_2025,
        "monthly_2023_impact": monthly_2023_impact,
        "annual_series": annual_series,
        "monthly_2016_2021": monthly_2016_2021,
        "bpbd_comparison": bpbd_comparison,
        "damkarmat_spm": damkarmat_spm,
        "non_fire_rescues": non_fire_rescues,
        "verified_stations": verified_stations,
        "candidate_stations": st_payload,
        "independent_incident_candidates": inc_payload,
        "unlocated_register": unlocated_register,
        "data_quality_anomalies": data_quality_anomalies,
    }
    summary_out = PROCESSED / "fire_incidents_summary.json"
    summary_out.write_text(json.dumps(summary_payload, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    shutil.copy2(summary_out, PUBLIC_DATA / "fire_incidents_summary.json")

    shutil.copy2(
        ROOT / "data" / "fixtures" / "demo" / "incident-explorer-sample.demo.json",
        PUBLIC_DEMO / "incident-explorer-sample.demo.json",
    )

    manifest_path = PUBLIC_DATA / "manifest.json"
    existing_manifest = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else {}
    )
    existing_verified_outputs = existing_manifest.get("verified_outputs")
    existing_roads_entry = next(
        (d for d in existing_manifest.get("datasets", []) if d.get("id") == "medan-roads-osm"),
        None,
    )
    existing_roads_blocker = next(
        (
            b
            for b in existing_manifest.get("blockers", [])
            if "sumatra-latest.osm.pbf" in b.get("url", "")
        ),
        None,
    )

    manifest = {
        "generated_at": "2026-11-23",
        "city": "Kota Medan",
        "crs_web": "EPSG:4326",
        "crs_metric": "EPSG:32647",
        **({"verified_outputs": existing_verified_outputs} if existing_verified_outputs is not None else {}),
        "datasets": [
            {
                "id": "medan-fire-2016-2021-bulanan",
                "title": "Daftar Jumlah Kebakaran Per Bulan Di Kota Medan Tahun 2016 - 2021 (72 Baris Bulanan)",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "Januari 2016 - Desember 2021",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 1372,
                "status": "verified",
                "dataset_group": "damkarmat_fire",
                "sha256": sha256_file(RAW_SATU / "Daftar_Jumlah_Kebakaran_Per_Bulan_Di_Kota_Medan_Tahun_2016_-_2021_Bulanan.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01jrymvexvvp9g4bg9z50xpvxp",
            },
            {
                "id": "bpbd-kebencanaan-2021-kecamatan",
                "title": "BPBD Rekapitulasi Bencana Tahun 2021 Menurut Kecamatan (Pembanding Kebakaran = 108)",
                "publisher": "BPBD Kota Medan (via Satu Data Medan)",
                "period": "2021",
                "granularity": "district_aggregate",
                "location_accuracy": "district_only",
                "record_count": 108,
                "status": "verified",
                "dataset_group": "bpbd_comparison",
                "sha256": sha256_file(RAW_SATU / "BPBD_Rekapitulasi_Bencana_Tahun_2021.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01k3msptkv0gdddt5d97r55rk2",
            },
            {
                "id": "bpbd-kebencanaan-2022-kecamatan",
                "title": "BPBD Rekapitulasi Kebencanaan Perkecamatan Tahun 2022 (Pembanding Kebakaran = 138)",
                "publisher": "BPBD Kota Medan (via Satu Data Medan)",
                "period": "2022",
                "granularity": "district_aggregate",
                "location_accuracy": "district_only",
                "record_count": 138,
                "status": "verified",
                "dataset_group": "bpbd_comparison",
                "sha256": sha256_file(RAW_SATU / "BPBD_Rekapitulasi_Kebencanaan_Perkecamatan_Tahun_2022.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01jvv2a8j83ybhn6z5xjpw9znp",
            },
            {
                "id": "bpbd-kebencanaan-2022-bulanan",
                "title": "BPBD Rekapitulasi Bencana Berdasarkan Jenis dan Bulan 2022 (Pembanding Kebakaran = 138)",
                "publisher": "BPBD Kota Medan (via Satu Data Medan)",
                "period": "Januari - Desember 2022",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 138,
                "status": "verified",
                "dataset_group": "bpbd_comparison",
                "sha256": sha256_file(RAW_SATU / "BPBD_Rekapitulasi_Bencana_Jenis_Bulanan_2022.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01k46rrywpd6yjr87zjn6mpgy9",
            },
            {
                "id": "bpbd-kebencanaan-2023-bulanan",
                "title": "BPBD Jumlah Kejadian Kebencanaan Menurut Jenis Per Bulan 2023 (Pembanding Kebakaran = 87)",
                "publisher": "BPBD Kota Medan (via Satu Data Medan)",
                "period": "Januari - Desember 2023",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 87,
                "status": "verified",
                "dataset_group": "bpbd_comparison",
                "sha256": sha256_file(RAW_SATU / "BPBD_Jumlah_Kejadian_Kebencanaan_Jenis_Bulanan_2023.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01k4pb0g0t6x05m7r8setmd2sk",
            },
            {
                "id": "bpbd-rekapitulasi-2021-2022",
                "title": "BPBD Rekapitulasi Total Kebencanaan Kota Medan 2021 - 2022 (152 dan 187)",
                "publisher": "BPBD Kota Medan (via Satu Data Medan)",
                "period": "2021 - 2022",
                "granularity": "annual_aggregate",
                "location_accuracy": "unknown",
                "record_count": 339,
                "status": "verified",
                "dataset_group": "bpbd_comparison",
                "sha256": sha256_file(RAW_SATU / "BPBD_Data_Rekapitulasi_Kebencanaan_2021_2022.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01k46scknttkcrft0zm8m4cg2z",
            },
            {
                "id": "medan-damkarmat-spm",
                "title": "Target dan Realisasi Pencapaian Standar Pelayanan Minimal Dinas Damkarmat",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "2023 - 2024",
                "granularity": "policy_table",
                "location_accuracy": "unknown",
                "record_count": 2,
                "status": "verified",
                "dataset_group": "damkarmat_spm",
                "sha256": sha256_file(RAW_SATU / "Target_Dan_Realisasi_Pencapaian_Standar_Pelayanan_Dinas_Pemadam_Kebakaran_Dan_Penyelamatan..xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01k87f0pqenry2bkvy0mvazah2",
            },
            {
                "id": "medan-non-fire-rescues-2023",
                "title": "Rekapitulasi Data Penyelamatan Non-Kebakaran Tahun 2023 (Terpisah)",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "Januari - Desember 2023",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 449,
                "status": "verified",
                "dataset_group": "damkarmat_non_fire",
                "sha256": sha256_file(RAW_SATU / "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2023.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36gzes0mxtmd6ykm1367ggn",
            },
            {
                "id": "medan-non-fire-rescues-2024",
                "title": "Rekapitulasi Data Penyelamatan Non-Kebakaran Tahun 2024 (Terpisah)",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "Januari - Desember 2024",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 691,
                "status": "verified",
                "dataset_group": "damkarmat_non_fire",
                "sha256": sha256_file(RAW_SATU / "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2024.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36ja2y8a9j0h0mdadc7f4sx",
            },
            {
                "id": "medan-non-fire-rescues-2025",
                "title": "Rekapitulasi Data Penyelamatan Non-Kebakaran Tahun 2025 (Terpisah)",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "Januari - Desember 2025",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 1078,
                "status": "verified",
                "dataset_group": "damkarmat_non_fire",
                "sha256": sha256_file(RAW_SATU / "Rekapitulasi_Data_Penyelamatan_Non_Kebakaran_Tahun_2025.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36kf1esskwdhks8xh35z5sj",
            },
            {
                "id": "medan-fire-2024",
                "title": "Rekapitulasi Data Kejadian Kebakaran di Kota Medan Tahun 2024",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "Januari - Desember 2024",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 269,
                "status": "verified",
                "sha256": sha256_file(RAW_SATU / "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2024.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36j14dc1thkhnag7p7sdm5w",
            },
            {
                "id": "medan-fire-2025",
                "title": "Rekapitulasi Data Kejadian Kebakaran di Kota Medan Tahun 2025",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "Januari - Desember 2025",
                "granularity": "monthly_aggregate",
                "location_accuracy": "unknown",
                "record_count": 251,
                "status": "verified",
                "sha256": sha256_file(RAW_SATU / "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2025.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36kqphpwh98z8q5q7y3bfaa",
            },
            {
                "id": "medan-fire-2023-kecamatan",
                "title": "Rekapitulasi Data Kebakaran Kota Medan Menurut Kecamatan Tahun 2023",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "2023",
                "granularity": "district_aggregate",
                "location_accuracy": "district_only",
                "record_count": 219,
                "status": "verified",
                "sha256": sha256_file(RAW_SATU / "Rekapitulasi_Data_Kejadian_Kebakaran_di_Kota_Medan_Tahun_2023.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36hqs3de8k1qab30hf8qthr",
            },
            {
                "id": "medan-districts-osm",
                "title": "Batas Administrasi 21 Kecamatan Kota Medan (Fallback OSM)",
                "publisher": "OpenStreetMap Nominatim (Fallback Geoportal Medan)",
                "period": "2026-11-19",
                "granularity": "polygon",
                "location_accuracy": "district_only",
                "record_count": 21,
                "status": "fallback_osm",
                "license": "ODbL 1.0 (© OpenStreetMap contributors)",
                "sha256": sha256_file(RAW_OSM / "medan_boundaries_osm_raw.geojson"),
                "url": "https://nominatim.openstreetmap.org/",
            },
            {
                "id": "medan-population-2025",
                "title": "Jumlah, Kepadatan, dan Distribusi Penduduk Kota Medan Menurut Kecamatan 2025",
                "publisher": "Badan Pusat Statistik via Satu Data Medan",
                "period": "2025",
                "granularity": "district_aggregate",
                "location_accuracy": "district_only",
                "record_count": 21,
                "status": "verified",
                "sha256": sha256_file(RAW_SATU / "Jumlah_Penduduk_Kepadatan_Penduduk_dan_Distribusi_Penduduk_Kota_Medan_Menurut_Kecamatan_Tahun_2025.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01kgkffcg30jq9zbnzx0exbeh4",
            },
            {
                "id": "medan-damkarmat-mako",
                "title": "Koordinat Resmi Mako 0.0 Dinas Damkarmat Kota Medan",
                "publisher": "Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Satu Data Medan)",
                "period": "2025-2026",
                "granularity": "station_point",
                "location_accuracy": "exact_verified",
                "record_count": 1,
                "status": "verified",
                "sha256": sha256_file(RAW_SATU / "Data_Informasi_Knowledge_Whatsapp_AI_Dinas_Pemadam_Kebakaran_dan_Penyelamatan_Kota_Medan.xlsx"),
                "url": "https://medanterkini.medan.go.id/api/resources/download/01m36k3bxe062dr4dw7raan3qe",
            },
        ]
        + ([existing_roads_entry] if existing_roads_entry is not None else []),
        "independent_enrichment": {
            "scope_note": "Kandidat dari media berita kredibel (ANTARA Sumut, Detik Sumut), JDIH BPK (Perwali 25/2018), dan geocoding ruas OSM Nominatim disimpan terpisah dari dataset resmi dan belum masuk perhitungan KDE maupun coverage terverifikasi.",
            "datasets": [
                {
                    "id": "medan-fire-incident-candidates",
                    "title": "Kandidat Kejadian Kebakaran Kota Medan (Media Independen 2024 - 2026)",
                    "publisher": "ANTARA News Sumut & Detik Sumut (+ OSM Nominatim)",
                    "period": "Januari 2024 - Juli 2026",
                    "record_count": inc_payload["summary"]["total_candidates"],
                    "accuracy_summary": "17 approximate (ruas/landmark) + 10 district_only (geom=null), Non-KDE",
                    "status": "needs_review",
                    "path": "/data/public_incident_candidates.json",
                    "sha256": sha256_text_asset(PUBLIC_DATA / "public_incident_candidates.json")[0],
                },
                {
                    "id": "medan-damkarmat-upt-candidates",
                    "title": "Kandidat Pos UPT Wilayah I - VI Dinas Damkarmat Kota Medan",
                    "publisher": "JDIH BPK (Perwali 25/2018), ANTARA Sumut, & OSM Nominatim",
                    "period": "2018 - 2026",
                    "record_count": st_payload["summary"]["total_candidates"],
                    "accuracy_summary": "2 approximate (UPT-05 & UPT-06) + 4 district_only (UPT-01..04, geom=null)",
                    "status": "needs_review",
                    "path": "/data/damkarmat_station_candidates.json",
                    "sha256": sha256_text_asset(PUBLIC_DATA / "damkarmat_station_candidates.json")[0],
                },
            ],
        },
        "blockers": [
            {
                "source": "Pos Damkarmat UPT Infografis & Berita Harian",
                "url": "https://p2k.medan.go.id/berita/Infografis-Letak-Pos-Damkarmat-Kota-Medan.html",
                "reason": "HTTP 403 tantangan anti-bot Cloudflare (challenges.cloudflare.com); tidak dilakukan bypass. Kandidat UPT dihimpun terpisah dengan status needs_review.",
            },
            {
                "source": "Geoportal Kota Medan (Batas Kelurahan / Kecamatan Resmi)",
                "url": "https://geoportal.medan.go.id/main/katalog",
                "reason": "HTTP 403 tantangan anti-bot Cloudflare; digantikan sementara dengan batas 21 kecamatan OpenStreetMap (ODbL)."
            },
            {
                "source": "BPS Kota Medan Portal Langsung",
                "url": "https://medankota.bps.go.id/id/statistics-table/2/MzEjMg%3D%3D/undefined",
                "reason": "Proteksi bot TSPD (HTTP 520) dan challenge Cloudflare; diatasi menggunakan tabel resmi BPS/Disdukcapil 2022-2025 di Satu Data Medan."
            },
            existing_roads_blocker
            or {
                "source": "Arsip Mentah Jaringan Jalan Sumatra OSM (Geofabrik PBF)",
                "url": "https://download.geofabrik.de/asia/indonesia/sumatra/sumatra-latest.osm.pbf",
                "reason": "Arsip 270 MB (data per 2026-11-20T21:21:03Z) tidak di-commit ke Git (tersimpan di data/raw/ yang di-gitignore); jaringan jalan drivable Kota Medan telah diekstrak ke EPSG:32647.",
            },
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")

    staging_bundle = build_supabase_staging_bundle(
        summary_payload=summary_payload,
        bpbd_comparison=bpbd_comparison,
        monthly_2016_2021=monthly_2016_2021,
        inc_payload=inc_payload,
        st_payload=st_payload,
        manifest=manifest,
    )
    staging_out = PROCESSED / "supabase_staging_bundle.json"
    staging_out.write_text(json.dumps(staging_bundle, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")

    print("Processed GeoJSON bytes:", geo_out.stat().st_size)
    print("Processed summary JSON bytes:", summary_out.stat().st_size)
    print("Processed Supabase staging bundle bytes:", staging_out.stat().st_size)
    print("Population 2025 total:", summary_payload["summary_totals"]["population_2025_total"])
    print("Independent candidate incidents:", inc_payload["summary"]["total_candidates"])
    print("Candidate UPT stations:", st_payload["summary"]["total_candidates"])


if __name__ == "__main__":
    main()
