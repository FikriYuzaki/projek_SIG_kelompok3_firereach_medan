"""
Reproducible PyQGIS Pipeline: Fire Hotspot Kernel Density Estimation (KDE) Kota Medan
Penanggung Jawab: Adeptri (modul hotspot-analyzer)

Catatan:
- Skrip ini dijalankan di lingkungan QGIS Python (qgis.core + processing + gdal + numpy)
  setelah dataset titik kebakaran individual terverifikasi resmi tersedia.
- Dilarang menggunakan data DEMO, approximate, district_only, unknown, atau koordinat sintetik.
- Batas default menggunakan fallback OpenStreetMap (ODbL, bukan batas resmi Pemko Medan).
"""

from __future__ import annotations

import argparse
from datetime import date
import gc
import json
from pathlib import Path
import sys
import tempfile
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from kde_core import (  # noqa: E402
    DENSITY_TIERS,
    compute_quantile_classification,
    validate_boundary_geojson,
    validate_kde_input_features,
    validate_verified_hotspot_output,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Jalankan pipeline KDE kebakaran Kota Medan di QGIS (Quantile 4 kelas)."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path file input titik kebakaran terverifikasi (GeoJSON/GPKG/SHP).",
    )
    parser.add_argument(
        "--boundary",
        default="public/data/medan_districts_osm.geojson",
        help="Path GeoJSON batas Kota Medan (wajib valid; default fallback OSM).",
    )
    parser.add_argument(
        "--config",
        default="qgis/hotspot-analysis/kde_pipeline_config.json",
        help="Path konfigurasi parameter KDE.",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path output GeoJSON FeatureCollection poligon hotspot (EPSG:4326).",
    )
    parser.add_argument(
        "--period",
        default="2023-2025",
        help="Label periode analisis.",
    )
    parser.add_argument(
        "--source",
        default="Dinas Pemadam Kebakaran dan Penyelamatan Kota Medan (Titik Terverifikasi)",
        help="Atribusi sumber data kejadian terverifikasi.",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Opsional: tulis ringkasan validasi input dan threshold Quantile ke file JSON.",
    )
    parser.add_argument(
        "--update-manifest",
        default=None,
        help="Opsional: path public/data/manifest.json untuk menandai verified output tersedia.",
    )
    parser.add_argument(
        "--mode",
        choices=("strict", "exploratory"),
        default="strict",
        help="Mode validasi input: 'strict' (titik resmi terverifikasi) atau 'exploratory' (insiden publik berkoordinat jalan OSM).",
    )
    parser.add_argument(
        "--bandwidth",
        type=float,
        default=None,
        help="Opsional: override bandwidth radius KDE dalam meter (EPSG:32647).",
    )
    parser.add_argument(
        "--excluded-count",
        type=int,
        default=0,
        help="Jumlah laporan kecamatan-saja (tanpa titik layak KDE) yang dikecualikan di luar berkas titik input.",
    )
    return parser.parse_args(argv)


def _load_json_file(path: Path, label: str) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"Berkas {label} tidak ditemukan: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Berkas {label} bukan JSON valid ({path}): {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Berkas {label} harus berupa objek JSON ({path}).")
    return data


