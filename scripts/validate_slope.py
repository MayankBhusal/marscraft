
#!/usr/bin/env python3
"""
Compare Horn slope calculated from:
1. The original-resolution USGS HRSC+MOLA DEM.
2. MarsCraft's 3x3 block-averaged DEM.

This is a resolution-sensitivity experiment, not an independent
ground-truth accuracy assessment.

Does not modify public/data/dem.bin or dem.meta.json.

Requires: numpy, rasterio
"""

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

URL = (
    "/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/"
    "HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
)

RADIUS_M = 3396190.0
RAD = math.pi / 180.0

PROJECT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT / "public" / "data"


def slope_horn(z, dlon, dlat, north, radius):
    """Calculate Horn 3x3 slope in degrees."""
    rows, cols = z.shape
    out = np.full((rows, cols), np.nan, dtype=np.float32)

    for r in range(1, rows - 1):
        lat = north - (r + 0.5) * dlat
        dx = dlon * RAD * radius * math.cos(lat * RAD)
        dy = dlat * RAD * radius

        if dx <= 0 or dy <= 0:
            continue

        a = z[r - 1, :-2]
        b = z[r - 1, 1:-1]
        c = z[r - 1, 2:]
        d = z[r, :-2]
        e = z[r, 1:-1]
        f = z[r, 2:]
        g = z[r + 1, :-2]
        h = z[r + 1, 1:-1]
        i = z[r + 1, 2:]

        valid = (
            np.isfinite(a) & np.isfinite(b) & np.isfinite(c) &
            np.isfinite(d) & np.isfinite(e) & np.isfinite(f) &
            np.isfinite(g) & np.isfinite(h) & np.isfinite(i)
        )

        dzdx = ((c + 2*f + i) - (a + 2*d + g)) / (8 * dx)
        dzdy = ((a + 2*b + c) - (g + 2*h + i)) / (8 * dy)

        row_slope = np.full(cols - 2, np.nan, dtype=np.float32)
        row_slope[valid] = (
            np.degrees(np.arctan(np.hypot(dzdx[valid], dzdy[valid])))
        )

        out[r, 1:-1] = row_slope

    return out


def block_average(z, factor):
    rows = z.shape[0] // factor
    cols = z.shape[1] // factor

    blocks = z[:rows*factor, :cols*factor].reshape(
        rows, factor, cols, factor
    )

    valid = np.isfinite(blocks)
    count = valid.sum(axis=(1, 3))
    total = np.where(valid, blocks, 0).sum(axis=(1, 3))

    result = np.full((rows, cols), np.nan, dtype=np.float32)
    np.divide(total, count, out=result, where=count > 0)

    return result


def classify(slope):
    result = np.full(slope.shape, -1, dtype=np.int8)
    valid = np.isfinite(slope)

    result[valid & (slope < 5)] = 0
    result[valid & (slope >= 5) & (slope < 15)] = 1
    result[valid & (slope >= 15)] = 2

    return result


