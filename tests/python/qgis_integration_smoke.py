"""
Integration smoke test untuk pipeline PyQGIS (run_kde_pipeline.py) dan template .qgz.

Hanya dijalankan pada lingkungan dengan QGIS Python (`python-qgis-ltr.bat`).
Seluruh berkas uji dibuat di TemporaryDirectory sehingga tidak menulis data palsu ke repo.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[2]
HOTSPOT_QGIS_DIR = REPO_ROOT / "qgis" / "hotspot-analysis"
if str(HOTSPOT_QGIS_DIR) not in sys.path:
    sys.path.insert(0, str(HOTSPOT_QGIS_DIR))

from kde_core import validate_verified_hotspot_output  # noqa: E402


def run_smoke() -> None:
    boundary_path = REPO_ROOT / "public" / "data" / "medan_districts_osm.geojson"
    config_path = HOTSPOT_QGIS_DIR / "kde_pipeline_config.json"
    pipeline_script = HOTSPOT_QGIS_DIR / "run_kde_pipeline.py"
    qgz_path = HOTSPOT_QGIS_DIR / "medan_hotspot_template.qgz"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        input_path = tmp / "synthetic_smoke_points.geojson"
        output_path = tmp / "smoke_output.verified.geojson"
        report_path = tmp / "smoke_report.json"

        # Campuran titik uji sementara di dalam Kota Medan + record tidak valid yang harus ditolak
        sample_points = {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-01",
                        "incident_date": "2024-03-01",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                        "isDemo": False,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-02",
                        "incident_date": "2024-03-02",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                        "isDemo": False,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6730, 3.5910]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-03",
                        "incident_date": "2024-03-03",
                        "verification_status": "verified",
                        "location_accuracy": "address_geocoded_verified",
                        "isDemo": False,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6742, 3.5880]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-04",
                        "incident_date": "2024-04-10",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                        "isDemo": False,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6850, 3.5550]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-05",
                        "incident_date": "2024-05-12",
                        "verification_status": "verified",
                        "location_accuracy": "address_geocoded_verified",
                        "isDemo": False,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6696, 3.6639]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-06",
                        "incident_date": "2024-06-20",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                        "isDemo": False,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6800, 3.7700]},
                },
                # Record ditolak: DEMO, duplicate ID, bad date, approximate, district_only, outside boundary, polygon
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-DEMO",
                        "incident_date": "2024-06-21",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                        "isDemo": True,
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-01",
                        "incident_date": "2024-06-22",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-BAD-DATE",
                        "incident_date": "2024-02-30",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-APPROX",
                        "incident_date": "2024-06-22",
                        "verification_status": "verified",
                        "location_accuracy": "approximate",
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-DIST",
                        "incident_date": "2024-06-22",
                        "verification_status": "verified",
                        "location_accuracy": "district_only",
                    },
                    "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-OUTSIDE",
                        "incident_date": "2024-06-22",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                    },
                    "geometry": {"type": "Point", "coordinates": [98.57, 3.78]},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "incident_id": "SMK-POLY",
                        "incident_date": "2024-06-22",
                        "verification_status": "verified",
                        "location_accuracy": "exact_verified",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[98.67, 3.58], [98.68, 3.58], [98.68, 3.59], [98.67, 3.58]]],
                    },
                },
            ],
        }
        input_path.write_text(json.dumps(sample_points), encoding="utf-8")

        proc_ok = subprocess.run(
            [
                sys.executable,
                str(pipeline_script),
                "--input",
                str(input_path),
                "--boundary",
                str(boundary_path),
                "--config",
                str(config_path),
                "--output",
                str(output_path),
                "--period",
                "2024-SMOKE",
                "--source",
                "Uji Asap PyQGIS Sementara",
                "--report",
                str(report_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc_ok.returncode == 0, f"run_kde_pipeline.py gagal ({proc_ok.returncode}): {proc_ok.stdout}\n{proc_ok.stderr}"
        assert output_path.exists(), "File output GeoJSON harus terbuat."
        assert report_path.exists(), "File report validasi harus terbuat."

        result = json.loads(output_path.read_text(encoding="utf-8"))
        contract_check = validate_verified_hotspot_output(result)
        assert contract_check["valid"], f"Output gagal validasi kontrak: {contract_check['errors']}"

        val_summary = result["analysis"]["validation_summary"]
        assert val_summary["total_input"] == 13, val_summary
        assert val_summary["accepted_count"] == 6, val_summary
        assert val_summary["rejected_count"] == 7, val_summary
        assert result["analysis"]["incident_count_used"] == 6
        assert result["analysis"]["classification_details"]["method"] == "Quantile"
        breaks = result["analysis"]["classification_details"]["breaks"]
        assert breaks["min"] <= breaks["p25"] <= breaks["p50"] <= breaks["p75"] <= breaks["max"]

        # Uji boundary tidak valid harus gagal jelas
        bad_boundary = tmp / "bad_boundary.geojson"
        bad_boundary.write_text(
            json.dumps({"type": "Polygon", "coordinates": [[[98.6, 3.5], [98.7, 3.5], [98.7, 3.6]]]}),
            encoding="utf-8",
        )
        proc_bad = subprocess.run(
            [
                sys.executable,
                str(pipeline_script),
                "--input",
                str(input_path),
                "--boundary",
                str(bad_boundary),
                "--config",
                str(config_path),
                "--output",
                str(tmp / "should_not_exist.geojson"),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc_bad.returncode != 0, "Pipeline harus gagal ketika boundary tidak valid."
        assert "boundary" in (proc_bad.stderr + proc_bad.stdout).lower()

    # Verifikasi proyek template QGIS .qgz dapat dibaca dan tidak mengandung path absolut
    from qgis.core import QgsApplication, QgsProject

    assert qgz_path.exists(), f"Proyek .qgz tidak ditemukan: {qgz_path}"
    with zipfile.ZipFile(qgz_path, "r") as zf:
        qgs_files = [n for n in zf.namelist() if n.endswith(".qgs")]
        assert qgs_files, "Tidak ada file .qgs di dalam arsip .qgz."
        xml_text = zf.read(qgs_files[0]).decode("utf-8", errors="replace")
        assert "C:\\" not in xml_text and "C:/" not in xml_text, "Proyek .qgz tidak boleh memakai path absolut C:"

    qgs = QgsApplication([], False)
    qgs.initQgis()
    try:
        proj = QgsProject.instance()
        proj.clear()
        assert proj.read(str(qgz_path)), "QgsProject.read gagal membuka medan_hotspot_template.qgz"
        assert proj.crs().authid() == "EPSG:32647", f"CRS proyek harus EPSG:32647, dapat {proj.crs().authid()}"
        layouts = proj.layoutManager().printLayouts()
        assert len(layouts) >= 1, "Minimal 1 Print Layout harus ada di dalam proyek .qgz"
        proj.clear()
    finally:
        qgs.exitQgis()

    print("PyQGIS integration smoke test PASS (KDE pipeline + quantile + invalid boundary + .qgz).")


if __name__ == "__main__":
    run_smoke()