def _read_raw_input_features(input_path: Path, ogr_layer: Any, target_crs_wgs84: Any) -> tuple[list[dict[str, Any]], str]:
    """
    Membaca record input dan mentransformasikan koordinat ke EPSG:4326 jika CRS sumber berbeda.
    Untuk GeoJSON/JSON, mempertahankan struktur asli (termasuk isDemo, geometry non-Point, NaN)
    agar ditolak secara eksplisit oleh validate_kde_input_features tanpa koersi diam-diam OGR.
    """
    from qgis.core import QgsCoordinateTransform, QgsPointXY, QgsProject

    layer_crs = ogr_layer.crs()
    if not layer_crs.isValid():
        raise RuntimeError("CRS layer input tidak valid atau tidak terdefinisi.")
    detected_crs = layer_crs.authid() or layer_crs.toWkt()[:80]
    needs_transform = layer_crs != target_crs_wgs84
    transformer = QgsCoordinateTransform(layer_crs, target_crs_wgs84, QgsProject.instance()) if needs_transform else None

    if input_path.suffix.lower() in (".geojson", ".json"):
        raw_doc = _load_json_file(input_path, "input titik")
        raw_features = raw_doc.get("features") if raw_doc.get("type") == "FeatureCollection" else [raw_doc]
        if not isinstance(raw_features, list):
            raise RuntimeError("Berkas GeoJSON input tidak memiliki array 'features' yang valid.")

        crs_name = ""
        if isinstance(raw_doc.get("crs"), dict):
            crs_name = str(raw_doc["crs"].get("properties", {}).get("name") or "")
        if crs_name and "4326" not in crs_name and needs_transform and transformer is not None:
            detected_crs = crs_name

        if not needs_transform:
            return raw_features, detected_crs

        transformed_features: list[dict[str, Any]] = []
        for item in raw_features:
            if not isinstance(item, dict):
                transformed_features.append(item)
                continue
            geom = item.get("geometry")
            if (
                isinstance(geom, dict)
                and geom.get("type") == "Point"
                and isinstance(geom.get("coordinates"), list)
                and len(geom["coordinates"]) >= 2
            ):
                x_raw, y_raw = geom["coordinates"][0], geom["coordinates"][1]
                if isinstance(x_raw, (int, float)) and isinstance(y_raw, (int, float)) and not isinstance(x_raw, bool) and not isinstance(y_raw, bool):
                    try:
                        pt_wgs = transformer.transform(QgsPointXY(float(x_raw), float(y_raw)))
                        copied = dict(item)
                        copied["geometry"] = {"type": "Point", "coordinates": [pt_wgs.x(), pt_wgs.y()]}
                        transformed_features.append(copied)
                        continue
                    except Exception:
                        pass
            transformed_features.append(item)
        return transformed_features, detected_crs

    # Sumber non-GeoJSON (mis. GPKG/SHP) dibaca lewat OGR lalu dikonversi ke GeoJSON Feature EPSG:4326
    extracted: list[dict[str, Any]] = []
    field_names = [field.name() for field in ogr_layer.fields()]
    for feat in ogr_layer.getFeatures():
        props = {name: feat[name] for name in field_names}
        geom = feat.geometry()
        geom_obj = None
        if geom and not geom.isNull():
            geom_copy = geom
            if needs_transform and transformer is not None:
                geom_copy = feat.geometry()
                geom_copy.transform(transformer)
            try:
                geom_obj = json.loads(geom_copy.asJson())
            except Exception:
                geom_obj = None
        extracted.append({"type": "Feature", "properties": props, "geometry": geom_obj})
    return extracted, detected_crs


