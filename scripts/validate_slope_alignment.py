
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from validate_slope import slope_horn


PROJECT = Path(__file__).resolve().parents[1]

META_PATH = PROJECT / "public" / "data" / "dem.meta.json"
DEM_PATH = PROJECT / "public" / "data" / "dem.bin"

SOURCE_URL = (
    "/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/"
    "HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
)

FACTOR = 3


def main():
    # -------------------------------------------------
    # 1. Load production metadata and coarse DEM.
    # -------------------------------------------------

    with open(META_PATH, encoding="utf-8") as f:
        meta = json.load(f)

    coarse = np.fromfile(
        DEM_PATH, dtype="<f4"
    ).reshape(meta["rows"], meta["cols"])

    print("Coarse DEM:", coarse.shape)

    # -------------------------------------------------
    # 2. Load the exact original DEM crop.
    # -------------------------------------------------

    west = meta["west"]
    east = west + meta["cols"] * meta["dLon"]
    north = meta["north"]
    south = north - meta["rows"] * meta["dLat"]

    print("Opening original USGS DEM...")

    with rasterio.open(SOURCE_URL) as ds:
        window = from_bounds(
            west, south, east, north, ds.transform
        ).round_offsets().round_lengths()

        fine = ds.read(
            1, window=window, masked=True
        ).astype("float64")

        fine = np.ma.filled(fine, np.nan)
        transform = ds.window_transform(window)

    print("Fine DEM:", fine.shape)

    if fine.shape != (
        coarse.shape[0] * FACTOR,
        coarse.shape[1] * FACTOR
    ):
        raise ValueError("Fine and coarse grids are not aligned 3x3 grids.")

    # -------------------------------------------------
    # 3. Calculate slope independently at both scales.
    # -------------------------------------------------

    print("Calculating fine-resolution slope...")

    fine_slope = slope_horn(
        fine,
        abs(transform.a),
        abs(transform.e),
        transform.f,
        meta["radiusM"]
    )

    print("Calculating coarse-resolution slope...")

    coarse_slope = slope_horn(
        coarse,
        meta["dLon"],
        meta["dLat"],
        meta["north"],
        meta["radiusM"]
    )

    # -------------------------------------------------
    # 4. Center-to-center comparison.
    #
    # Fine index (1, 1) is the center of each 3x3 block.
    # -------------------------------------------------

    fine_center = fine_slope[1::FACTOR, 1::FACTOR]

    valid = (
        np.isfinite(fine_center)
        & np.isfinite(coarse_slope)
    )

    fine_values = fine_center[valid]
    coarse_values = coarse_slope[valid]

    difference = coarse_values - fine_values
    absolute_difference = np.abs(difference)

    print("\n========== CENTER-TO-CENTER AGREEMENT ==========")
    print("Compared cells:", len(difference))
    print(f"Mean signed difference: {np.mean(difference):.4f}°")
    print(f"Median signed difference: {np.median(difference):.4f}°")
    print(f"Mean absolute difference: {np.mean(absolute_difference):.4f}°")
    print(f"Median absolute difference: {np.median(absolute_difference):.4f}°")
    print(f"P90 absolute difference: {np.percentile(absolute_difference, 90):.4f}°")
    print(f"P95 absolute difference: {np.percentile(absolute_difference, 95):.4f}°")
    print(f"Maximum absolute difference: {np.max(absolute_difference):.4f}°")

    # -------------------------------------------------
    # 5. Within-cell fine slope variability.
    # -------------------------------------------------

    blocks = fine_slope.reshape(
        coarse.shape[0], FACTOR,
        coarse.shape[1], FACTOR
    )

    # Rearrange into:
    # (coarse rows, coarse cols, 9 fine slopes)
    blocks = blocks.transpose(0, 2, 1, 3).reshape(
        coarse.shape[0], coarse.shape[1], FACTOR * FACTOR
    )

    counts = np.isfinite(blocks).sum(axis=2)

    median = np.nanmedian(blocks, axis=2)
    p90 = np.nanpercentile(blocks, 90, axis=2)
    maximum = np.nanmax(blocks, axis=2)

    variability = p90 - median

    valid_blocks = (
        (counts == FACTOR * FACTOR)
        & np.isfinite(coarse_slope)
    )

    variability_values = variability[valid_blocks]

    print("\n========== WITHIN-CELL SLOPE VARIABILITY ==========")
    print("Complete blocks:", len(variability_values))
    print(f"Mean P90 - median: {np.mean(variability_values):.4f}°")
    print(f"Median P90 - median: {np.median(variability_values):.4f}°")
    print(f"P90 of variability: {np.percentile(variability_values, 90):.4f}°")
    print(f"P95 of variability: {np.percentile(variability_values, 95):.4f}°")
    print(f"Maximum variability: {np.max(variability_values):.4f}°")

    # -------------------------------------------------
    # 6. Threshold comparison at aligned centers.
    # -------------------------------------------------

    print("\n========== CENTER-TO-CENTER CLASS AGREEMENT ==========")

    for threshold in (5, 15):
        fine_high = fine_values >= threshold
        coarse_high = coarse_values >= threshold

        disagreement = np.count_nonzero(
            fine_high != coarse_high
        )

        print(
            f"{threshold}° threshold disagreements: "
            f"{disagreement} / {len(difference)} "
            f"({100 * disagreement / len(difference):.2f}%)"
        )

    # -------------------------------------------------
    # 7. Save the diagnostic results.
    # -------------------------------------------------

    output = PROJECT / "validation" / "slope_alignment_results.json"
    output.parent.mkdir(parents=True, exist_ok=True)

    results = {
        "compared_cells": int(len(difference)),
        "center_to_center": {
            "mean_signed_difference_deg": float(np.mean(difference)),
            "median_signed_difference_deg": float(np.median(difference)),
            "mean_absolute_difference_deg": float(np.mean(absolute_difference)),
            "median_absolute_difference_deg": float(np.median(absolute_difference)),
            "p90_absolute_difference_deg": float(np.percentile(absolute_difference, 90)),
            "p95_absolute_difference_deg": float(np.percentile(absolute_difference, 95)),
            "max_absolute_difference_deg": float(np.max(absolute_difference)),
        },
        "within_cell_variability": {
            "complete_blocks": int(len(variability_values)),
            "mean_p90_minus_median_deg": float(np.mean(variability_values)),
            "median_p90_minus_median_deg": float(np.median(variability_values)),
            "p90_variability_deg": float(np.percentile(variability_values, 90)),
            "p95_variability_deg": float(np.percentile(variability_values, 95)),
            "max_variability_deg": float(np.max(variability_values)),
        },
    }

    with open(output, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print("\nSaved:", output)
    print("\nValidation complete.")


if __name__ == "__main__":
    main()
