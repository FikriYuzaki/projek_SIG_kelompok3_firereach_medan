"""
Pipeline PyQGIS analisis jangkauan pos pemadam kebakaran Kota Medan (`station-coverage`).

Menjalankan pada CRS metrik `EPSG:32647`:
1. Validasi pos pemadam kebakaran terverifikasi (saat ini hanya Mako 0.0; menolak DEMO-UPT-1).
2. Buffer Euclidean (2.000 m, 3.000 m, 5.000 m) diklip ke batas Kota Medan.
3. Service Area berbasis jaringan jalan OSM (2.000 m, 3.000 m, 5.000 m) memakai `native:serviceareafromlayer`.
4. Perbandingan cakupan wilayah & gap pada 21 kecamatan (`12.71.01`..`12.71.21`).
5. Ekspor GeoPackage `qgis/station-coverage/layers/station_coverage_analysis.gpkg` (`EPSG:32647`)
   dan output web `public/data/station-coverage.provisional.json` (`EPSG:4326`).
"""

from __future__ import annotations

from datetime import date
import gc
import json
from pathlib import Path
import sys
import tempfile
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = _SCRIPT_DIR.parents[1]
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from coverage_core import (  # noqa: E402
    DEFAULT_ASSUMED_SPEED_KMH,
    DEFAULT_THRESHOLDS_METERS,
    REQUIRED_OUTPUT_CRS,
    REQUIRED_WORKING_CRS,
    compute_district_coverage_row,
    compute_scenario_time_minutes,
    validate_station_coverage_output,
    validate_station_records,
)


def _extract_polygons_only(geom: Any) -> Any:
    from qgis.core import Qgis, QgsGeometry

    if geom is None or geom.isNull() or geom.isEmpty():
        return None
    parts: list[QgsGeometry] = []
    for sub in geom.asGeometryCollection():
        if sub.type() == Qgis.GeometryType.Polygon and not sub.isEmpty():
            parts.append(QgsGeometry(sub))
    if not parts:
        return None
    merged = parts[0] if len(parts) == 1 else QgsGeometry.unaryUnion(parts)
    if merged is None or merged.isEmpty():
        return None
    merged = merged.makeValid()
    if merged.type() != Qgis.GeometryType.Polygon:
        poly_parts = [QgsGeometry(s) for s in merged.asGeometryCollection() if s.type() == Qgis.GeometryType.Polygon and not s.isEmpty()]
        if not poly_parts:
            return None
        merged = poly_parts[0] if len(poly_parts) == 1 else QgsGeometry.unaryUnion(poly_parts)
    merged.convertToMultiType()
    return merged