def _execute_pipeline_with_qgis(
    args: argparse.Namespace,
    config: dict[str, Any],
    boundary_geojson: dict[str, Any],
) -> dict[str, Any]:
    from osgeo import gdal
    import numpy as np
    from qgis.core import (
        QgsCoordinateReferenceSystem,
        QgsFeature,
        QgsFeatureRequest,
        QgsField,
        QgsGeometry,
        QgsPointXY,
        QgsProject,
        QgsVectorLayer,
    )
    from qgis.PyQt.QtCore import QMetaType
    import processing

    gdal.UseExceptions()

    input_path = Path(args.input)
    boundary_path = Path(args.boundary)
    out_path = Path(args.output)

    if not input_path.exists():
        raise RuntimeError(f"Berkas input titik tidak ditemukan: {input_path}")

    raw_points = QgsVectorLayer(str(input_path), "raw_incidents", "ogr")
    boundary_layer = QgsVectorLayer(str(boundary_path), "medan_boundary", "ogr")
    if not raw_points.isValid():
        raise RuntimeError(f"Layer input tidak dapat dibuka oleh QGIS/OGR: {input_path}")
    if not boundary_layer.isValid() or boundary_layer.featureCount() == 0:
        raise RuntimeError(f"Layer boundary Kota Medan tidak valid atau kosong: {boundary_path}")
    if not boundary_layer.crs().isValid():
        raise RuntimeError("CRS layer boundary tidak valid.")

    for b_feat in boundary_layer.getFeatures():
        b_geom = b_feat.geometry()
        if not b_geom or b_geom.isNull() or not b_geom.isGeosValid():
            raise RuntimeError("Geometri poligon pada layer boundary tidak valid secara topologi (GEOS).")

    wgs84_crs = QgsCoordinateReferenceSystem(config["crs"]["input"])
    working_crs = QgsCoordinateReferenceSystem(config["crs"]["working_metric"])
    output_crs = QgsCoordinateReferenceSystem(config["crs"]["output_web"])

    # 1. Baca dan validasi seluruh fitur input secara eksplisit (termasuk CRS)
    raw_features, detected_input_crs = _read_raw_input_features(input_path, raw_points, wgs84_crs)
    validation_result = validate_kde_input_features(raw_features, boundary_geojson, mode=args.mode)
    validation_summary = validation_result["summary"]
    validation_summary["input_crs_detected"] = detected_input_crs
    accepted_features = validation_result["accepted"]

    print(
        f"[Validasi Input KDE] total={validation_summary['total_input']}, "
        f"diterima={validation_summary['accepted_count']}, "
        f"ditolak={validation_summary['rejected_count']}, "
        f"alasan={json.dumps(validation_summary['rejection_reasons'], ensure_ascii=False)}"
    )

    if not accepted_features:
        raise RuntimeError(
            "Tidak ada titik kebakaran terverifikasi yang lolos validasi KDE. "
            f"Ringkasan penolakan: {json.dumps(validation_summary, ensure_ascii=False)}"
        )

    # 2. Bangun layer memori bersih hanya dari fitur yang lolos validasi
    validated_layer = QgsVectorLayer("Point?crs=EPSG:4326", "validated_incidents", "memory")
    provider = validated_layer.dataProvider()
    provider.addAttributes(
        [
            QgsField("incident_id", QMetaType.Type.QString),
            QgsField("incident_date", QMetaType.Type.QString),
            QgsField("location_accuracy", QMetaType.Type.QString),
        ]
    )
    validated_layer.updateFields()

    qgs_features = []
    for feat in accepted_features:
        lon, lat = feat["geometry"]["coordinates"]
        qf = QgsFeature(validated_layer.fields())
        qf.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(lon, lat)))
        qf.setAttributes(
            [
                feat["properties"]["incident_id"],
                feat["properties"]["incident_date"],
                feat["properties"]["location_accuracy"],
            ]
        )
        qgs_features.append(qf)
    provider.addFeatures(qgs_features)
    validated_layer.updateExtents()

    # 3. Reproyeksi titik tervalidasi & boundary ke CRS metrik EPSG:32647
    points_utm = processing.run(
        "native:reprojectlayer",
        {"INPUT": validated_layer, "TARGET_CRS": working_crs, "OUTPUT": "memory:"},
    )["OUTPUT"]

    boundary_utm = processing.run(
        "native:reprojectlayer",
        {"INPUT": boundary_layer, "TARGET_CRS": working_crs, "OUTPUT": "memory:"},
    )["OUTPUT"]

    kde_params = dict(config["kde_parameters"])
    if args.bandwidth is not None and args.bandwidth > 0:
        kde_params["bandwidth_meters"] = float(args.bandwidth)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        boundary_utm_gpkg = tmp / "boundary_utm.gpkg"
        kde_raw_path = tmp / "kde_raw_utm.tif"
        kde_clipped_path = tmp / "kde_clipped_utm.tif"
        kde_reclass_path = tmp / "kde_quantile_utm.tif"

        boundary_utm_multi = processing.run(
            "native:promotetomulti",
            {"INPUT": boundary_utm, "OUTPUT": "memory:"},
        )["OUTPUT"]
        processing.run(
            "native:savefeatures",
            {"INPUT": boundary_utm_multi, "OUTPUT": str(boundary_utm_gpkg)},
        )

        # 4. Jalankan Kernel Density Estimation (Quartic, bandwidth 1000m, piksel 100m)
        processing.run(
            "qgis:heatmapkerneldensityestimation",
            {
                "INPUT": points_utm,
                "RADIUS": float(kde_params["bandwidth_meters"]),
                "PIXEL_SIZE": float(kde_params["pixel_size_meters"]),
                "KERNEL": int(kde_params["kernel_code"]),
                "DECAY": 0,
                "OUTPUT_VALUE": 0,
                "OUTPUT": str(kde_raw_path),
            },
        )

        # 5. Klip raster KDE ke batas administrasi Kota Medan sebelum menghitung Quantile
        processing.run(
            "gdal:cliprasterbymasklayer",
            {
                "INPUT": str(kde_raw_path),
                "MASK": str(boundary_utm_gpkg),
                "NODATA": -9999.0,
                "ALPHA_BAND": False,
                "CROP_TO_CUTLINE": True,
                "KEEP_RESOLUTION": True,
                "SET_RESOLUTION": False,
                "DATA_TYPE": 0,
                "OUTPUT": str(kde_clipped_path),
            },
        )

        # 6. Klasifikasi Quantile sebenarnya dari distribusi nilai raster aktual di dalam Medan
        ds = gdal.Open(str(kde_clipped_path), gdal.GA_ReadOnly)
        if ds is None:
            raise RuntimeError("Gagal membuka raster KDE hasil klip batas Kota Medan.")
        band = ds.GetRasterBand(1)
        band_nodata = band.GetNoDataValue()
        arr = band.ReadAsArray().astype(np.float64)
        geotransform = ds.GetGeoTransform()
        projection = ds.GetProjection()
        rows, cols = arr.shape
        ds = None

        classification = compute_quantile_classification(
            arr.ravel().tolist(),
            nodata=band_nodata,
            exclude_non_positive=True,
        )
        if classification["status"] == "empty" or classification["breaks"] is None:
            raise RuntimeError(
                "Klasifikasi Quantile gagal: tidak ada nilai raster KDE positif di dalam Kota Medan."
            )

        breaks = classification["breaks"]
        out_nodata = -9999
        reclass_arr = np.full((rows, cols), out_nodata, dtype=np.int16)

        valid_mask = np.isfinite(arr) & (arr > 0.0)
        if band_nodata is not None and np.isfinite(band_nodata):
            valid_mask &= ~np.isclose(arr, float(band_nodata), rtol=1e-9, atol=1e-9)

        if classification["status"] == "degenerate_constant":
            reclass_arr[valid_mask] = 1
        else:
            reclass_arr[valid_mask & (arr <= breaks["p25"])] = 1
            reclass_arr[valid_mask & (arr > breaks["p25"]) & (arr <= breaks["p50"])] = 2
            reclass_arr[valid_mask & (arr > breaks["p50"]) & (arr <= breaks["p75"])] = 3
            reclass_arr[valid_mask & (arr > breaks["p75"])] = 4

        driver = gdal.GetDriverByName("GTiff")
        out_ds = driver.Create(str(kde_reclass_path), cols, rows, 1, gdal.GDT_Int16)
        out_ds.SetGeoTransform(geotransform)
        out_ds.SetProjection(projection)
        out_band = out_ds.GetRasterBand(1)
        out_band.SetNoDataValue(out_nodata)
        out_band.WriteArray(reclass_arr)
        out_band.FlushCache()
        out_ds = None

        # 7. Polygonize, perbaiki geometri, klip batas Medan, dan hitung luas km2 di EPSG:32647
        polygonized = processing.run(
            "gdal:polygonize",
            {
                "INPUT": str(kde_reclass_path),
                "BAND": 1,
                "FIELD": "density_rank",
                "EIGHT_CONNECTEDNESS": False,
                "OUTPUT": "TEMPORARY_OUTPUT",
            },
        )["OUTPUT"]

        fixed_geom = processing.run(
            "native:fixgeometries",
            {"INPUT": polygonized, "OUTPUT": "memory:"},
        )["OUTPUT"]

        clipped_zones = processing.run(
            "native:clip",
            {"INPUT": fixed_geom, "OVERLAY": boundary_utm, "OUTPUT": "memory:"},
        )["OUTPUT"]

        with_area = processing.run(
            "native:fieldcalculator",
            {
                "INPUT": clipped_zones,
                "FIELD_NAME": "area_km2",
                "FIELD_TYPE": 0,
                "FIELD_LENGTH": 12,
                "FIELD_PRECISION": 4,
                "FORMULA": "round($area / 1000000.0, 4)",
                "OUTPUT": "memory:",
            },
        )["OUTPUT"]

        zones_wgs84 = processing.run(
            "native:reprojectlayer",
            {"INPUT": with_area, "TARGET_CRS": output_crs, "OUTPUT": "memory:"},
        )["OUTPUT"]

    is_exploratory = args.mode == "exploratory"
    data_label = "EKSPLORATIF_PUBLIK" if is_exploratory else "TERVERIFIKASI"
    total_excluded = int(args.excluded_count or 0) + int(validation_summary.get("rejected_count") or 0)

    # 8. Bungkus menjadi GeoJSON FeatureCollection resmi sesuai kontrak web
    features = []
    zone_counter = 0
    for feat in zones_wgs84.getFeatures(QgsFeatureRequest()):
        raw_rank = feat["density_rank"]
        if raw_rank is None:
            continue
        rank = int(raw_rank)
        if rank not in DENSITY_TIERS:
            continue
        area_km2 = float(feat["area_km2"] or 0.0)
        if area_km2 <= 0.0:
            continue
        geom = feat.geometry()
        if not geom or geom.isNull():
            continue
        geom_json = json.loads(geom.asJson())
        zone_counter += 1
        tier_info = DENSITY_TIERS[rank]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "isDemo": False,
                    "dataLabel": data_label,
                    "zone_id": f"hotspot-zone-{zone_counter}",
                    "density_class": tier_info["label"],
                    "density_rank": rank,
                    "area_km2": area_km2,
                },
                "geometry": geom_json,
            }
        )

    boundary_cfg = config.get("boundary", {})
    notice_text = (
        f"ANALISIS EKSPLORATIF BERBASIS {validation_summary['points_used_for_kde']} INSIDEN TERDOKUMENTASI PUBLIK: "
        f"titik di-geocode pada ruas jalan OSM ({total_excluded} laporan kecamatan-saja dikecualikan). "
        "Menunjukkan pola konsentrasi spasial laporan publik terdokumentasi di Kota Medan, bukan prediksi ataupun sensus kebakaran lengkap resmi."
        if is_exploratory
        else "Hasil analisis Kernel Density Estimation (KDE) historis berbasis titik kebakaran terverifikasi Kota Medan. Bukan prediksi kejadian masa depan."
    )
    output_payload = {
        "type": "FeatureCollection",
        "name": "medan_fire_hotspot_kde_exploratory" if is_exploratory else "medan_fire_hotspot_kde_verified",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "isDemo": False,
        "dataLabel": data_label,
        "module": "hotspot-analyzer",
        "owner": "Adeptri",
        "generated_at": date.today().isoformat(),
        "notice": notice_text,
        "analysis": {
            "title": (
                "KDE Eksploratif Insiden Terdokumentasi Publik Kota Medan"
                if is_exploratory
                else "KDE Kebakaran Kota Medan (Terverifikasi)"
            ),
            "analysis_mode": args.mode,
            "source": args.source,
            "boundary_source": boundary_cfg.get(
                "source", "OpenStreetMap Nominatim (Fallback Geoportal Medan)"
            ),
            "boundary_is_official": bool(boundary_cfg.get("is_official", False)),
            "boundary_attribution": boundary_cfg.get(
                "attribution", "© OpenStreetMap contributors"
            ),
            "period_label": args.period,
            "kernel_method": kde_params["kernel_shape"],
            "bandwidth_meters": kde_params["bandwidth_meters"],
            "pixel_size_meters": kde_params["pixel_size_meters"],
            "working_crs": config["crs"]["working_metric"],
            "output_crs": config["crs"]["output_web"],
            "classification_method": "Quantile (4 kelas)",
            "classification_details": classification,
            "incident_count_used": validation_summary["points_used_for_kde"],
            "excluded_count": total_excluded,
            "validation_summary": validation_summary,
        },
        "features": features,
    }

    contract_check = validate_verified_hotspot_output(output_payload)
    if not contract_check["valid"]:
        raise RuntimeError(
            "Output KDE gagal validasi kontrak web: " + "; ".join(contract_check["errors"])
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_payload = {
            "validation_summary": validation_summary,
            "classification": classification,
            "output_zone_count": len(features),
            "output_path": str(out_path),
        }
        report_path.write_text(json.dumps(report_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if args.update_manifest:
        manifest_path = Path(args.update_manifest)
        manifest_data = _load_json_file(manifest_path, "manifest web")
        verified_outputs = manifest_data.setdefault("verified_outputs", {})
        verified_outputs["hotspot-analyzer"] = {
            "available": True,
            "path": "/data/hotspot-analyzer.verified.geojson",
            "status": "verified",
            "period_label": args.period,
            "incident_count_used": validation_summary["points_used_for_kde"],
            "generated_at": output_payload["generated_at"],
        }
        manifest_path.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(
        f"Selesai: {len(features)} zona KDE Quantile tersimpan ke {out_path} "
        f"(breaks P25={breaks['p25']:.6f}, P50={breaks['p50']:.6f}, P75={breaks['p75']:.6f})"
    )
    QgsProject.instance().clear()
    return output_payload


def run_pipeline(argv: list[str] | None = None) -> dict[str, Any]:
    args = parse_args(argv)
    config = _load_json_file(Path(args.config), "konfigurasi KDE")
    boundary_geojson = _load_json_file(Path(args.boundary), "boundary administrasi")
    boundary_check = validate_boundary_geojson(boundary_geojson)
    if not boundary_check["valid"]:
        raise RuntimeError(
            "Validasi boundary gagal: " + "; ".join(boundary_check["errors"])
        )

    from qgis.core import QgsApplication, QgsProject

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
        return _execute_pipeline_with_qgis(args, config, boundary_geojson)
    finally:
        QgsProject.instance().clear()
        gc.collect()
        if owns_qgis_app:
            Processing.deinitialize()
            if qgs is not None:
                qgs.exitQgis()


if __name__ == "__main__":
    run_pipeline()
