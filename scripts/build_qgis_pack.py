"""
Build and validate the portable FireReach_Medan_QGIS_Pack.zip archive.

Packages the three finalized QGIS Desktop projects (`hotspot-analysis`,
`station-coverage`, `priority-analysis`) together with `README_QGIS.md` using
only required `.qgz`, `layers/`, `styles/`, and `exports/` assets (no raw PBF,
no `__pycache__`, no temporary files). Then extracts the zip to a temporary
directory outside the repo and validates all 3 projects via PyQGIS:
  - project loads cleanly (`QgsProject.read`)
  - zero missing/invalid layers (`layer.isValid()`)
  - zero absolute machine paths in `.qgs` XML
  - project CRS == `EPSG:32647`
  - all layer features pass geometry validity (`isGeosValid()`) and Medan extent
  - Print Layout exists and exports cleanly to PNG

Run with QGIS Python:
  "C:/Program Files/QGIS 3.44.13/bin/python-qgis-ltr.bat" scripts/build_qgis_pack.py
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import tempfile
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[1]
QGIS_DIR = REPO_ROOT / "qgis"
ZIP_PATH = REPO_ROOT / "FireReach_Medan_QGIS_Pack.zip"
PACK_ROOT_NAME = "FireReach_Medan_QGIS_Pack"

PROJECTS = [
    ("hotspot-analysis", "medan_hotspot_template.qgz"),
    ("station-coverage", "station_coverage.qgz"),
    ("priority-analysis", "priority_analysis.qgz"),
]

ALLOWED_SUBDIRS = ("layers", "styles", "exports")
MEDAN_WGS_EXTENT = (98.50, 3.40, 98.85, 3.90)
MEDAN_UTM_EXTENT = (440000.0, 370000.0, 485000.0, 435000.0)


def build_zip() -> list[str]:
    files_added: list[str] = []
    readme_src = QGIS_DIR / "README_QGIS.md"
    if not readme_src.exists():
        raise RuntimeError(f"Missing {readme_src}")

    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        arc_readme = f"{PACK_ROOT_NAME}/README_QGIS.md"
        zf.write(readme_src, arc_readme)
        files_added.append(arc_readme)

        for folder, qgz_name in PROJECTS:
            proj_dir = QGIS_DIR / folder
            qgz_path = proj_dir / qgz_name
            if not qgz_path.exists():
                raise RuntimeError(f"Missing project file: {qgz_path}")
            arc_qgz = f"{PACK_ROOT_NAME}/{folder}/{qgz_name}"
            zf.write(qgz_path, arc_qgz)
            files_added.append(arc_qgz)

            for sub in ALLOWED_SUBDIRS:
                sub_dir = proj_dir / sub
                if not sub_dir.is_dir():
                    continue
                for item in sorted(sub_dir.rglob("*")):
                    if item.is_file() and "__pycache__" not in item.parts and not item.name.endswith(".tmp"):
                        rel = item.relative_to(proj_dir).as_posix()
                        arc = f"{PACK_ROOT_NAME}/{folder}/{rel}"
                        zf.write(item, arc)
                        files_added.append(arc)

    return files_added


def validate_pack() -> dict:
    from qgis.core import QgsApplication, QgsLayoutExporter, QgsProject

    if not ZIP_PATH.exists():
        raise RuntimeError(f"Missing zip pack: {ZIP_PATH}")

    report: dict = {"zip_path": str(ZIP_PATH), "zip_size_bytes": ZIP_PATH.stat().st_size, "projects": {}}

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        with zipfile.ZipFile(ZIP_PATH, "r") as zf:
            names = zf.namelist()
            if any("sumatra-latest.osm.pbf" in n or "__pycache__" in n for n in names):
                raise RuntimeError("Forbidden raw PBF or cache detected in QGIS zip pack")
            zf.extractall(tmp_path)

        pack_dir = tmp_path / PACK_ROOT_NAME
        assert (pack_dir / "README_QGIS.md").exists(), "Missing README_QGIS.md in extracted pack"

        qgs = QgsApplication([], False)
        qgs.initQgis()
        try:
            for folder, qgz_name in PROJECTS:
                qgz_extracted = pack_dir / folder / qgz_name
                assert qgz_extracted.exists(), f"Missing extracted {qgz_extracted}"

                with zipfile.ZipFile(qgz_extracted, "r") as zf_qgz:
                    qgs_entry = next((n for n in zf_qgz.namelist() if n.endswith(".qgs")), None)
                    assert qgs_entry, f"No .qgs inside {qgz_name}"
                    xml_text = zf_qgz.read(qgs_entry).decode("utf-8", errors="replace")
                    assert "C:\\" not in xml_text and "C:/" not in xml_text and "firereach-medan" not in xml_text, (
                        f"Absolute path found in {qgz_name}"
                    )

                proj = QgsProject.instance()
                proj.clear()
                ok = proj.read(str(qgz_extracted))
                assert ok, f"QgsProject.read failed for {qgz_extracted}"
                assert proj.crs().authid() == "EPSG:32647", f"Wrong project CRS for {qgz_name}: {proj.crs().authid()}"

                layers_info = []
                for lyr in proj.mapLayers().values():
                    assert lyr.isValid(), f"Invalid layer in {qgz_name}: {lyr.name()} ({lyr.source()})"
                    crs_id = lyr.crs().authid()
                    assert crs_id in ("EPSG:32647", "EPSG:4326"), f"Unexpected layer CRS {crs_id} on {lyr.name()}"

                    feat_count = 0
                    invalid_geom_count = 0
                    for feat in lyr.getFeatures():
                        feat_count += 1
                        g = feat.geometry()
                        if g is None or g.isNull() or g.isEmpty() or not g.isGeosValid():
                            invalid_geom_count += 1
                    assert invalid_geom_count == 0, f"Invalid geometries in {qgz_name}/{lyr.name()}: {invalid_geom_count}"

                    ext = lyr.extent()
                    if crs_id == "EPSG:4326":
                        assert (
                            ext.xMinimum() >= MEDAN_WGS_EXTENT[0]
                            and ext.xMaximum() <= MEDAN_WGS_EXTENT[2]
                            and ext.yMinimum() >= MEDAN_WGS_EXTENT[1]
                            and ext.yMaximum() <= MEDAN_WGS_EXTENT[3]
                        ), f"Extent out of Kota Medan (WGS84) in {qgz_name}/{lyr.name()}: {ext.toString()}"
                    else:
                        assert (
                            ext.xMinimum() >= MEDAN_UTM_EXTENT[0]
                            and ext.xMaximum() <= MEDAN_UTM_EXTENT[2]
                            and ext.yMinimum() >= MEDAN_UTM_EXTENT[1]
                            and ext.yMaximum() <= MEDAN_UTM_EXTENT[3]
                        ), f"Extent out of Kota Medan (UTM47N) in {qgz_name}/{lyr.name()}: {ext.toString()}"

                    layers_info.append(
                        {
                            "name": lyr.name(),
                            "crs": crs_id,
                            "feature_count": feat_count,
                            "source": lyr.source().replace(str(pack_dir), "."),
                        }
                    )

                layouts = proj.layoutManager().printLayouts()
                assert len(layouts) >= 1, f"No Print Layout in {qgz_name}"
                layout_names = [ly.name() for ly in layouts]
                out_png = tmp_path / f"verify_{folder}.png"
                exporter = QgsLayoutExporter(layouts[0])
                settings = QgsLayoutExporter.ImageExportSettings()
                settings.dpi = 100
                res = exporter.exportToImage(str(out_png), settings)
                assert res == QgsLayoutExporter.Success and out_png.exists() and out_png.stat().st_size > 10000, (
                    f"Print Layout export failed for {qgz_name}: {res}"
                )

                report["projects"][qgz_name] = {
                    "crs": proj.crs().authid(),
                    "layer_count": len(layers_info),
                    "layers": layers_info,
                    "layouts": layout_names,
                    "layout_export_bytes": out_png.stat().st_size,
                    "absolute_paths": False,
                }
                proj.clear()
        finally:
            qgs.exitQgis()

    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true", help="Only validate existing FireReach_Medan_QGIS_Pack.zip")
    args = parser.parse_args()

    if not args.verify_only:
        added = build_zip()
        print(f"Built {ZIP_PATH.name} with {len(added)} entries ({ZIP_PATH.stat().st_size} bytes).")

    rep = validate_pack()
    for qgz_name, info in rep["projects"].items():
        print(
            f"VALIDATED {qgz_name}: CRS={info['crs']}, layers={info['layer_count']}, "
            f"layouts={info['layouts']}, export_png={info['layout_export_bytes']} bytes, abs_paths={info['absolute_paths']}"
        )
    print("FireReach_Medan_QGIS_Pack.zip validation PASS.")


if __name__ == "__main__":
    main()
