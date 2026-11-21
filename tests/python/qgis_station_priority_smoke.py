"""
Smoke test PyQGIS untuk memverifikasi keabsahan berkas .qgz dan output analisis
station-coverage serta priority-planner.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[2]
COV_DIR = REPO_ROOT / "qgis" / "station-coverage"
PRIO_DIR = REPO_ROOT / "qgis" / "priority-analysis"
for p in (COV_DIR, PRIO_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from coverage_core import validate_station_coverage_output  # noqa: E402
from priority_core import validate_priority_output  # noqa: E402


def main() -> None:
    cov_json = REPO_ROOT / "public" / "data" / "station-coverage.provisional.json"
    prio_json = REPO_ROOT / "public" / "data" / "priority-planner.provisional.json"
    cov_qgz = COV_DIR / "station_coverage.qgz"
    prio_qgz = PRIO_DIR / "priority_analysis.qgz"

    assert cov_json.exists(), f"Missing {cov_json}"
    assert prio_json.exists(), f"Missing {prio_json}"

    cov_check = validate_station_coverage_output(json.loads(cov_json.read_text(encoding="utf-8")))
    assert cov_check["valid"], f"Invalid station-coverage JSON: {cov_check['errors']}"

    prio_check = validate_priority_output(json.loads(prio_json.read_text(encoding="utf-8")))
    assert prio_check["valid"], f"Invalid priority-planner JSON: {prio_check['errors']}"

    for qgz_path in (cov_qgz, prio_qgz):
        assert qgz_path.exists(), f"Missing {qgz_path}"
        with zipfile.ZipFile(qgz_path, "r") as zf:
            qgs_name = next(n for n in zf.namelist() if n.endswith(".qgs"))
            xml_text = zf.read(qgs_name).decode("utf-8", errors="replace")
            assert "C:\\" not in xml_text and "C:/" not in xml_text, f"Absolute path in {qgz_path}"

    from qgis.core import QgsApplication, QgsProject

    qgs = QgsApplication([], False)
    qgs.initQgis()
    try:
        for qgz_path in (cov_qgz, prio_qgz):
            proj = QgsProject.instance()
            proj.clear()
            assert proj.read(str(qgz_path)), f"Gagal membaca {qgz_path}"
            assert proj.crs().authid() == "EPSG:32647", f"CRS salah pada {qgz_path}: {proj.crs().authid()}"
            assert len(proj.layoutManager().printLayouts()) >= 1, f"Print Layout kosong pada {qgz_path}"
            proj.clear()
    finally:
        qgs.exitQgis()

    print("PyQGIS Station Coverage + Priority Planner smoke test PASS.")


if __name__ == "__main__":
    main()
