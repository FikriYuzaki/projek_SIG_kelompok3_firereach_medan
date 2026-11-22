"""
Ekstraksi jaringan jalan Kota Medan (+ buffer ~3 km) dari Geofabrik Sumatra OSM PBF.

Dijalankan menggunakan Python QGIS (`python-qgis-ltr.bat`):
1. Memotong layer `lines` pada kotak batas Kota Medan + buffer 3 km (lon 98.56..98.78, lat 3.45..3.83).
2. Menyaring hanya kelas `highway` yang dapat dilalui kendaraan pemadam kebakaran.
3. Mengecualikan segmen dengan tag `access=private/no` atau `motor_vehicle=private/no`.
4. Menurunkan kolom arah `oneway_dir` ('F', 'B', 'BOTH') dari `other_tags`.
5. Mereproyeksikan jaringan jalan ke `EPSG:32647` ke `data/interim/medan_roads_utm.gpkg`
   serta subset jalan utama ke `qgis/station-coverage/layers/medan_main_roads_utm.gpkg`.
"""

from __future__ import annotations

from datetime import date
import hashlib
import json
from pathlib import Path
import re
import tempfile

from osgeo import gdal, ogr, osr

gdal.UseExceptions()

REPO_ROOT = Path(__file__).resolve().parents[2]
PBF_PATH = REPO_ROOT / "data" / "raw" / "osm-geofabrik" / "sumatra-latest.osm.pbf"
OUT_FULL_GPKG = REPO_ROOT / "data" / "interim" / "medan_roads_utm.gpkg"
OUT_META_JSON = REPO_ROOT / "data" / "interim" / "medan_roads_meta.json"
OUT_MAIN_GPKG = Path(__file__).resolve().parent / "layers" / "medan_main_roads_utm.gpkg"

