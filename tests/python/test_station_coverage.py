"""Unit test Python murni untuk modul station-coverage (tanpa PyQGIS)."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
COV_DIR = REPO_ROOT / "qgis" / "station-coverage"
if str(COV_DIR) not in sys.path:
    sys.path.insert(0, str(COV_DIR))

from coverage_core import (  # noqa: E402
    CANDIDATE_SCENARIO_LABEL,
    compute_district_coverage_row,
    compute_scenario_time_minutes,
    is_demo_station_record,
    validate_candidate_coverage_scenario,
    validate_candidate_station_records,
    validate_crs_config,
    validate_road_network_metadata,
    validate_station_coverage_output,
    validate_station_records,
)

MEDAN_BOUNDARY = json.loads((REPO_ROOT / "public" / "data" / "medan_districts_osm.geojson").read_text(encoding="utf-8"))
MAKO_DATA = json.loads((REPO_ROOT / "public" / "data" / "fire_incidents_summary.json").read_text(encoding="utf-8"))["verified_stations"][0]
CURATED_CANDIDATES = json.loads((COV_DIR / "public_station_candidates.json").read_text(encoding="utf-8"))["candidates"]


class TestStationCoverageCore(unittest.TestCase):
    def test_validates_mako_and_rejects_demo_unverified_and_outside_stations(self):
        demo_station = {
            "station_code": "DEMO-UPT-1",
            "name": "Contoh Pos DEMO",
            "lat": 3.541,
            "lon": 98.705,
            "verification_status": "verified",
            "isDemo": False,
        }
        outside_station = {
            "station_code": "OUT-01",
            "name": "Luar Medan",
            "lat": 3.78,
            "lon": 98.57,
            "verification_status": "verified",
            "isDemo": False,
        }
        unverified_station = {
            "station_code": "UPT-NEED-REV",
            "name": "Belum Verifikasi",
            "lat": 3.59,
            "lon": 98.67,
            "verification_status": "needs_review",
            "isDemo": False,
        }

        self.assertTrue(is_demo_station_record(demo_station))
        res = validate_station_records([MAKO_DATA, demo_station, outside_station, unverified_station], MEDAN_BOUNDARY)
        self.assertEqual([s["station_code"] for s in res["accepted"]], ["MAKO-00"])
        self.assertEqual(res["summary"]["rejected_count"], 3)
        self.assertEqual(res["summary"]["rejection_reasons"]["demo_station_rejected"], 1)
        self.assertEqual(res["summary"]["rejection_reasons"]["outside_medan_boundary"], 1)
        self.assertEqual(res["summary"]["rejection_reasons"]["unverified_station_status"], 1)

    def test_empty_stations_and_crs_and_road_validation(self):
        empty_res = validate_station_records([], MEDAN_BOUNDARY)
        self.assertEqual(empty_res["accepted"], [])
        self.assertEqual(empty_res["summary"]["total_input"], 0)

        self.assertTrue(validate_crs_config("EPSG:32647", "EPSG:4326")["valid"])
        self.assertFalse(validate_crs_config("EPSG:4326", "EPSG:4326")["valid"])

        self.assertTrue(
            validate_road_network_metadata(
                {
                    "segment_count": 1000,
                    "total_length_km": 120.5,
                    "working_crs": "EPSG:32647",
                    "attribution": "© OpenStreetMap contributors",
                }
            )["valid"]
        )
        self.assertFalse(validate_road_network_metadata({"segment_count": 0})["valid"])

    def test_scenario_time_and_district_coverage_calculations(self):
        self.assertAlmostEqual(compute_scenario_time_minutes(3500, 35), 6.0)
        row = compute_district_coverage_row("12.71.01", "Medan Kota", 10.0, 4.0, 7.5, 9.0, 2200.0)
        self.assertEqual(row["network_5km_coverage_pct"], 75.0)
        self.assertAlmostEqual(row["network_5km_gap_ratio"], 0.25)
        self.assertEqual(row["euclidean_5km_coverage_pct"], 90.0)

    def test_rejects_demo_disguised_in_coverage_output(self):
        res = validate_station_coverage_output({"isDemo": True, "dataLabel": "DEMO"})
        self.assertFalse(res["valid"])

    def test_validates_curated_candidates_and_rejects_invalid_status_or_outside_coords(self):
        res = validate_candidate_station_records(CURATED_CANDIDATES, MEDAN_BOUNDARY, verified_codes={"MAKO-00"})
        self.assertEqual(res["summary"]["accepted_count"], 6)
        self.assertEqual(res["summary"]["geolocated_count"], 4)
        self.assertEqual(res["summary"]["district_only_count"], 2)
        self.assertEqual(res["rejected"], [])
        self.assertEqual([s["station_code"] for s in res["geolocated"]], ["UPT-01", "UPT-02", "UPT-05", "UPT-06"])
        self.assertEqual([s["station_code"] for s in res["district_only"]], ["UPT-03", "UPT-04"])

        bad = [
            {**CURATED_CANDIDATES[0], "verification_status": "verified"},
            {**CURATED_CANDIDATES[0], "station_code": "DEMO-UPT-X", "isDemo": True},
            {
                **CURATED_CANDIDATES[0],
                "station_code": "UPT-OUT",
                "lat": 3.6720893,
                "lon": 98.6819896,
                "geom": {"type": "Point", "coordinates": [98.6819896, 3.6720893]},
            },
            {
                **CURATED_CANDIDATES[3],
                "station_code": "UPT-NONNULL",
                "lat": 3.776,
                "lon": 98.684,
                "geom": {"type": "Point", "coordinates": [98.684, 3.776]},
            },
        ]
        bad_res = validate_candidate_station_records(bad, MEDAN_BOUNDARY, verified_codes={"MAKO-00"})
        self.assertEqual(bad_res["accepted"], [])
        self.assertEqual(bad_res["summary"]["rejected_count"], 4)

    def test_rejects_official_flag_on_candidate_scenario(self):
        scen_check = validate_candidate_coverage_scenario(
            {
                "isDemo": False,
                "is_official_coverage": True,
                "dataLabel": CANDIDATE_SCENARIO_LABEL,
            }
        )
        self.assertFalse(scen_check["valid"])

    def test_tracked_provisional_output_passes_contract_when_present(self):
        prov_path = REPO_ROOT / "public" / "data" / "station-coverage.provisional.json"
        if not prov_path.exists():
            return
        payload = json.loads(prov_path.read_text(encoding="utf-8"))
        res = validate_station_coverage_output(payload)
        self.assertTrue(res["valid"], f"Provisional coverage contract errors: {res['errors']}")
        self.assertEqual([s["station_code"] for s in payload["stations"]], ["MAKO-00"])
        self.assertEqual(len(payload["district_coverage"]), 21)
        self.assertEqual(len(payload.get("candidate_stations") or []), 6)
        for st in payload["candidate_stations"]:
            self.assertEqual(st["verification_status"], "needs_review")
        self.assertEqual(
            [s["station_code"] for s in payload["candidate_stations"] if s["location_accuracy"] == "approximate"],
            ["UPT-01", "UPT-02", "UPT-05", "UPT-06"],
        )
        self.assertEqual(
            [s["station_code"] for s in payload["candidate_stations"] if s["location_accuracy"] == "district_only"],
            ["UPT-03", "UPT-04"],
        )
        scen = payload.get("candidate_coverage_scenario")
        self.assertIsNotNone(scen)
        self.assertFalse(scen["is_official_coverage"])
        self.assertFalse(scen["isDemo"])
        self.assertEqual(len(scen["district_coverage"]), 21)
        base_5km = next(r for r in payload["threshold_comparison"] if r["threshold_meters"] == 5000)
        cand_5km = next(r for r in scen["threshold_comparison"] if r["threshold_meters"] == 5000)
        self.assertGreater(cand_5km["network_area_km2"], base_5km["network_area_km2"])


if __name__ == "__main__":
    unittest.main()