def statistics(values):
    values = values[np.isfinite(values)]

    if values.size == 0:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "p90": None,
            "p95": None,
            "maximum": None,
        }

    return {
        "count": int(values.size),
        "mean": float(np.mean(values)),
        "median": float(np.median(values)),
        "p90": float(np.percentile(values, 90)),
        "p95": float(np.percentile(values, 95)),
        "maximum": float(np.max(values)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tif", default=URL)
    parser.add_argument("--factor", type=int, default=3)
    parser.add_argument("--min-valid", type=float, default=0.5)
    args = parser.parse_args()

    if args.factor < 2:
        raise ValueError("Block factor must be at least 2.")

    meta_path = DATA_DIR / "dem.meta.json"
    binary_path = DATA_DIR / "dem.bin"

    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)

    coarse = np.fromfile(binary_path, dtype="<f4").reshape(
        meta["rows"], meta["cols"]
    )

    if meta["synthetic"]:
        raise ValueError("Production DEM is marked synthetic.")

    print("Opening original USGS DEM...")

    with rasterio.open(args.tif) as ds:
        west = meta["west"]
        east = west + meta["cols"] * meta["dLon"]
        north = meta["north"]
        south = north - meta["rows"] * meta["dLat"]

        # Reproduce the original source-pixel alignment.
        win = from_bounds(west, south, east, north, ds.transform)
        win = win.round_offsets().round_lengths()

        fine = ds.read(1, window=win, masked=True).astype("float64")
        fine = np.ma.filled(fine, np.nan)

        transform = ds.window_transform(win)

        print("Original array:", fine.shape)
        print("Original resolution:", ds.res)
        print("Actual origin:", transform.c, transform.f)

    factor = args.factor

    if fine.shape[0] % factor or fine.shape[1] % factor:
        raise ValueError(
            "Source dimensions are not divisible by block factor. "
            "Use the same aligned crop as prepare_dem.py."
        )

    expected_shape = (
        fine.shape[0] // factor,
        fine.shape[1] // factor,
    )

    if expected_shape != coarse.shape:
        raise ValueError(
            f"Shape mismatch: source blocks {expected_shape}, "
            f"working DEM {coarse.shape}. Check crop alignment."
        )

    source_dlon = abs(transform.a)
    source_dlat = abs(transform.e)

    # Validate that the source and working DEM align.
    expected_dlon = source_dlon * factor
    expected_dlat = source_dlat * factor

    if not np.isclose(meta["dLon"], expected_dlon, rtol=1e-5):
        raise ValueError("Working DEM longitude resolution does not match source.")
    if not np.isclose(meta["dLat"], expected_dlat, rtol=1e-5):
        raise ValueError("Working DEM latitude resolution does not match source.")

    print("Calculating original-resolution slope...")
    fine_slope = slope_horn(
        fine, source_dlon, source_dlat,
        transform.f, meta["radiusM"]
    )

    print("Calculating working-grid slope...")
    coarse_slope = slope_horn(
        coarse, meta["dLon"], meta["dLat"],
        meta["north"], meta["radiusM"]
    )

    # Summarize the fine-resolution slope distribution inside each
    # corresponding coarse cell.
    frows, fcols = expected_shape

    fine_blocks = fine_slope.reshape(
        frows, factor, fcols, factor
    ).transpose(0, 2, 1, 3).reshape(
        frows, fcols, factor * factor
    )

    fine_valid = np.isfinite(fine_blocks)
    fine_count = fine_valid.sum(axis=2)

    fine_median = np.full((frows, fcols), np.nan, dtype=np.float32)
    fine_p90 = np.full_like(fine_median, np.nan)
    fine_max = np.full_like(fine_median, np.nan)

    # Per-block statistics; small regional crop, so explicit loop
    # avoids assumptions about all-NaN percentile behavior.
    for r in range(frows):
        for c in range(fcols):
            vals = fine_blocks[r, c]
            vals = vals[np.isfinite(vals)]
            if vals.size:
                fine_median[r, c] = np.median(vals)
                fine_p90[r, c] = np.percentile(vals, 90)
                fine_max[r, c] = np.max(vals)

    # Primary comparison: coarse slope vs median fine slope
    # within the same geographic block.
    valid = (
        np.isfinite(coarse_slope) &
        np.isfinite(fine_median)
    )

    if not np.any(valid):
        raise ValueError("No overlapping valid slope cells.")

    difference = coarse_slope[valid] - fine_median[valid]
    absolute_difference = np.abs(difference)

    # Compare coarse classification to the median fine-slope class.
    coarse_class = classify(coarse_slope)
    fine_class = classify(fine_median)

    class_valid = valid & (coarse_class >= 0) & (fine_class >= 0)
    class_changed = coarse_class[class_valid] != fine_class[class_valid]

    # Flag blocks where fine-scale local maxima cross a threshold
    # that the coarse slope does not cross.
    fine_max_class = classify(fine_max)
    missed_high = (
        np.isfinite(coarse_slope) &
        np.isfinite(fine_max) &
        (fine_max >= 15) &
        (coarse_slope < 15)
    )

    # Compare fine slope variability inside each block.
    local_variability = fine_p90 - fine_median
    local_variability = local_variability[np.isfinite(local_variability)]

    report = {
        "experiment": "HRSC-MOLA slope resolution sensitivity",
        "source": meta["source"],
        "sourceUrl": meta["sourceUrl"],
        "method": "Horn 3x3 slope on original and block-averaged DEM",
        "blockFactor": factor,
        "fineShape": list(fine.shape),
        "coarseShape": list(coarse.shape),
        "fineResolutionDegrees": [source_dlon, source_dlat],
        "coarseResolutionDegrees": [meta["dLon"], meta["dLat"]],
        "validOverlapCells": int(valid.sum()),
        "fineSlopeMedianWithinBlockVsCoarseSlopeDifferenceDegrees": {
            "signed": statistics(difference),
            "absolute": statistics(absolute_difference),
        },
        "terrainClassComparison": {
            "comparedCells": int(class_valid.sum()),
            "changedCells": int(class_changed.sum()),
            "changedPercent": float(class_changed.mean() * 100)
                if class_changed.size else None,
        },
        "fineScaleHighSlopeNotHighOnCoarseGrid": {
            "cells": int(missed_high.sum()),
            "percentOfValidOverlap": float(
                missed_high.sum() / valid.sum() * 100
            ),
        },
        "fineScaleWithinBlockSlopeVariability": statistics(local_variability),
        "fineSlopeValidPercent": float(np.isfinite(fine_slope).mean() * 100),
        "coarseSlopeValidPercent": float(np.isfinite(coarse_slope).mean() * 100),
        "interpretation": (
            "This measures sensitivity to resolution and block averaging. "
            "The original-resolution slope is not independent ground truth."
        ),
    }

    out_dir = PROJECT / "validation"
    out_dir.mkdir(exist_ok=True)

    report_path = out_dir / "slope_validation.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    csv_path = out_dir / "slope_validation_cells.csv"

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "row", "col", "coarse_slope_deg",
            "fine_median_deg", "fine_p90_deg",
            "fine_max_deg", "difference_deg",
            "absolute_difference_deg",
            "coarse_class", "fine_median_class",
        ])

        labels = {-1: "unknown", 0: "low", 1: "moderate", 2: "high"}

        for r, c in zip(*np.where(valid)):
            diff = float(coarse_slope[r, c] - fine_median[r, c])
            writer.writerow([
                int(r), int(c),
                float(coarse_slope[r, c]),
                float(fine_median[r, c]),
                float(fine_p90[r, c]),
                float(fine_max[r, c]),
                diff,
                abs(diff),
                labels[int(coarse_class[r, c])],
                labels[int(fine_class[r, c])],
            ])

    print("\n=== SLOPE VALIDATION RESULTS ===")
    print("Valid overlapping cells:", int(valid.sum()))
    print("Mean signed difference:", float(np.mean(difference)), "degrees")
    print("Median absolute difference:", float(np.median(absolute_difference)), "degrees")
    print("90th percentile absolute difference:", float(np.percentile(absolute_difference, 90)), "degrees")
    print("95th percentile absolute difference:", float(np.percentile(absolute_difference, 95)), "degrees")
    print("Maximum absolute difference:", float(np.max(absolute_difference)), "degrees")
    print("Terrain class changes:", report["terrainClassComparison"]["changedPercent"], "%")
    print("Fine-scale >=15° but coarse <15°:", report["fineScaleHighSlopeNotHighOnCoarseGrid"]["percentOfValidOverlap"], "%")
    print("\nReports saved:")
    print(report_path)
    print(csv_path)


if __name__ == "__main__":
    main()