def _execute_coverage(
    summary_path: Path,
    boundary_path: Path,
    roads_gpkg_path: Path,
    roads_meta_path: Path,
    out_json_path: Path,
    out_gpkg_path: Path,
    thresholds_m: tuple[int, ...] = DEFAULT_THRESHOLDS_METERS,
    assumed_speed_kmh: float = DEFAULT_ASSUMED_SPEED_KMH,
) -> dict[str, Any]:
    from qgis.core import (
        Qgis,
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
    roads_meta = json.loads(roads_meta_path.read_text(encoding="utf-8"))

    raw_stations = summary_data.get("verified_stations") or []
    station_val = validate_station_records(raw_stations, boundary_geojson)
    accepted_stations = station_val["accepted"]
    if not accepted_stations:
        raise RuntimeError(
            "Tidak ada pos Damkarmat terverifikasi di dalam batas Kota Medan. "
            f"Ringkasan: {json.dumps(station_val['summary'], ensure_ascii=False)}"
        )

    wgs84_crs = QgsCoordinateReferenceSystem(REQUIRED_OUTPUT_CRS)
    utm_crs = QgsCoordinateReferenceSystem(REQUIRED_WORKING_CRS)

    # Layer stasiun terverifikasi
    mako_wgs = QgsVectorLayer("Point?crs=EPSG:4326", "mako_verified", "memory")
    m_prov = mako_wgs.dataProvider()
    m_prov.addAttributes(
        [
            QgsField("station_code", QMetaType.Type.QString),
            QgsField("name", QMetaType.Type.QString),
            QgsField("station_type", QMetaType.Type.QString),
            QgsField("address", QMetaType.Type.QString),
            QgsField("verification_status", QMetaType.Type.QString),
        ]
    )
    mako_wgs.updateFields()
    station_feats = []
    for st in accepted_stations:
        qf = QgsFeature(mako_wgs.fields())
        qf.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(st["lon"], st["lat"])))
        qf.setAttributes(
            [st["station_code"], st["name"], st["station_type"], st["address"], st["verification_status"]]
        )
        station_feats.append(qf)
    m_prov.addFeatures(station_feats)
    mako_wgs.updateExtents()

    mako_utm = processing.run(
        "native:reprojectlayer",
        {"INPUT": mako_wgs, "TARGET_CRS": utm_crs, "OUTPUT": "memory:"},
    )["OUTPUT"]

    boundary_wgs = QgsVectorLayer(str(boundary_path), "districts", "ogr")
    roads_layer = QgsVectorLayer(f"{roads_gpkg_path}|layername=medan_roads_utm", "roads_utm", "ogr")
    if not boundary_wgs.isValid() or not roads_layer.isValid():
        raise RuntimeError("Layer boundary atau jaringan jalan gagal dibuka oleh QGIS.")

    districts_utm_raw = processing.run(
        "native:reprojectlayer",
        {"INPUT": boundary_wgs, "TARGET_CRS": utm_crs, "OUTPUT": "memory:"},
    )["OUTPUT"]
    districts_utm = processing.run(
        "native:fixgeometries",
        {"INPUT": districts_utm_raw, "OUTPUT": "memory:"},
    )["OUTPUT"]

    city_dissolved = processing.run(
        "native:dissolve",
        {"INPUT": districts_utm, "OUTPUT": "memory:"},
    )["OUTPUT"]
    city_geom = None
    for feat in city_dissolved.getFeatures():
        g = feat.geometry()
        city_geom = g if city_geom is None else city_geom.combine(g)
    if city_geom is None or city_geom.isEmpty():
        raise RuntimeError("Geometri batas gabungan Kota Medan kosong.")

    # Siapkan layer hasil di EPSG:32647
    euc_layer_utm = QgsVectorLayer("MultiPolygon?crs=EPSG:32647", "euclidean_buffers_utm", "memory")
    e_prov = euc_layer_utm.dataProvider()
    e_prov.addAttributes(
        [
            QgsField("station_code", QMetaType.Type.QString),
            QgsField("method_type", QMetaType.Type.QString),
            QgsField("threshold_m", QMetaType.Type.Int),
            QgsField("coverage_tier", QMetaType.Type.QString),
            QgsField("area_km2", QMetaType.Type.Double),
        ]
    )
    euc_layer_utm.updateFields()

    net_layer_utm = QgsVectorLayer("MultiPolygon?crs=EPSG:32647", "network_service_areas_utm", "memory")
    n_prov = net_layer_utm.dataProvider()
    n_prov.addAttributes(
        [
            QgsField("station_code", QMetaType.Type.QString),
            QgsField("method_type", QMetaType.Type.QString),
            QgsField("threshold_m", QMetaType.Type.Int),
            QgsField("assumed_speed_kmh", QMetaType.Type.Double),
            QgsField("scenario_minutes", QMetaType.Type.Double),
            QgsField("coverage_tier", QMetaType.Type.QString),
            QgsField("road_length_km", QMetaType.Type.Double),
            QgsField("area_km2", QMetaType.Type.Double),
        ]
    )
    net_layer_utm.updateFields()

    net_geom_by_thresh: dict[int, QgsGeometry] = {}
    euc_geom_by_thresh: dict[int, QgsGeometry] = {}
    net_lines_5km_layer = None
    summary_by_threshold: list[dict[str, Any]] = []

    station_label = ", ".join(s["station_code"] for s in accepted_stations)

    # Saring jaringan jalan ke cakupan maksimum + 1.500 m dari stasiun agar analisis graf cepat & akurat
    max_thresh = float(max(thresholds_m))
    search_extent = mako_utm.extent()
    search_extent.grow(max_thresh + 1500.0)
    roads_scoped = processing.run(
        "native:extractbyextent",
        {
            "INPUT": roads_layer,
            "EXTENT": search_extent,
            "CLIP": False,
            "OUTPUT": "memory:",
        },
    )["OUTPUT"]

    for thresh in sorted(thresholds_m):
        # A. Euclidean buffer
        buf_raw = processing.run(
            "native:buffer",
            {
                "INPUT": mako_utm,
                "DISTANCE": float(thresh),
                "SEGMENTS": 24,
                "END_CAP_STYLE": 0,
                "JOIN_STYLE": 0,
                "MITER_LIMIT": 2.0,
                "DISSOLVE": True,
                "OUTPUT": "memory:",
            },
        )["OUTPUT"]
        buf_parts = []
        for f in buf_raw.getFeatures():
            clipped = _extract_polygons_only(f.geometry().intersection(city_geom))
            if clipped is not None:
                buf_parts.append(clipped)
        if not buf_parts:
            raise RuntimeError(f"Buffer Euclidean {thresh}m kosong.")
        buf_geom = _extract_polygons_only(buf_parts[0] if len(buf_parts) == 1 else QgsGeometry.unaryUnion(buf_parts))
        euc_geom_by_thresh[thresh] = buf_geom
        euc_area_km2 = round(buf_geom.area() / 1_000_000.0, 4)

        ef = QgsFeature(euc_layer_utm.fields())
        ef.setGeometry(buf_geom)
        ef.setAttributes(
            [
                station_label,
                "euclidean_buffer",
                int(thresh),
                f"Buffer Lurus {thresh // 1000} km",
                euc_area_km2,
            ]
        )
        e_prov.addFeatures([ef])

        # B. Network Service Area (QGIS Shortest path in meters on EPSG:32647 road graph)
        sa_res = processing.run(
            "native:serviceareafromlayer",
            {
                "INPUT": roads_scoped,
                "STRATEGY": 0,
                "DIRECTION_FIELD": "oneway_dir",
                "VALUE_FORWARD": "F",
                "VALUE_BACKWARD": "B",
                "VALUE_BOTH": "BOTH",
                "DEFAULT_DIRECTION": 2,
                "SPEED_FIELD": "",
                "DEFAULT_SPEED": float(assumed_speed_kmh),
                "TOLERANCE": 0.0,
                "START_POINTS": mako_utm,
                "TRAVEL_COST2": float(thresh),
                "INCLUDE_BOUNDS": False,
                "POINT_TOLERANCE": 250.0,
                "OUTPUT_LINES": "memory:",
                "OUTPUT": "TEMPORARY_OUTPUT",
            },
        )
        sa_lines = sa_res["OUTPUT_LINES"]
        if not sa_lines or sa_lines.featureCount() == 0:
            raise RuntimeError(f"Service area jaringan jalan {thresh}m menghasilkan 0 segmen.")

        line_geoms: list[QgsGeometry] = []
        road_len_m = 0.0
        for f in sa_lines.getFeatures():
            g = f.geometry()
            if g is None or g.isNull() or g.isEmpty():
                continue
            for sub in g.asGeometryCollection():
                if sub.type() == Qgis.GeometryType.Line and sub.length() > 0.5:
                    line_geoms.append(QgsGeometry(sub))
                    road_len_m += float(sub.length())

        if not line_geoms:
            raise RuntimeError(f"Service area jaringan jalan {thresh}m tidak memiliki segmen garis valid.")

        print(f"Threshold {thresh}m: {len(line_geoms)} segmen jaringan jalan ditemukan.", flush=True)
        road_len_km = round(road_len_m / 1000.0, 2)
        if thresh == max(thresholds_m):
            clean_lines_lyr = QgsVectorLayer("MultiLineString?crs=EPSG:32647", "network_lines_5km_utm", "memory")
            cl_prov = clean_lines_lyr.dataProvider()
            cl_prov.addAttributes([QgsField("threshold_m", QMetaType.Type.Int)])
            clean_lines_lyr.updateFields()
            merged_lines = QgsGeometry.collectGeometry(line_geoms)
            merged_lines.convertToMultiType()
            lf = QgsFeature(clean_lines_lyr.fields())
            lf.setGeometry(merged_lines)
            lf.setAttributes([int(thresh)])
            cl_prov.addFeatures([lf])
            clean_lines_lyr.updateExtents()
            net_lines_5km_layer = clean_lines_lyr

        batch_polys: list[QgsGeometry] = []
        chunk_size = 500
        for i in range(0, len(line_geoms), chunk_size):
            chunk_multi = QgsGeometry.collectGeometry(line_geoms[i : i + chunk_size])
            buf_chunk = chunk_multi.buffer(150.0, 5)
            if buf_chunk is not None and not buf_chunk.isNull() and not buf_chunk.isEmpty():
                batch_polys.append(buf_chunk)
        if not batch_polys:
            raise RuntimeError(f"Buffer service area {thresh}m menghasilkan geometri kosong.")
        buffered_raw = batch_polys[0] if len(batch_polys) == 1 else QgsGeometry.unaryUnion(batch_polys)
        net_geom = _extract_polygons_only(buffered_raw.intersection(city_geom))
        if net_geom is None or net_geom.isEmpty():
            raise RuntimeError(f"Poligon service area {thresh}m kosong.")
        net_geom_by_thresh[thresh] = net_geom
        net_area_km2 = round(net_geom.area() / 1_000_000.0, 4)
        scen_min = compute_scenario_time_minutes(thresh, assumed_speed_kmh)

        nf = QgsFeature(net_layer_utm.fields())
        nf.setGeometry(net_geom)
        nf.setAttributes(
            [
                station_label,
                "network_service_area",
                int(thresh),
                float(assumed_speed_kmh),
                scen_min,
                f"Jaringan Jalan {thresh // 1000} km (~{scen_min:.1f} mnt @ {int(assumed_speed_kmh)} km/j)",
                road_len_km,
                net_area_km2,
            ]
        )
        n_prov.addFeatures([nf])

        summary_by_threshold.append(
            {
                "threshold_meters": int(thresh),
                "scenario_minutes": scen_min,
                "assumed_speed_kmh": float(assumed_speed_kmh),
                "euclidean_area_km2": euc_area_km2,
                "network_area_km2": net_area_km2,
                "network_road_length_km": road_len_km,
                "network_vs_euclidean_ratio": round(net_area_km2 / euc_area_km2, 4) if euc_area_km2 > 0 else 0.0,
            }
        )

    euc_layer_utm.updateExtents()
    net_layer_utm.updateExtents()

    # C. Statistik cakupan per 21 kecamatan
    mako_pt_utm = next(mako_utm.getFeatures()).geometry()
    district_cov_layer = QgsVectorLayer("MultiPolygon?crs=EPSG:32647", "district_coverage_21_utm", "memory")
    dc_prov = district_cov_layer.dataProvider()
    dc_prov.addAttributes(
        [
            QgsField("area_code", QMetaType.Type.QString),
            QgsField("district_name", QMetaType.Type.QString),
            QgsField("district_area_km2", QMetaType.Type.Double),
            QgsField("net_3km_pct", QMetaType.Type.Double),
            QgsField("net_5km_pct", QMetaType.Type.Double),
            QgsField("net_5km_gap", QMetaType.Type.Double),
            QgsField("euc_5km_pct", QMetaType.Type.Double),
            QgsField("dist_mako_m", QMetaType.Type.Double),
        ]
    )
    district_cov_layer.updateFields()

    district_rows: list[dict[str, Any]] = []
    dc_feats = []
    net3_geom = net_geom_by_thresh[3000]
    net5_geom = net_geom_by_thresh[5000]
    euc5_geom = euc_geom_by_thresh[5000]

    for feat in districts_utm.getFeatures():
        d_geom = feat.geometry()
        code = str(feat["area_code"])
        name = str(feat["district_name"])
        total_km2 = d_geom.area() / 1_000_000.0
        net3_km2 = d_geom.intersection(net3_geom).area() / 1_000_000.0
        net5_km2 = d_geom.intersection(net5_geom).area() / 1_000_000.0
        euc5_km2 = d_geom.intersection(euc5_geom).area() / 1_000_000.0
        centroid_dist_m = d_geom.centroid().distance(mako_pt_utm)

        row = compute_district_coverage_row(
            area_code=code,
            district_name=name,
            total_area_km2=total_km2,
            network_3km_km2=net3_km2,
            network_5km_km2=net5_km2,
            euclidean_5km_km2=euc5_km2,
            centroid_distance_m=centroid_dist_m,
        )
        district_rows.append(row)

        df = QgsFeature(district_cov_layer.fields())
        multi_g = QgsGeometry(d_geom)
        multi_g.convertToMultiType()
        df.setGeometry(multi_g)
        df.setAttributes(
            [
                row["area_code"],
                row["district_name"],
                row["district_area_km2"],
                row["network_3km_coverage_pct"],
                row["network_5km_coverage_pct"],
                row["network_5km_gap_ratio"],
                row["euclidean_5km_coverage_pct"],
                row["centroid_distance_m_mako"],
            ]
        )
        dc_feats.append(df)

    dc_prov.addFeatures(dc_feats)
    district_cov_layer.updateExtents()
    district_rows.sort(key=lambda r: r["area_code"])

    # D. Simpan seluruh layer kerja ke GeoPackage EPSG:32647
    out_gpkg_path.parent.mkdir(parents=True, exist_ok=True)
    if out_gpkg_path.exists():
        out_gpkg_path.unlink()

    layers_to_save = [
        ("mako_verified", mako_utm),
        ("euclidean_buffers_utm", euc_layer_utm),
        ("network_service_areas_utm", net_layer_utm),
        ("district_coverage_21_utm", district_cov_layer),
    ]
    if net_lines_5km_layer is not None:
        layers_to_save.append(("network_lines_5km_utm", net_lines_5km_layer))

    ctx = QgsProject.instance().transformContext()
    for idx, (layer_name, mem_layer) in enumerate(layers_to_save):
        opts = QgsVectorFileWriter.SaveVectorOptions()
        opts.driverName = "GPKG"
        opts.layerName = layer_name
        opts.fileEncoding = "UTF-8"
        if idx > 0:
            opts.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteLayer
        else:
            opts.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteFile
        err, msg, _, _ = QgsVectorFileWriter.writeAsVectorFormatV3(mem_layer, str(out_gpkg_path), ctx, opts)
        if err != QgsVectorFileWriter.NoError:
            raise RuntimeError(f"Gagal menulis layer {layer_name} ke GPKG: {msg}")

    # E. Reproyeksi poligon tampilan ke EPSG:4326 dan sederhanakan ringan untuk web JSON
    def _to_web_feature_collection(mem_layer: QgsVectorLayer, simplify_deg: float = 0.0) -> dict[str, Any]:
        reproj = processing.run(
            "native:reprojectlayer",
            {"INPUT": mem_layer, "TARGET_CRS": wgs84_crs, "OUTPUT": "memory:"},
        )["OUTPUT"]
        if simplify_deg > 0:
            reproj = processing.run(
                "native:simplifygeometries",
                {"INPUT": reproj, "METHOD": 0, "TOLERANCE": simplify_deg, "OUTPUT": "memory:"},
            )["OUTPUT"]
        field_names = [f.name() for f in reproj.fields()]
        feats = []
        for f in reproj.getFeatures():
            props = {k: f[k] for k in field_names}
            props["isDemo"] = False
            props["dataLabel"] = "PROVISIONAL"
            feats.append(
                {
                    "type": "Feature",
                    "properties": props,
                    "geometry": json.loads(f.geometry().asJson()),
                }
            )
        return {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
            "features": feats,
        }

    euc_web_fc = _to_web_feature_collection(euc_layer_utm, simplify_deg=0.0)
    net_web_fc = _to_web_feature_collection(net_layer_utm, simplify_deg=0.00015)

    city_total_km2 = round(sum(r["district_area_km2"] for r in district_rows), 4)
    total_net5_km2 = round(sum(r["network_5km_covered_km2"] for r in district_rows), 4)

    output_payload = {
        "isDemo": False,
        "dataLabel": "PROVISIONAL",
        "module": "station-coverage",
        "owner": "Adriel",
        "generated_at": date.today().isoformat(),
        "notice": (
            "ANALISIS JANGKAUAN PROVISIONAL (1 STASIUN TERVERIFIKASI): menggunakan jaringan jalan "
            "OpenStreetMap nyata dari Mako 0.0 (Jl. Candi Borobudur No. 2). Pos UPT Damkarmat lainnya "
            "belum terverifikasi karena pembatasan akses p2k.medan.go.id sehingga cakupan belum mewakili seluruh armada."
        ),
        "analysis": {
            "title": "Evaluasi Jangkauan Layanan Mako 0.0 Damkarmat Medan (Euclidean vs Jaringan Jalan OSM)",
            "status": "provisional_single_station",
            "method_type": "euclidean_vs_network_service_area",
            "working_crs": REQUIRED_WORKING_CRS,
            "output_crs": REQUIRED_OUTPUT_CRS,
            "thresholds_meters": list(sorted(thresholds_m)),
            "assumed_speed_kmh": float(assumed_speed_kmh),
            "station_count_verified": len(accepted_stations),
            "upt_verified_count": 0,
            "city_area_km2": city_total_km2,
            "network_5km_city_coverage_pct": round((total_net5_km2 / city_total_km2) * 100.0, 2) if city_total_km2 > 0 else 0.0,
            "disclaimer": (
                "Estimasi waktu tempuh (menit) dihitung secara teoretis dari jarak jaringan jalan pada kecepatan "
                f"asumsi {int(assumed_speed_kmh)} km/jam (bukan waktu respons operasional aktual Damkarmat). "
                "Analisis baru mencakup 1 pos terverifikasi (Mako 0.0) dan belum mencakup pos UPT lainnya."
            ),
        },
        "road_network": {
            "source_name": roads_meta["source_name"],
            "source_url": roads_meta["source_url"],
            "extract_date": roads_meta["extract_date"],
            "attribution": roads_meta["attribution"],
            "license": roads_meta["license"],
            "working_crs": roads_meta["working_crs"],
            "segment_count": roads_meta["segment_count"],
            "total_length_km": roads_meta["total_length_km"],
            "excluded_restricted_segments": roads_meta["excluded_restricted_segments"],
            "oneway_breakdown": roads_meta["oneway_breakdown"],
        },
        "stations": accepted_stations,
        "threshold_comparison": summary_by_threshold,
        "euclidean_buffers": euc_web_fc,
        "network_service_areas": net_web_fc,
        "district_coverage": district_rows,
    }

    contract_check = validate_station_coverage_output(output_payload)
    if not contract_check["valid"]:
        raise RuntimeError(
            "Output station-coverage gagal validasi kontrak: " + "; ".join(contract_check["errors"])
        )

    out_json_path.parent.mkdir(parents=True, exist_ok=True)
    out_json_path.write_text(json.dumps(output_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"Selesai station-coverage: {len(accepted_stations)} stasiun terverifikasi, "
        f"21 kecamatan dihitung, GPKG={out_gpkg_path.name}, JSON={out_json_path.name}."
    )
    return output_payload


def run_pipeline() -> dict[str, Any]:
    from qgis.core import QgsApplication, QgsProject

    summary_path = REPO_ROOT / "public" / "data" / "fire_incidents_summary.json"
    boundary_path = REPO_ROOT / "public" / "data" / "medan_districts_osm.geojson"
    roads_gpkg_path = REPO_ROOT / "data" / "interim" / "medan_roads_utm.gpkg"
    roads_meta_path = REPO_ROOT / "data" / "interim" / "medan_roads_meta.json"
    out_json_path = REPO_ROOT / "public" / "data" / "station-coverage.provisional.json"
    out_gpkg_path = _SCRIPT_DIR / "layers" / "station_coverage_analysis.gpkg"

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

    caught_exc = None
    result = None
    try:
        result = _execute_coverage(
            summary_path=summary_path,
            boundary_path=boundary_path,
            roads_gpkg_path=roads_gpkg_path,
            roads_meta_path=roads_meta_path,
            out_json_path=out_json_path,
            out_gpkg_path=out_gpkg_path,
        )
    except Exception as exc:
        caught_exc = RuntimeError(str(exc))
    finally:
        QgsProject.instance().clear()
        gc.collect()
        if owns_qgis_app:
            Processing.deinitialize()
            if qgs is not None:
                qgs.exitQgis()
    if caught_exc is not None:
        raise caught_exc
    return result


if __name__ == "__main__":
    run_pipeline()
