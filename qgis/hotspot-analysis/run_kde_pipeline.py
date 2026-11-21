"""
Reproducible PyQGIS Pipeline — Fire Hotspot Kernel Density Estimation (KDE) Kota Medan
Penanggung Jawab: Adeptri (modul hotspot-analyzer)

Catatan:
- Skrip ini dijalankan di lingkungan QGIS Python (qgis.core + processing) HANYA setelah
  dataset titik kebakaran individual terverifikasi resmi tersedia.
- Dilarang menggunakan data DEMO, district_only, atau koordinat sintetik/karangan.
"""

import argparse
import json
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Jalankan pipeline KDE kebakaran Kota Medan di QGIS.")
    parser.add_argument("--input", required=True, help="Path file input titik kebakaran terverifikasi (EPSG:4326)")
    parser.add_argument("--boundary", default="public/data/medan_districts_osm.geojson", help="Path GeoJSON batas Kota Medan")
    parser.add_argument("--config", default="qgis/hotspot-analysis/kde_pipeline_config.json", help="Path konfigurasi parameter KDE")
    parser.add_argument("--output", required=True, help="Path output GeoJSON poligon hotspot (EPSG:4326)")
    parser.add_argument("--period", default="2023-2025", help="Label periode analisis")
    return parser.parse_args()


