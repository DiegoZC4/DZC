#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).with_name("straight_line_resampler.py")
SPEC = importlib.util.spec_from_file_location("straight_line_resampler", MODULE_PATH)
slr = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(slr)


class StraightLineResamplerTests(unittest.TestCase):
    def test_normalize_lon_wraps_to_half_open_interval(self) -> None:
        values = np.array([-540.0, -181.0, -180.0, 0.0, 180.0, 181.0, 540.0])
        np.testing.assert_allclose(slr.normalize_lon(values), np.array([-180.0, 179.0, -180.0, 0.0, -180.0, -179.0, -180.0]))

    def test_row_range_ignores_degenerate_and_outside_edges(self) -> None:
        self.assertIsNone(slr.row_range_for_edge(1.0, 1.0 + 1e-15, -89.5, 1.0, 180))
        self.assertIsNone(slr.row_range_for_edge(91.0, 92.0, -89.5, 1.0, 180))
        self.assertEqual(slr.row_range_for_edge(-1.0, 1.0, -1.5, 1.0, 4), (1, 2))

    def test_make_lat_values_centers_and_endpoints(self) -> None:
        np.testing.assert_allclose(slr.make_lat_values(1.0, 0.5, "centers"), np.array([-0.75, -0.25, 0.25, 0.75]))
        np.testing.assert_allclose(slr.make_lat_values(1.0, 0.5, "endpoints"), np.array([-1.0, -0.5, 0.0, 0.5, 1.0]))

    def test_palette_clips_and_marks_nan(self) -> None:
        colors = slr.palette(np.array([-1.0, 0.0, 0.5, 1.0, 2.0, np.nan]))
        self.assertTrue(np.array_equal(colors[0], colors[1]))
        self.assertTrue(np.array_equal(colors[3], colors[4]))
        self.assertTrue(np.array_equal(colors[5], np.array([8, 8, 12], dtype=np.uint8)))

    def test_parse_levels(self) -> None:
        self.assertEqual(slr.parse_levels("1, 2,4,,6"), {1, 2, 4, 6})

    def test_dateline_split_records_crossings(self) -> None:
        rows: list[list[float]] = [[]]
        dateline_crossings: list[float] = []
        count = slr.add_edge_with_dateline_split(rows, 170.0, -1.0, -170.0, 1.0, 0.0, 1.0, 1, dateline_crossings)
        self.assertGreater(count, 0)
        self.assertEqual(len(dateline_crossings), 1)
        self.assertTrue(any(abs(abs(crossing) - 180.0) < 1e-9 for crossing in rows[0]))


if __name__ == "__main__":
    unittest.main()
