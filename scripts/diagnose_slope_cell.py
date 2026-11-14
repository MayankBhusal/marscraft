
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

# Reuse the exact Horn implementation from the validation script.
from validate_slope import slope_horn

PROJECT = Path(__file__).resolve().parents[1]
META_PATH = PROJECT / "public" / "data" / "dem.meta.json"
DEM_PATH = PROJECT / "public" / "data" / "dem.bin"

SOURCE_URL = (
    "/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/"
    "HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
)

# The strongest discrepancy identified by our experiment.
TARGET_ROW = 59
TARGET_COL = 474
FACTOR = 3


def print_array(title, array, precision=2):
    print(f"\n{title}")
    print(np.array2string(
        array,
        precision=precision,
        suppress_small=True,
        formatter={"float_kind": lambda x: f"{x:9.{precision}f}"}
    ))


def main():
    with open(META_PATH, encoding="utf-8") as f:
        meta = json.load(f)

    coarse = np.fromfile(DEM_PATH, dtype="<f4").reshape(
        meta["rows"], meta["cols"]
    )

    r, c = TARGET_ROW, TARGET_COL

    if not (1 <= r < coarse.shape[0] - 1):
        raise ValueError("Target row has no complete 3x3 coarse neighbourhood.")

    if not (1 <= c < coarse.shape[1] - 1):
        raise ValueError("Target column has no complete 3x3 coarse neighbourhood.")

    print("Opening original USGS DEM...")

    west = meta["west"]
    east = west + meta["cols"] * meta["dLon"]
    north = meta["north"]
    south = north - meta["rows"] * meta["dLat"]

    with rasterio.open(SOURCE_URL) as ds:
        window = from_bounds(
            west, south, east, north, ds.transform
        ).round_offsets().round_lengths()

        fine = ds.read(
            1, window=window, masked=True
        ).astype("float64")

        fine = np.ma.filled(fine, np.nan)
        transform = ds.window_transform(window)

    fine_dlon = abs(transform.a)
    fine_dlat = abs(transform.e)

    print("Fine shape:", fine.shape)
    print("Coarse shape:", coarse.shape)
    print("Fine origin:", transform.c, transform.f)

    # --------------------------------------------------
    # 1. Verify that every coarse elevation matches the
    #    corresponding 3x3 original elevation average.
    # --------------------------------------------------

    blocks = fine.reshape(
        coarse.shape[0], FACTOR,
        coarse.shape[1], FACTOR
    )

    valid = np.isfinite(blocks)
    counts = valid.sum(axis=(1, 3))
    totals = np.where(valid, blocks, 0).sum(axis=(1, 3))

    block_means = np.full(coarse.shape, np.nan, dtype=np.float32)

    np.divide(
        totals,
        counts,
        out=block_means,
        where=counts > 0
    )

    comparable = (
        np.isfinite(coarse) & np.isfinite(block_means)
    )

    elevation_difference = (
        coarse[comparable] - block_means[comparable]
    )

    print("\n=== BLOCK-AVERAGING VERIFICATION ===")
    print("Compared elevation cells:", comparable.sum())
    print(
        "Maximum absolute difference:",
        np.max(np.abs(elevation_difference)),
        "m"
    )
    print(
        "Mean absolute difference:",
        np.mean(np.abs(elevation_difference)),
        "m"
    )

    # --------------------------------------------------
    # 2. Extract the target's original 3x3 elevation block.
    # --------------------------------------------------

    fr = r * FACTOR
    fc = c * FACTOR

    fine_elevation_block = fine[
        fr:fr + FACTOR,
        fc:fc + FACTOR
    ]

    fine_slope = slope_horn(
        fine,
        fine_dlon,
        fine_dlat,
        transform.f,
        meta["radiusM"]
    )

    coarse_slope = slope_horn(
        coarse,
        meta["dLon"],
        meta["dLat"],
        meta["north"],
        meta["radiusM"]
    )

    fine_slope_block = fine_slope[
        fr:fr + FACTOR,
        fc:fc + FACTOR
    ]

    # --------------------------------------------------
    # 3. Inspect the 3x3 coarse elevation neighbourhood.
    # --------------------------------------------------

    coarse_elevation_neighborhood = coarse[
        r - 1:r + 2,
        c - 1:c + 2
    ]

    coarse_slope_neighborhood = coarse_slope[
        r - 1:r + 2,
        c - 1:c + 2
    ]

    # Corresponding 9x9 original-resolution elevations.
    fine_elevation_neighborhood = fine[
        (r - 1) * FACTOR:(r + 2) * FACTOR,
        (c - 1) * FACTOR:(c + 2) * FACTOR
    ]

    # --------------------------------------------------
    # 4. Report the target cell.
    # --------------------------------------------------

    block_mean = block_means[r, c]
    coarse_elevation = coarse[r, c]
    coarse_slope_value = coarse_slope[r, c]

    valid_fine_slopes = fine_slope_block[
        np.isfinite(fine_slope_block)
    ]

    print("\n=== TARGET CELL ===")
    print(f"Coarse cell: ({r}, {c})")

    lon = meta["west"] + (c + 0.5) * meta["dLon"]
    lat = meta["north"] - (r + 0.5) * meta["dLat"]

    print(f"Cell centre: {lon:.6f}°E, {lat:.6f}°N")

    print_array(
        "Original 3x3 elevation block (m):",
        fine_elevation_block
    )

    print(f"\nOriginal block mean: {block_mean:.4f} m")
    print(f"Production coarse elevation: {coarse_elevation:.4f} m")
    print(
        "Elevation difference:",
        f"{coarse_elevation - block_mean:.6f} m"
    )

    print_array(
        "Fine-resolution 3x3 slope block (degrees):",
        fine_slope_block
    )

    if valid_fine_slopes.size:
        print("\nFine slope statistics:")
        print("  Count:", valid_fine_slopes.size)
        print("  Median:", np.median(valid_fine_slopes))
        print("  P90:", np.percentile(valid_fine_slopes, 90))
        print("  Maximum:", np.max(valid_fine_slopes))

    print("\nCoarse slope:", coarse_slope_value, "degrees")

    print_array(
        "3x3 coarse elevation neighbourhood (m):",
        coarse_elevation_neighborhood
    )

    print_array(
        "3x3 coarse slope neighbourhood (degrees):",
        coarse_slope_neighborhood
    )

    print_array(
        "9x9 original elevation neighbourhood (m):",
        fine_elevation_neighborhood
    )

    print("\nDiagnostic complete.")


if __name__ == "__main__":
    main()