def run_pipeline():
    args = parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))

    from qgis.core import (
        QgsApplication,
        QgsCoordinateReferenceSystem,
        QgsFeatureRequest,
        QgsRasterBandStats,
        QgsRasterLayer,
        QgsVectorLayer,
    )
    import processing
    from processing.core.Processing import Processing

    qgs = QgsApplication([], False)
    qgs.initQgis()
    Processing.initialize()

    try:
        raw_points = QgsVectorLayer(args.input, "raw_incidents", "ogr")
        boundary_layer = QgsVectorLayer(args.boundary, "medan_boundary", "ogr")
        if not raw_points.isValid() or not boundary_layer.isValid():
            raise RuntimeError("Layer input titik atau batas administrasi Kota Medan tidak valid.")

        # 1. Filter ketat atribut: verified + exact_verified/address_geocoded_verified
        expr = (
            "\"verification_status\" = 'verified' AND "
            "\"location_accuracy\" IN ('exact_verified', 'address_geocoded_verified')"
        )
        raw_points.setSubsetString(expr)

        # 2. Point-in-Polygon: hanya simpan titik di dalam batas administrasi Kota Medan
        within_medan = processing.run(
            "native:extractbylocation",
            {
                "INPUT": raw_points,
                "PREDICATE": [0],
                "INTERSECT": boundary_layer,
                "OUTPUT": "memory:",
            },
        )["OUTPUT"]

        incident_count = within_medan.featureCount()
        if incident_count == 0:
            raise RuntimeError("Tidak ada titik kebakaran terverifikasi di dalam batas poligon Kota Medan.")

        working_crs = QgsCoordinateReferenceSystem(config["crs"]["working_metric"])
        output_crs = QgsCoordinateReferenceSystem(config["crs"]["output_web"])

        # 3. Reproyeksi titik & batas wilayah ke CRS metrik EPSG:32647
        points_utm = processing.run(
            "native:reprojectlayer",
            {"INPUT": within_medan, "TARGET_CRS": working_crs, "OUTPUT": "memory:"},
        )["OUTPUT"]

        boundary_utm = processing.run(
            "native:reprojectlayer",
            {"INPUT": boundary_layer, "TARGET_CRS": working_crs, "OUTPUT": "memory:"},
        )["OUTPUT"]

        # 4. Jalankan Heatmap (Kernel Density Estimation) dengan parameter standar
        kde_params = config["kde_parameters"]
        kde_raster = processing.run(
            "qgis:heatmapkerneldensityestimation",
            {
                "INPUT": points_utm,
                "RADIUS": float(kde_params["bandwidth_meters"]),
                "PIXEL_SIZE": float(kde_params["pixel_size_meters"]),
                "KERNEL": int(kde_params["kernel_code"]),
                "DECAY": 0,
                "OUTPUT_VALUE": 0,
                "OUTPUT": "TEMPORARY_OUTPUT",
            },
        )["OUTPUT"]

        # 5. Klasifikasi 4 kelas Quantile (1: Rendah, 2: Sedang, 3: Tinggi, 4: Sangat Tinggi)
        raster_layer = QgsRasterLayer(kde_raster, "kde_surface")
        stats = raster_layer.dataProvider().bandStatistics(1, QgsRasterBandStats.All)
        min_val = max(float(stats.minimumValue), 1e-9)
        max_val = float(stats.maximumValue)
        step = (max_val - min_val) / 4.0
        b1 = min_val + step
        b2 = min_val + 2.0 * step
        b3 = min_val + 3.0 * step

        reclass_table = [
            min_val, b1, 1,
            b1, b2, 2,
            b2, b3, 3,
            b3, max_val + 1.0, 4,
        ]

        reclassified = processing.run(
            "native:reclassifybytable",
            {
                "INPUT_RASTER": raster_layer,
                "RASTER_BAND": 1,
                "TABLE": reclass_table,
                "NO_DATA": -9999,
                "RANGE_BOUNDARIES": 0,
                "NODATA_FOR_MISSING": True,
                "DATA_TYPE": 1,
                "OUTPUT": "TEMPORARY_OUTPUT",
            },
        )["OUTPUT"]

        # 6. Polygonize, perbaiki geometri, dan klip sesuai poligon Kota Medan
        polygonized = processing.run(
            "gdal:polygonize",
            {
                "INPUT": reclassified,
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

        # 7. Hitung luas area_km2 pada CRS metrik EPSG:32647
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

        # 8. Reproyeksi ke EPSG:4326 dan bungkus sesuai kontrak JSON modul web
        zones_wgs84 = processing.run(
            "native:reprojectlayer",
            {"INPUT": with_area, "TARGET_CRS": output_crs, "OUTPUT": "memory:"},
        )["OUTPUT"]

        tier_labels = {1: "Rendah", 2: "Sedang", 3: "Tinggi", 4: "Sangat Tinggi"}
        features = []
        for idx, feat in enumerate(zones_wgs84.getFeatures(QgsFeatureRequest()), start=1):
            rank = int(feat["density_rank"] or 0)
            if rank not in tier_labels:
                continue
            geom_json = json.loads(feat.geometry().asJson())
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "isDemo": False,
                        "dataLabel": "TERVERIFIKASI",
                        "zone_id": f"hotspot-zone-{idx}",
                        "density_class": tier_labels[rank],
                        "density_rank": rank,
                        "area_km2": float(feat["area_km2"] or 0.0),
                    },
                    "geometry": geom_json,
                }
            )

        output_payload = {
            "isDemo": False,
            "dataLabel": "TERVERIFIKASI",
            "module": "hotspot-analyzer",
            "owner": "Adeptri",
            "notice": (
                "Hasil analisis Kernel Density Estimation (KDE) historis berbasis titik kebakaran "
                "terverifikasi Kota Medan. Bukan prediksi kejadian masa depan."
            ),
            "analysis": {
                "title": "KDE Kebakaran Kota Medan",
                "period_label": args.period,
                "kernel_method": kde_params["kernel_shape"],
                "bandwidth_meters": kde_params["bandwidth_meters"],
                "pixel_size_meters": kde_params["pixel_size_meters"],
                "working_crs": config["crs"]["working_metric"],
                "classification_method": "Quantile (4 kelas)",
                "incident_count_used": incident_count,
            },
            "zones": {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
                "features": features,
            },
        }

        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")
        print(f"Selesai: {len(features)} zona KDE tersimpan ke {out_path}")
    finally:
        qgs.exitQgis()


if __name__ == "__main__":
    run_pipeline()