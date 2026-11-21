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


def validate_ring_extent(ring: list[list[float]], label: str):
    assert len(ring) >= 4, f"{label}: ring has fewer than 4 points"
    assert ring[0] == ring[-1], f"{label}: ring is not closed"
    for lon, lat in ring:
        assert MEDAN_BOUNDS["min_lon"] <= lon <= MEDAN_BOUNDS["max_lon"], f"{label}: lon {lon} out of extent"
        assert MEDAN_BOUNDS["min_lat"] <= lat <= MEDAN_BOUNDS["max_lat"], f"{label}: lat {lat} out of extent"


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
    geo_out.write_text(json.dumps(districts_geojson, ensure_ascii=False), encoding="utf-8")
    shutil.copy2(geo_out, PUBLIC_DATA / "medan_districts_osm.geojson")

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
        },
        "district_2023": district_2023,
        "monthly_2024": monthly_2024,
        "monthly_2025": monthly_2025,
        "monthly_2023_impact": monthly_2023_impact,
        "annual_series": annual_series,
        "verified_stations": verified_stations,
        "unlocated_register": unlocated_register,
        "data_quality_anomalies": data_quality_anomalies,
    }
    summary_out = PROCESSED / "fire_incidents_summary.json"
    summary_out.write_text(json.dumps(summary_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    shutil.copy2(summary_out, PUBLIC_DATA / "fire_incidents_summary.json")

    shutil.copy2(
        ROOT / "data" / "fixtures" / "demo" / "incident-explorer-sample.demo.json",
        PUBLIC_DEMO / "incident-explorer-sample.demo.json",
    )

    manifest = {
        "generated_at": "2026-11-19",
        "city": "Kota Medan",
        "crs_web": "EPSG:4326",
        "crs_metric": "EPSG:32647",
        "datasets": [
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
        ],
        "blockers": [
            {
                "source": "Pos Damkarmat UPT Infografis & Berita Harian",
                "url": "https://p2k.medan.go.id/berita/Infografis-Letak-Pos-Damkarmat-Kota-Medan.html",
                "reason": "HTTP 403 tantangan anti-bot Cloudflare (challenges.cloudflare.com); perlu pengunduhan manual di browser oleh tim."
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
            {
                "source": "Jaringan Jalan Sumatra OSM (Geofabrik)",
                "url": "https://download.geofabrik.de/asia/indonesia/sumatra-latest.osm.pbf",
                "reason": "Arsip 270 MB (data per 2026-11-18T21:21:02Z) tidak diunduh ke Git; akan diekstrak dan dipotong lokal oleh Adriel di QGIS."
            }
        ]
    }
    (PUBLIC_DATA / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Processed GeoJSON bytes:", geo_out.stat().st_size)
    print("Processed summary JSON bytes:", summary_out.stat().st_size)
    print("Population 2025 total:", summary_payload["summary_totals"]["population_2025_total"])


if __name__ == "__main__":
    main()
