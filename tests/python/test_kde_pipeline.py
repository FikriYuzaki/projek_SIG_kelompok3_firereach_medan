"""Unit test murni Python untuk logika KDE Fire Hotspot Analyzer (tanpa ketergantungan PyQGIS)."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
HOTSPOT_QGIS_DIR = REPO_ROOT / "qgis" / "hotspot-analysis"
if str(HOTSPOT_QGIS_DIR) not in sys.path:
    sys.path.insert(0, str(HOTSPOT_QGIS_DIR))

from kde_core import (  # noqa: E402
    DENSITY_TIERS,
    classify_grid,
    classify_value,
    compute_quantile_classification,
    is_valid_incident_date,
    point_in_geojson,
    validate_boundary_geojson,
    validate_kde_input_features,
    validate_verified_hotspot_output,
)


BOUNDARY_FILE = REPO_ROOT / "public" / "data" / "medan_districts_osm.geojson"
MEDAN_BOUNDARY = json.loads(BOUNDARY_FILE.read_text(encoding="utf-8"))


class TestQuantileClassification(unittest.TestCase):
    def test_true_quantile_differs_from_equal_interval_on_skewed_distribution(self):
        # Distribusi sangat miring: Equal Interval akan mengosongkan kelas tengah,
        # sedangkan Quantile membagi populasi valid menjadi 4 kelompok kuartil yang seimbang.
        values = [1.0, 2.0, 3.0, 4.0, 5.0, 10.0, 20.0, 100.0]
        result = compute_quantile_classification(values)

        self.assertEqual(result["method"], "Quantile")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["class_count"], 4)

        breaks = result["breaks"]
        self.assertAlmostEqual(breaks["p25"], 2.75)
        self.assertAlmostEqual(breaks["p50"], 4.5)
        self.assertAlmostEqual(breaks["p75"], 12.5)
        # Buktikan bukan Equal Interval ((100 - 1) / 4 -> 25.75, 50.5, 75.25)
        self.assertNotAlmostEqual(breaks["p25"], 25.75)
        self.assertNotAlmostEqual(breaks["p50"], 50.5)
        self.assertNotAlmostEqual(breaks["p75"], 75.25)

        counts_by_rank = {t["rank"]: t["pixel_count"] for t in result["thresholds"]}
        labels_by_rank = {t["rank"]: t["label"] for t in result["thresholds"]}
        self.assertEqual(counts_by_rank, {1: 2, 2: 2, 3: 2, 4: 2})
        self.assertEqual(labels_by_rank, {k: v["label"] for k, v in DENSITY_TIERS.items()})

        classified = [classify_value(v, result) for v in values]
        self.assertEqual(classified, [1, 1, 2, 2, 3, 3, 4, 4])

    def test_excludes_nodata_background_zero_and_outside_mask(self):
        grid = [
            [-9999.0, 0.0, 0.0, 100.0],
            [1.0, 2.0, 3.0, 4.0],
            [5.0, 6.0, 7.0, 8.0],
            [float("nan"), float("inf"), None, -0.5],
        ]
        # Piksel (0, 3) bernilai 100.0 berada di luar mask administrasi Kota Medan
        mask = [
            [True, True, True, False],
            [True, True, True, True],
            [True, True, True, True],
            [True, True, True, True],
        ]
        result = compute_quantile_classification(grid, nodata=-9999.0, mask=mask, exclude_non_positive=True)
        pop = result["population"]
        self.assertEqual(pop["total_pixels"], 16)
        self.assertEqual(pop["masked_out_pixels"], 1)
        self.assertEqual(pop["nodata_pixels"], 4)
        self.assertEqual(pop["zero_or_background_pixels"], 3)
        self.assertEqual(pop["valid_positive_pixels"], 8)

        breaks = result["breaks"]
        self.assertAlmostEqual(breaks["min"], 1.0)
        self.assertAlmostEqual(breaks["max"], 8.0)
        self.assertAlmostEqual(breaks["p25"], 2.75)
        self.assertAlmostEqual(breaks["p50"], 4.5)
        self.assertAlmostEqual(breaks["p75"], 6.25)

        out_grid = classify_grid(grid, result, nodata=-9999.0, mask=mask, output_nodata=-9999)
        self.assertEqual(
            out_grid,
            [
                [-9999, -9999, -9999, -9999],
                [1, 1, 2, 2],
                [3, 3, 4, 4],
                [-9999, -9999, -9999, -9999],
            ],
        )

    def test_handles_empty_identical_and_tied_distributions(self):
        empty_res = compute_quantile_classification([0.0, -9999.0, None], nodata=-9999.0)
        self.assertEqual(empty_res["status"], "empty")
        self.assertEqual(empty_res["class_count"], 0)
        self.assertIsNone(empty_res["breaks"])
        self.assertIsNone(classify_value(5.0, empty_res))

        const_res = compute_quantile_classification([3.5, 3.5, 3.5, 3.5, 0.0])
        self.assertEqual(const_res["status"], "degenerate_constant")
        self.assertEqual(const_res["class_count"], 1)
        self.assertEqual(const_res["thresholds"][0]["rank"], 1)
        self.assertEqual(const_res["thresholds"][0]["label"], "Rendah")
        self.assertEqual(classify_value(3.5, const_res), 1)
        self.assertIsNone(classify_value(0.0, const_res))

        tied_res = compute_quantile_classification([1.0, 1.0, 1.0, 1.0, 5.0, 6.0, 7.0, 8.0])
        self.assertEqual(tied_res["status"], "degenerate_tied_quantiles")
        self.assertEqual(tied_res["empty_ranks"], [2])
        self.assertEqual(tied_res["class_count"], 3)
        self.assertTrue(len(tied_res["warnings"]) > 0)


class TestBoundaryAndPointInPolygon(unittest.TestCase):
    def test_real_osm_boundary_is_valid(self):
        check = validate_boundary_geojson(MEDAN_BOUNDARY)
        self.assertTrue(check["valid"])
        self.assertGreaterEqual(check["polygon_count"], 21)

    def test_polygon_multipolygon_holes_and_boundary_edges(self):
        polygon_with_hole = {
            "type": "Polygon",
            "coordinates": [
                [[98.60, 3.50], [98.70, 3.50], [98.70, 3.60], [98.60, 3.60], [98.60, 3.50]],
                [[98.63, 3.53], [98.67, 3.53], [98.67, 3.57], [98.63, 3.57], [98.63, 3.53]],
            ],
        }
        self.assertTrue(validate_boundary_geojson(polygon_with_hole)["valid"])
        self.assertEqual(validate_boundary_geojson(polygon_with_hole)["hole_count"], 1)

        # Titik di dalam poligon utama dan di luar lubang
        self.assertTrue(point_in_geojson(98.61, 3.51, polygon_with_hole))
        # Titik tepat di batas luar poligon
        self.assertTrue(point_in_geojson(98.65, 3.50, polygon_with_hole))
        # Titik tepat di batas interior ring (lubang)
        self.assertTrue(point_in_geojson(98.65, 3.53, polygon_with_hole))
        # Titik di dalam lubang (hole) wajib ditolak
        self.assertFalse(point_in_geojson(98.65, 3.55, polygon_with_hole))
        # Titik di luar poligon utama
        self.assertFalse(point_in_geojson(98.75, 3.55, polygon_with_hole))

        multipolygon = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[98.60, 3.50], [98.62, 3.50], [98.62, 3.52], [98.60, 3.52], [98.60, 3.50]]],
                [[[98.68, 3.58], [98.70, 3.58], [98.70, 3.60], [98.68, 3.60], [98.68, 3.58]]],
            ],
        }
        self.assertTrue(point_in_geojson(98.61, 3.51, multipolygon))
        self.assertTrue(point_in_geojson(98.69, 3.59, multipolygon))
        self.assertFalse(point_in_geojson(98.65, 3.55, multipolygon))

    def test_invalid_boundary_raises_clear_error(self):
        unclosed_boundary = {
            "type": "Polygon",
            "coordinates": [[[98.60, 3.50], [98.70, 3.50], [98.70, 3.60], [98.60, 3.60]]],
        }
        check = validate_boundary_geojson(unclosed_boundary)
        self.assertFalse(check["valid"])
        with self.assertRaises(ValueError):
            validate_kde_input_features([], unclosed_boundary)


class TestStrictInputValidation(unittest.TestCase):
    def test_validates_all_strict_rules_and_preserves_raw_input(self):
        self.assertTrue(is_valid_incident_date("2024-02-29"))
        self.assertFalse(is_valid_incident_date("2023-02-29"))
        self.assertFalse(is_valid_incident_date("2024-02-30"))
        self.assertFalse(is_valid_incident_date("not-a-date"))

        records = [
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-001",
                    "incident_date": "2024-06-15",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                    "isDemo": False,
                    "dataLabel": "TERVERIFIKASI",
                },
                "geometry": {"type": "Point", "coordinates": [98.6714, 3.5895]},
            },
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-002",
                    "incident_date": "2025-01-10",
                    "verification_status": "verified",
                    "location_accuracy": "address_geocoded_verified",
                    "isDemo": False,
                    "dataLabel": "RESMI",
                },
                "geometry": {"type": "Point", "coordinates": [98.68, 3.77]},
            },
            # Ditolak: ID duplikat
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-001",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                    "isDemo": False,
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            # Ditolak: ID kosong
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "   ",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            # Ditolak: tanggal tidak valid
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-BAD-DATE",
                    "incident_date": "2024-02-30",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            # Ditolak: DEMO flag dan label dengan spasi/kapitalisasi campuran
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-DEMO-FLAG",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                    "isDemo": True,
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-DEMO-LBL",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                    "dataLabel": "  dEmO  ",
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            # Ditolak: approximate, district_only, unknown, unlocated
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-APPROX",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "approximate",
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-DIST",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "district_only",
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-UNLOC",
                    "incident_date": "2024-06-16",
                    "verification_status": "unlocated",
                    "location_accuracy": "unknown",
                },
                "geometry": {"type": "Point", "coordinates": [98.67, 3.59]},
            },
            # Ditolak: geometri non-Point / NaN / di luar Medan
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-POLY",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[98.66, 3.58], [98.68, 3.58], [98.68, 3.59], [98.66, 3.58]]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-NAN",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                },
                "geometry": {"type": "Point", "coordinates": [float("nan"), 3.59]},
            },
            {
                "type": "Feature",
                "properties": {
                    "incident_id": "INC-OUTSIDE",
                    "incident_date": "2024-06-16",
                    "verification_status": "verified",
                    "location_accuracy": "exact_verified",
                },
                "geometry": {"type": "Point", "coordinates": [98.57, 3.78]},
            },
        ]

        raw_snapshot = copy.deepcopy(records)
        result = validate_kde_input_features(records, MEDAN_BOUNDARY)

        # Data mentah tidak boleh dimodifikasi
        for orig, current in zip(raw_snapshot, records):
            if orig["properties"].get("incident_id") != "INC-NAN":
                self.assertEqual(orig, current)

        summary = result["summary"]
        self.assertEqual(summary["total_input"], 13)
        self.assertEqual(summary["accepted_count"], 2)
        self.assertEqual(summary["rejected_count"], 11)
        self.assertEqual(summary["points_used_for_kde"], 2)
        self.assertEqual(
            [f["properties"]["incident_id"] for f in result["accepted"]],
            ["INC-001", "INC-002"],
        )
        self.assertEqual(summary["rejection_reasons"]["duplicate_incident_id"], 1)
        self.assertEqual(summary["rejection_reasons"]["missing_incident_id"], 1)
        self.assertEqual(summary["rejection_reasons"]["invalid_incident_date"], 1)
        self.assertEqual(summary["rejection_reasons"]["demo_record_flagged"], 1)
        self.assertEqual(summary["rejection_reasons"]["demo_data_label"], 1)
        self.assertEqual(summary["rejection_reasons"]["disallowed_location_accuracy"], 3)
        self.assertEqual(summary["rejection_reasons"]["outside_medan_boundary"], 1)

    def test_verified_output_validator_rejects_demo_and_accepts_valid_output(self):
        valid_payload = {
            "type": "FeatureCollection",
            "isDemo": False,
            "dataLabel": "TERVERIFIKASI",
            "analysis": {
                "source": "Damkarmat Kota Medan",
                "period_label": "2024",
                "kernel_method": "Quartic",
                "bandwidth_meters": 1000,
                "pixel_size_meters": 100,
                "working_crs": "EPSG:32647",
                "classification_method": "Quantile (4 kelas)",
                "incident_count_used": 10,
            },
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "isDemo": False,
                        "dataLabel": "TERVERIFIKASI",
                        "zone_id": "hotspot-zone-1",
                        "density_class": "Tinggi",
                        "density_rank": 3,
                        "area_km2": 1.25,
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[98.66, 3.58], [98.68, 3.58], [98.68, 3.60], [98.66, 3.60], [98.66, 3.58]]
                        ],
                    },
                }
            ],
        }
        self.assertTrue(validate_verified_hotspot_output(valid_payload)["valid"])

        demo_payload = copy.deepcopy(valid_payload)
        demo_payload["dataLabel"] = " demo "
        self.assertFalse(validate_verified_hotspot_output(demo_payload)["valid"])


if __name__ == "__main__":
    unittest.main()
