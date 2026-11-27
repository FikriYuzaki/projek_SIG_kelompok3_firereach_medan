"""
Pipeline PyQGIS Fire Service Priority Planner Kota Medan (`priority-planner`).

Menggabungkan:
1. Kejadian kebakaran historis 2023 per kecamatan (`public/data/fire_incidents_summary.json`, 219 kejadian).
2. Populasi dan kepadatan penduduk BPS 2025 (`data/processed/medan_population_2022_2025.csv`).
3. Batas 21 kecamatan OSM (`public/data/medan_districts_osm.geojson`).
4. Kesenjangan jangkauan layanan dari `public/data/station-coverage.provisional.json` (jika tersedia).

Menghasilkan:
- `public/data/priority-planner.provisional.json` (untuk aplikasi web)
- `qgis/priority-analysis/layers/priority_analysis.gpkg` (`EPSG:32647` untuk proyek QGIS)
"""

from __future__ import annotations

import csv
from datetime import date
import gc
import json
from pathlib import Path
import sys
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = _SCRIPT_DIR.parents[1]
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from priority_core import (  # noqa: E402
    DEFAULT_WEIGHTS,
    METHOD_VERSION,
    compute_priority_scores,
    validate_and_join_districts,
    validate_priority_output,
)


def _read_population_csv(csv_path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(
                {
                    "area_code": str(row.get("area_code") or "").strip(),
                    "district_name": str(row.get("district_name") or "").strip(),
                    "population_2025_bps": float(row["population_2025_bps"]) if row.get("population_2025_bps") else None,
                    "density_km2_2025_bps": float(row["density_km2_2025_bps"]) if row.get("density_km2_2025_bps") else None,
                }
            )
    return rows


def _execute_priority_pipeline(
    summary_path: Path,
    pop_csv_path: Path,
    boundary_path: Path,
    coverage_json_path: Path,
    hotspot_json_path: Path,
    out_json_path: Path,
    out_gpkg_path: Path,
) -> dict[str, Any]:
    from qgis.core import (
        QgsCoordinateReferenceSystem,
        QgsFeature,
        QgsField,
        QgsGeometry,
        QgsPointXY,
        QgsProject,
        QgsVectorFileWriter,
        QgsVectorLayer,
    )
    from qgis.PyQt.QtCore import QMetaType
    import processing

    summary_data = json.loads(summary_path.read_text(encoding="utf-8"))
    boundary_geojson = json.loads(boundary_path.read_text(encoding="utf-8"))
    pop_rows = _read_population_csv(pop_csv_path)

    coverage_rows = None
    coverage_5pos_rows = None
    if coverage_json_path.exists():
        cov_payload = json.loads(coverage_json_path.read_text(encoding="utf-8"))
        if cov_payload.get("isDemo") is False:
            coverage_rows = cov_payload.get("district_coverage")
            cand_scen = cov_payload.get("candidate_coverage_scenario") or {}
            if isinstance(cand_scen.get("district_coverage"), list):
                coverage_5pos_rows = cand_scen.get("district_coverage")

    join_res = validate_and_join_districts(
        fire_districts=summary_data.get("district_2023") or [],
        pop_rows=pop_rows,
        boundary_geojson=boundary_geojson,
        coverage_rows=coverage_rows,
    )
    score_res = compute_priority_scores(
        joined_rows=join_res["rows"],
        weights=DEFAULT_WEIGHTS,
        coverage_available=join_res["coverage_available"],
        data_label="PROVISIONAL",
    )

    multi_station_zones = None
    if coverage_5pos_rows:
        join_5pos = validate_and_join_districts(
            fire_districts=summary_data.get("district_2023") or [],
            pop_rows=pop_rows,
            boundary_geojson=boundary_geojson,
            coverage_rows=coverage_5pos_rows,
        )
        score_5pos = compute_priority_scores(
            joined_rows=join_5pos["rows"],
            weights=DEFAULT_WEIGHTS,
            coverage_available=join_5pos["coverage_available"],
            data_label="PROVISIONAL",
        )
        multi_station_zones = score_5pos["zones"]

    # Integrasi diagnostik KDE eksploratif (hotspot-analyzer.exploratory.geojson) dalam EPSG:32647
    utm_crs = QgsCoordinateReferenceSystem("EPSG:32647")
    kde_diag_by_code: dict[str, dict[str, Any]] = {}
    if hotspot_json_path.exists():
        hs_lyr_wgs = QgsVectorLayer(str(hotspot_json_path), "hotspot_exp", "ogr")
        if hs_lyr_wgs.isValid():
            hs_utm = processing.run(
                "native:reprojectlayer",
                {"INPUT": hs_lyr_wgs, "TARGET_CRS": utm_crs, "OUTPUT": "memory:"},
            )["OUTPUT"]
            dist_wgs_tmp = QgsVectorLayer(str(boundary_path), "dist_tmp", "ogr")
            dist_utm_tmp = processing.run(
                "native:fixgeometries",
                {
                    "INPUT": processing.run(
                        "native:reprojectlayer",
                        {"INPUT": dist_wgs_tmp, "TARGET_CRS": utm_crs, "OUTPUT": "memory:"},
                    )["OUTPUT"],
                    "OUTPUT": "memory:",
                },
            )["OUTPUT"]
            hs_geoms = [(int(f["density_rank"] or 0), f.geometry()) for f in hs_utm.getFeatures() if f.geometry()]
            for df in dist_utm_tmp.getFeatures():
                code = str(df["area_code"])
                d_geom = df.geometry()
                d_area = max(1.0, d_geom.area())
                covered_parts = []
                max_rank = 0
                for rk, hg in hs_geoms:
                    inter = d_geom.intersection(hg)
                    if inter and not inter.isEmpty() and inter.area() > 1.0:
                        covered_parts.append(inter)
                        if rk > max_rank:
                            max_rank = rk
                if covered_parts:
                    merged_cov = covered_parts[0] if len(covered_parts) == 1 else QgsGeometry.unaryUnion(covered_parts)
                    cov_pct = round(min(100.0, (merged_cov.area() / d_area) * 100.0), 2)
                else:
                    cov_pct = 0.0
                kde_diag_by_code[code] = {
                    "kde_exploratory_coverage_pct": cov_pct,
                    "kde_exploratory_max_rank": max_rank,
                }

    gap5_by_code = {str(r["area_code"]): r for r in (coverage_5pos_rows or [])}
    for zone_list in (score_res["zones"], multi_station_zones or []):
        for z in zone_list:
            c = z["area_code"]
            kd = kde_diag_by_code.get(c, {})
            z["kde_exploratory_coverage_pct"] = kd.get("kde_exploratory_coverage_pct", 0.0)
            z["kde_exploratory_max_rank"] = kd.get("kde_exploratory_max_rank", 0)
            g5 = gap5_by_code.get(c)
            z["network_5km_coverage_pct_5pos"] = g5.get("network_5km_coverage_pct") if g5 else None
            z["network_5km_gap_ratio_5pos"] = g5.get("network_5km_gap_ratio") if g5 else None

    is_partial = score_res["mode"] == "partial"
    data_status = "partial_no_coverage" if is_partial else "integrated_real_data_21_districts"

    output_payload = {
        "isDemo": False,
        "dataLabel": "PROVISIONAL",
        "module": "priority-planner",
        "owner": "Olo",
        "generated_at": date.today().isoformat(),
        "notice": (
            "ANALISIS PRIORITAS TERINTEGRASI (21 KECAMATAN): menggabungkan beban kebakaran resmi 2023 (219 kejadian) "
            "+ overlay zona KDE eksploratif insiden publik, kepadatan penduduk BPS 2025 (2.498.293 jiwa), dan gap "
            "jangkauan jaringan jalan 5 km (mode baseline terverifikasi Mako 0.0 maupun skenario 5 pos berkoordinat OSM)."
        ),
        "analysis": {
            "title": "Indeks Prioritas Peningkatan Layanan Pemadam Kebakaran Kota Medan (21 Kecamatan)",
            "method_version": "priority-v2.0-integrated",
            "data_status": data_status,
            "period_label": "Kebakaran 2023, Insiden Publik KDE 2024-2026, Penduduk BPS 2025, Jaringan Jalan OSM",
            "analysis_unit": "kecamatan (21 unit, area_code 12.71.01 - 12.71.21)",
            "weights": score_res["weights"],
            "normalization_method": "Min-Max (x - min) / (max - min) pada 21 kecamatan; arah: nilai lebih tinggi = prioritas lebih tinggi",
            "composite_formula": "0.40 * hotspot_score + 0.35 * coverage_gap_score + 0.25 * population_exposure_score",
            "tier_classification": "Quantile 4 kelas (Rendah, Sedang, Tinggi, Sangat Tinggi) atas composite_score",
            "tier_breaks": score_res["tier_breaks"],
            "normalization_diagnostics": score_res["normalization"],
            "indicator_availability": {
                "official_fire_2023": True,
                "exploratory_kde_public": bool(kde_diag_by_code),
                "verified_station_coverage_5km": join_res["coverage_available"],
                "multi_station_coverage_5km": bool(multi_station_zones),
                "bps_population_2025": True,
            },
            "sources": [
                "Dinas Damkarmat Kota Medan via Satu Data Medan (Agregat Kebakaran 2023: 219 kejadian, Mako 0.0)",
                "KDE Eksploratif Insiden Publik Kota Medan (22 titik geocode ruas jalan OSM)",
                "BPS Kota Medan via Satu Data Medan (Penduduk & Kepadatan 2025: 2.498.293 jiwa)",
                "OpenStreetMap Nominatim & Geofabrik Sumatra PBF (© OpenStreetMap contributors, ODbL 1.0)",
            ],
            "limitations": [
                "hotspot_score baku memakai agregat resmi kecamatan 2023 per 10.000 penduduk agar konsisten antar 21 kecamatan; persentase tumpang tindih KDE eksploratif disajikan terpisah sebagai indikator diagnostik.",
                join_res["coverage_note"],
                "population_exposure_score mencerminkan kepadatan penduduk sebagai indikator paparan, bukan jumlah korban maupun prediksi kejadian.",
                "Batas administrasi memakai fallback OpenStreetMap (bukan batas resmi Geoportal Pemko Medan).",
            ],
            "qa_anomalies_2023": join_res["qa_anomalies"],
        },
        "zones": score_res["zones"],
        "zones_multi_station": multi_station_zones,
    }

    contract_check = validate_priority_output(output_payload)
    if not contract_check["valid"]:
        raise RuntimeError(
            "Output priority-planner gagal validasi kontrak: " + "; ".join(contract_check["errors"])
        )

    out_json_path.parent.mkdir(parents=True, exist_ok=True)
    out_json_path.write_text(json.dumps(output_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # Tulis GeoPackage EPSG:32647 untuk proyek QGIS
    utm_crs = QgsCoordinateReferenceSystem("EPSG:32647")
    boundary_wgs = QgsVectorLayer(str(boundary_path), "districts", "ogr")
    districts_utm_raw = processing.run(
        "native:reprojectlayer",
        {"INPUT": boundary_wgs, "TARGET_CRS": utm_crs, "OUTPUT": "memory:"},
    )["OUTPUT"]
    districts_utm = processing.run(
        "native:fixgeometries",
        {"INPUT": districts_utm_raw, "OUTPUT": "memory:"},
    )["OUTPUT"]

    zones_by_code = {z["area_code"]: z for z in score_res["zones"]}
    prio_layer = QgsVectorLayer("MultiPolygon?crs=EPSG:32647", "priority_districts_21_utm", "memory")
    p_prov = prio_layer.dataProvider()
    p_prov.addAttributes(
        [
            QgsField("area_code", QMetaType.Type.QString),
            QgsField("area_name", QMetaType.Type.QString),
            QgsField("incidents_2023", QMetaType.Type.Int),
            QgsField("population_2025", QMetaType.Type.Int),
            QgsField("density_km2", QMetaType.Type.Double),
            QgsField("hotspot_score", QMetaType.Type.Double),
            QgsField("coverage_gap_score", QMetaType.Type.Double),
            QgsField("pop_exposure_score", QMetaType.Type.Double),
            QgsField("composite_score", QMetaType.Type.Double),
            QgsField("priority_rank", QMetaType.Type.Int),
            QgsField("priority_tier", QMetaType.Type.QString),
            QgsField("priority_reason", QMetaType.Type.QString),
            QgsField("data_label", QMetaType.Type.QString),
        ]
    )
    prio_layer.updateFields()

    p_feats = []
    for feat in districts_utm.getFeatures():
        code = str(feat["area_code"])
        z = zones_by_code[code]
        g = QgsGeometry(feat.geometry())
        g.convertToMultiType()
        qf = QgsFeature(prio_layer.fields())
        qf.setGeometry(g)
        qf.setAttributes(
            [
                z["area_code"],
                z["area_name"],
                z["incidents_2023"],
                z["population_2025"],
                z["density_km2_2025"],
                z["hotspot_score"],
                z["coverage_gap_score"] if z["coverage_gap_score"] is not None else -1.0,
                z["population_exposure_score"],
                z["composite_score"] if z["composite_score"] is not None else -1.0,
                z["priority_rank"] if z["priority_rank"] is not None else 0,
                z["priority_tier"],
                z["priority_reason"],
                z["dataLabel"],
            ]
        )
        p_feats.append(qf)
    p_prov.addFeatures(p_feats)
    prio_layer.updateExtents()

    # Layer Mako 0.0 untuk konteks visual di proyek QGIS
    mako_wgs = QgsVectorLayer("Point?crs=EPSG:4326", "mako_verified", "memory")
    m_prov = mako_wgs.dataProvider()
    m_prov.addAttributes([QgsField("station_code", QMetaType.Type.QString), QgsField("name", QMetaType.Type.QString)])
    mako_wgs.updateFields()
    m_feats = []
    for st in summary_data.get("verified_stations") or []:
        mf = QgsFeature(mako_wgs.fields())
        mf.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(float(st["lon"]), float(st["lat"]))))
        mf.setAttributes([st["station_code"], st["name"]])
        m_feats.append(mf)
    m_prov.addFeatures(m_feats)
    mako_wgs.updateExtents()
    mako_utm = processing.run(
        "native:reprojectlayer",
        {"INPUT": mako_wgs, "TARGET_CRS": utm_crs, "OUTPUT": "memory:"},
    )["OUTPUT"]

    out_gpkg_path.parent.mkdir(parents=True, exist_ok=True)
    if out_gpkg_path.exists():
        out_gpkg_path.unlink()

    ctx = QgsProject.instance().transformContext()
    for idx, (lname, lyr) in enumerate((("priority_districts_21_utm", prio_layer), ("mako_verified", mako_utm))):
        opts = QgsVectorFileWriter.SaveVectorOptions()
        opts.driverName = "GPKG"
        opts.layerName = lname
        opts.fileEncoding = "UTF-8"
        opts.actionOnExistingFile = (
            QgsVectorFileWriter.CreateOrOverwriteFile if idx == 0 else QgsVectorFileWriter.CreateOrOverwriteLayer
        )
        err, msg, _, _ = QgsVectorFileWriter.writeAsVectorFormatV3(lyr, str(out_gpkg_path), ctx, opts)
        if err != QgsVectorFileWriter.NoError:
            raise RuntimeError(f"Gagal menulis layer {lname} ke GPKG: {msg}")

    print(
        f"Selesai priority-planner ({score_res['mode']}): 21 kecamatan tersimpan ke {out_json_path.name} dan {out_gpkg_path.name}."
    )
    return output_payload


def run_pipeline() -> dict[str, Any]:
    from qgis.core import QgsApplication, QgsProject

    summary_path = REPO_ROOT / "public" / "data" / "fire_incidents_summary.json"
    pop_csv_path = REPO_ROOT / "data" / "processed" / "medan_population_2022_2025.csv"
    boundary_path = REPO_ROOT / "public" / "data" / "medan_districts_osm.geojson"
    coverage_json_path = REPO_ROOT / "public" / "data" / "station-coverage.provisional.json"
    hotspot_json_path = REPO_ROOT / "public" / "data" / "hotspot-analyzer.exploratory.geojson"
    out_json_path = REPO_ROOT / "public" / "data" / "priority-planner.provisional.json"
    out_gpkg_path = _SCRIPT_DIR / "layers" / "priority_analysis.gpkg"

    owns_qgis_app = QgsApplication.instance() is None
    qgs = None
    if owns_qgis_app:
        qgs = QgsApplication([], False)
        qgs.initQgis()

    plugins_dir = Path(QgsApplication.pkgDataPath()) / "python" / "plugins"
    if plugins_dir.is_dir() and str(plugins_dir) not in sys.path:
        sys.path.insert(0, str(plugins_dir))

    from processing.core.Processing import Processing

    if owns_qgis_app:
        Processing.initialize()

    try:
        return _execute_priority_pipeline(
            summary_path=summary_path,
            pop_csv_path=pop_csv_path,
            boundary_path=boundary_path,
            coverage_json_path=coverage_json_path,
            hotspot_json_path=hotspot_json_path,
            out_json_path=out_json_path,
            out_gpkg_path=out_gpkg_path,
        )
    finally:
        QgsProject.instance().clear()
        gc.collect()
        if owns_qgis_app:
            Processing.deinitialize()
            if qgs is not None:
                qgs.exitQgis()


if __name__ == "__main__":
    run_pipeline()
