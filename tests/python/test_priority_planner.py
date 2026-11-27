"""Unit test Python murni untuk modul priority-planner (tanpa PyQGIS)."""

from __future__ import annotations

import csv
import json
from pathlib import Path
import sys
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
PRIO_DIR = REPO_ROOT / "qgis" / "priority-analysis"
if str(PRIO_DIR) not in sys.path:
    sys.path.insert(0, str(PRIO_DIR))

from priority_core import (  # noqa: E402
    DEFAULT_WEIGHTS,
    EXPECTED_AREA_CODES,
    compute_priority_scores,
    min_max_normalize,
    validate_and_join_districts,
    validate_priority_output,
    validate_weights,
)

SUMMARY = json.loads((REPO_ROOT / "public" / "data" / "fire_incidents_summary.json").read_text(encoding="utf-8"))
BOUNDARY = json.loads((REPO_ROOT / "public" / "data" / "medan_districts_osm.geojson").read_text(encoding="utf-8"))
with (REPO_ROOT / "data" / "processed" / "medan_population_2022_2025.csv").open("r", encoding="utf-8", newline="") as fh:
    POP_ROWS = list(csv.DictReader(fh))


class TestPriorityPlannerCore(unittest.TestCase):
    def test_joins_exact_21_districts_and_detects_duplicates_missing_and_nulls(self):
        mock_cov = [
            {
                "area_code": code,
                "network_5km_coverage_pct": 50.0,
                "network_5km_gap_ratio": 0.5,
                "centroid_distance_m_mako": 4000.0,
            }
            for code in EXPECTED_AREA_CODES
        ]
        joined = validate_and_join_districts(SUMMARY["district_2023"], POP_ROWS, BOUNDARY, mock_cov)
        self.assertEqual(len(joined["rows"]), 21)
        self.assertTrue(joined["coverage_available"])

        # Duplikat kode
        dup_fire = list(SUMMARY["district_2023"]) + [SUMMARY["district_2023"][0]]
        with self.assertRaises(ValueError):
            validate_and_join_districts(dup_fire, POP_ROWS, BOUNDARY, mock_cov)

        # Kecamatan hilang
        missing_fire = SUMMARY["district_2023"][:-1]
        with self.assertRaises(ValueError):
            validate_and_join_districts(missing_fire, POP_ROWS, BOUNDARY, mock_cov)

        # Nilai null tidak boleh dianggap nol diam-diam
        null_fire = [dict(r) for r in SUMMARY["district_2023"]]
        null_fire[0]["total_incidents"] = None
        with self.assertRaises(ValueError):
            validate_and_join_districts(null_fire, POP_ROWS, BOUNDARY, mock_cov)

    def test_normalization_weights_composite_score_and_partial_mode(self):
        norm = min_max_normalize({"12.71.01": 10.0, "12.71.02": 20.0, "12.71.03": 30.0})
        self.assertAlmostEqual(norm["scores"]["12.71.01"], 0.0)
        self.assertAlmostEqual(norm["scores"]["12.71.02"], 0.5)
        self.assertAlmostEqual(norm["scores"]["12.71.03"], 1.0)

        const_norm = min_max_normalize({"12.71.01": 5.0, "12.71.02": 5.0})
        self.assertAlmostEqual(const_norm["scores"]["12.71.01"], 0.5)

        self.assertEqual(validate_weights(DEFAULT_WEIGHTS), DEFAULT_WEIGHTS)
        with self.assertRaises(ValueError):
            validate_weights({"hotspot_intensity": 0.5, "coverage_gap": 0.4, "population_exposure": 0.2})

        # Tanpa coverage -> wajib mode parsial tanpa mengarang coverage_gap_score
        joined_partial = validate_and_join_districts(SUMMARY["district_2023"], POP_ROWS, BOUNDARY, None)
        self.assertFalse(joined_partial["coverage_available"])
        partial_scores = compute_priority_scores(joined_partial["rows"], coverage_available=False)
        self.assertEqual(partial_scores["mode"], "partial")
        self.assertIsNone(partial_scores["zones"][0]["coverage_gap_score"])
        self.assertIsNone(partial_scores["zones"][0]["composite_score"])

        # Dengan coverage -> rentang 0..1, 4 tier, dan alasan prioritas jelas
        mock_cov = [
            {
                "area_code": code,
                "network_5km_coverage_pct": float(idx * 4),
                "network_5km_gap_ratio": round(1.0 - (idx * 4) / 100.0, 4),
                "centroid_distance_m_mako": float(1000 + idx * 400),
            }
            for idx, code in enumerate(EXPECTED_AREA_CODES)
        ]
        joined_full = validate_and_join_districts(SUMMARY["district_2023"], POP_ROWS, BOUNDARY, mock_cov)
        full_scores = compute_priority_scores(joined_full["rows"], coverage_available=True)
        self.assertEqual(full_scores["mode"], "provisional")
        self.assertEqual(len(full_scores["zones"]), 21)
        for z in full_scores["zones"]:
            self.assertGreaterEqual(z["composite_score"], 0.0)
            self.assertLessEqual(z["composite_score"], 1.0)
            self.assertIn(z["priority_tier"], ("Rendah", "Sedang", "Tinggi", "Sangat Tinggi"))
            self.assertIn("bukan KDE", z["priority_reason"])

        # Validator menolak payload DEMO
        self.assertFalse(validate_priority_output({"isDemo": True, "dataLabel": "DEMO"})["valid"])

    def test_tracked_provisional_priority_output_passes_contract_when_present(self):
        prov_path = REPO_ROOT / "public" / "data" / "priority-planner.provisional.json"
        if not prov_path.exists():
            return
        payload = json.loads(prov_path.read_text(encoding="utf-8"))
        res = validate_priority_output(payload)
        self.assertTrue(res["valid"], f"Provisional priority contract errors: {res['errors']}")
        self.assertEqual(len(payload["zones"]), 21)
        self.assertEqual(payload["analysis"]["method_version"], "priority-v2.0-integrated")
        self.assertEqual(len(payload.get("zones_multi_station") or []), 21)
        self.assertTrue(any((z.get("kde_exploratory_coverage_pct") or 0) > 0 for z in payload["zones"]))


if __name__ == "__main__":
    unittest.main()