MEDAN_CLIP_BBOX_WGS84 = (98.56, 3.45, 98.78, 3.83)
DRIVABLE_HIGHWAYS = (
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
MAIN_ROAD_HIGHWAYS = {
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
}

_HSTORE_PAIR_RE = re.compile(r'"([^"]+)"=>"([^"]*)"')


def _parse_other_tags(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    return {m.group(1).strip().lower(): m.group(2).strip().lower() for m in _HSTORE_PAIR_RE.finditer(raw)}


def _compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_roads() -> dict:
    if not PBF_PATH.exists():
        raise RuntimeError(f"Berkas OSM PBF tidak ditemukan: {PBF_PATH}")

    OUT_FULL_GPKG.parent.mkdir(parents=True, exist_ok=True)
    OUT_MAIN_GPKG.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        raw_clipped_gpkg = Path(tmp_dir) / "medan_roads_raw_utm.gpkg"
        hw_sql = ", ".join(f"'{h}'" for h in DRIVABLE_HIGHWAYS)
        options = gdal.VectorTranslateOptions(
            format="GPKG",
            layers=["lines"],
            spatFilter=list(MEDAN_CLIP_BBOX_WGS84),
            where=f"highway IN ({hw_sql})",
            dstSRS="EPSG:32647",
            reproject=True,
            geometryType="LINESTRING",
            layerName="roads",
        )
        res_ds = gdal.VectorTranslate(str(raw_clipped_gpkg), str(PBF_PATH), options=options)
        if res_ds is None:
            raise RuntimeError("gdal.VectorTranslate gagal mengekstrak jalan dari PBF.")
        res_ds = None

        src_ds = ogr.Open(str(raw_clipped_gpkg), 0)
        src_layer = src_ds.GetLayer("roads")

        drv = ogr.GetDriverByName("GPKG")
        for target_path in (OUT_FULL_GPKG, OUT_MAIN_GPKG):
            if target_path.exists():
                drv.DeleteDataSource(str(target_path))

        utm_srs = osr.SpatialReference()
        utm_srs.ImportFromEPSG(32647)

        full_ds = drv.CreateDataSource(str(OUT_FULL_GPKG))
        full_layer = full_ds.CreateLayer("medan_roads_utm", srs=utm_srs, geom_type=ogr.wkbLineString)
        main_ds = drv.CreateDataSource(str(OUT_MAIN_GPKG))
        main_layer = main_ds.CreateLayer("medan_main_roads_utm", srs=utm_srs, geom_type=ogr.wkbLineString)

        field_defs = [
            ("osm_id", ogr.OFTString),
            ("name", ogr.OFTString),
            ("highway", ogr.OFTString),
            ("oneway_dir", ogr.OFTString),
            ("length_m", ogr.OFTReal),
        ]
        for fname, ftype in field_defs:
            full_layer.CreateField(ogr.FieldDefn(fname, ftype))
            main_layer.CreateField(ogr.FieldDefn(fname, ftype))

        full_defn = full_layer.GetLayerDefn()
        main_defn = main_layer.GetLayerDefn()

        class_counts: dict[str, int] = {}
        oneway_counts = {"F": 0, "B": 0, "BOTH": 0}
        excluded_restricted = 0
        kept_segments = 0
        main_segments = 0
        total_length_m = 0.0

        full_layer.StartTransaction()
        main_layer.StartTransaction()
        try:
            for feat in src_layer:
                geom = feat.GetGeometryRef()
                if geom is None or geom.IsEmpty():
                    continue
                tags = _parse_other_tags(feat.GetField("other_tags"))
                if tags.get("access") in ("private", "no") or tags.get("motor_vehicle") in ("private", "no"):
                    excluded_restricted += 1
                    continue

                hw = str(feat.GetField("highway") or "").strip().lower()
                if hw not in DRIVABLE_HIGHWAYS:
                    continue

                oneway_val = tags.get("oneway", "")
                if oneway_val in ("yes", "1", "true"):
                    direction = "F"
                elif oneway_val == "-1":
                    direction = "B"
                else:
                    direction = "BOTH"

                length_m = float(geom.Length())
                if length_m <= 0.1:
                    continue

                osm_id = str(feat.GetField("osm_id") or "")
                road_name = str(feat.GetField("name") or "")

                out_feat = ogr.Feature(full_defn)
                out_feat.SetGeometry(geom)
                out_feat.SetField("osm_id", osm_id)
                out_feat.SetField("name", road_name)
                out_feat.SetField("highway", hw)
                out_feat.SetField("oneway_dir", direction)
                out_feat.SetField("length_m", round(length_m, 2))
                full_layer.CreateFeature(out_feat)

                if hw in MAIN_ROAD_HIGHWAYS:
                    m_feat = ogr.Feature(main_defn)
                    m_feat.SetGeometry(geom)
                    m_feat.SetField("osm_id", osm_id)
                    m_feat.SetField("name", road_name)
                    m_feat.SetField("highway", hw)
                    m_feat.SetField("oneway_dir", direction)
                    m_feat.SetField("length_m", round(length_m, 2))
                    main_layer.CreateFeature(m_feat)
                    main_segments += 1

                kept_segments += 1
                total_length_m += length_m
                class_counts[hw] = class_counts.get(hw, 0) + 1
                oneway_counts[direction] += 1

            full_layer.CommitTransaction()
            main_layer.CommitTransaction()
        finally:
            full_ds = None
            main_ds = None
            src_ds = None

    pbf_stat = PBF_PATH.stat()
    meta = {
        "source_name": "Geofabrik Sumatra OpenStreetMap PBF",
        "source_url": "https://download.geofabrik.de/asia/indonesia/sumatra/sumatra-latest.osm.pbf",
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0",
        "extract_date": date.today().isoformat(),
        "pbf_size_bytes": pbf_stat.st_size,
        "pbf_sha256": _compute_sha256(PBF_PATH),
        "clip_bbox_wgs84": list(MEDAN_CLIP_BBOX_WGS84),
        "working_crs": "EPSG:32647",
        "segment_count": kept_segments,
        "main_road_segment_count": main_segments,
        "excluded_restricted_segments": excluded_restricted,
        "total_length_km": round(total_length_m / 1000.0, 2),
        "oneway_breakdown": oneway_counts,
        "highway_class_counts": dict(sorted(class_counts.items())),
        "output_full_gpkg": "data/interim/medan_roads_utm.gpkg",
        "output_main_gpkg": "qgis/station-coverage/layers/medan_main_roads_utm.gpkg",
    }
    OUT_META_JSON.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(
        f"Ekstraksi jaringan jalan selesai: {kept_segments} segmen ({meta['total_length_km']} km), "
        f"{excluded_restricted} segmen private/restricted dikecualikan."
    )
    return meta


if __name__ == "__main__":
    extract_roads()
