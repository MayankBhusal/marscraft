
import csv
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.transform import array_bounds

ROOT = Path(__file__).resolve().parent.parent

META_PATH = ROOT / "public" / "data" / "dem.meta.json"
DEM_PATH = ROOT / "public" / "data" / "dem.bin"

CSV_PATH = ROOT / "validation" / "slope_validation_cells.csv"
OUTPUT_DIR = ROOT / "validation" / "plots"

SOURCE_URL = (
    "https://planetarymaps.usgs.gov/mosaic/Mars/"
    "HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
)


def calculate_slope(elevation, dlon, dlat, radius):
    """
    Calculate slope in degrees using the Horn 3x3 method.

    dlon and dlat are in degrees.
    Elevation is in metres.
    """

    rows, cols = elevation.shape
    slope = np.full((rows, cols), np.nan, dtype=np.float32)

    # The Horn method requires a complete 3x3 neighbourhood.
    a = elevation[:-2, :-2]
    b = elevation[:-2, 1:-1]
    c = elevation[:-2, 2:]

    d = elevation[1:-1, :-2]
    f = elevation[1:-1, 2:]

    g = elevation[2:, :-2]
    h = elevation[2:, 1:-1]
    i = elevation[2:, 2:]

    valid = (
        np.isfinite(a) & np.isfinite(b) & np.isfinite(c)
        & np.isfinite(d) & np.isfinite(elevation[1:-1, 1:-1])
        & np.isfinite(f) & np.isfinite(g)
        & np.isfinite(h) & np.isfinite(i)
    )

    # Latitude at each output row's cell centre.
    center_rows = np.arange(1, rows - 1)
    latitudes = (
        elevation.shape[0] * 0  # Keeps this expression array-safe.
        + 0
    )

    # dy is constant for a geographic grid on a sphere.
    dy = np.deg2rad(dlat) * radius

    # dx changes with latitude.
    # The caller supplies the northern edge latitude separately below.
    # This placeholder is replaced by the latitude-aware calculation.
    return slope, valid


def calculate_slope_geographic(elevation, dlon, dlat, north, radius):
    """Horn slope with Mars spherical distance conversion."""

    rows, cols = elevation.shape
    slope = np.full((rows, cols), np.nan, dtype=np.float32)

    a = elevation[:-2, :-2]
    b = elevation[:-2, 1:-1]
    c = elevation[:-2, 2:]

    d = elevation[1:-1, :-2]
    center = elevation[1:-1, 1:-1]
    f = elevation[1:-1, 2:]

    g = elevation[2:, :-2]
    h = elevation[2:, 1:-1]
    i = elevation[2:, 2:]

    valid = (
        np.isfinite(a) & np.isfinite(b) & np.isfinite(c)
        & np.isfinite(d) & np.isfinite(center) & np.isfinite(f)
        & np.isfinite(g) & np.isfinite(h) & np.isfinite(i)
    )

    dzdx = (
        (c + 2 * f + i) - (a + 2 * d + g)
    ) / 8.0

    dzdy = (
        (a + 2 * b + c) - (g + 2 * h + i)
    ) / 8.0

    # Cell-centre latitude for every interior row.
    latitudes = north - (
        np.arange(1, rows - 1) + 0.5
    ) * dlat

    dx = (
        np.deg2rad(dlon)
        * radius
        * np.cos(np.deg2rad(latitudes))
    )

    dy = np.deg2rad(dlat) * radius

    gradient_x = dzdx / dx[:, None]
    gradient_y = dzdy / dy

    local_slope = np.degrees(
        np.arctan(np.hypot(gradient_x, gradient_y))
    )

    interior = slope[1:-1, 1:-1]
    interior[valid] = local_slope[valid]

    return slope


def load_top_discrepancies():
    records = []

    with CSV_PATH.open("r", newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        for record in reader:
            records.append({
                "row": int(record["row"]),
                "col": int(record["col"]),
                "difference": float(record["difference_deg"]),
                "absolute_difference": float(
                    record["absolute_difference_deg"]
                ),
            })

    return sorted(
        records,
        key=lambda item: item["absolute_difference"],
        reverse=True
    )[:20]


def cell_coordinates(record, meta):
    lon = meta["west"] + (
        record["col"] + 0.5
    ) * meta["dLon"]

    lat = meta["north"] - (
        record["row"] + 0.5
    ) * meta["dLat"]

    return lon, lat


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with META_PATH.open("r", encoding="utf-8") as file:
        meta = json.load(file)

    print("Loading production DEM...")

    coarse = np.fromfile(DEM_PATH, dtype=np.float32)

    expected = meta["rows"] * meta["cols"]

    if coarse.size != expected:
        raise ValueError(
            f"DEM contains {coarse.size} values; expected {expected}"
        )

    coarse = coarse.reshape(meta["rows"], meta["cols"])
    coarse[~np.isfinite(coarse)] = np.nan

    print("Opening original USGS DEM...")

    with rasterio.open(SOURCE_URL) as src:
        window = from_bounds(
            meta["west"],
            meta["north"] - meta["rows"] * meta["dLat"],
            meta["west"] + meta["cols"] * meta["dLon"],
            meta["north"],
            transform=src.transform,
        )

        window = window.round_offsets().round_lengths()

        fine = src.read(1, window=window).astype(np.float32)
        fine_transform = src.window_transform(window)

        fine[fine == src.nodata] = np.nan

        fine_west, fine_south, fine_east, fine_north = (
            array_bounds(
                fine.shape[0],
                fine.shape[1],
                fine_transform
            )
        )

        fine_dlon = abs(fine_transform.a)
        fine_dlat = abs(fine_transform.e)

    print("Fine DEM shape:", fine.shape)
    print("Coarse DEM shape:", coarse.shape)

    factor = 3

    if (
        fine.shape[0] != coarse.shape[0] * factor
        or fine.shape[1] != coarse.shape[1] * factor
    ):
        raise ValueError(
            "Fine DEM is not aligned as a 3x3 subdivision "
            "of the coarse DEM."
        )

    print("Calculating fine-resolution slope...")

    fine_slope = calculate_slope_geographic(
        fine,
        fine_dlon,
        fine_dlat,
        fine_north,
        meta["radiusM"],
    )

    print("Calculating coarse-resolution slope...")

    coarse_slope = calculate_slope_geographic(
        coarse,
        meta["dLon"],
        meta["dLat"],
        meta["north"],
        meta["radiusM"],
    )

    # Summarize the nine fine-resolution slope cells
    # belonging to each coarse-resolution cell.
    fine_blocks = fine_slope.reshape(
        coarse.shape[0], factor,
        coarse.shape[1], factor
    )

    fine_median = np.nanmedian(fine_blocks, axis=(1, 3))

    difference = coarse_slope - fine_median
    absolute_difference = np.abs(difference)

    top = load_top_discrepancies()

    extent = (
        meta["west"],
        meta["west"] + meta["cols"] * meta["dLon"],
        meta["north"] - meta["rows"] * meta["dLat"],
        meta["north"],
    )

    fine_extent = (
        fine_west,
        fine_east,
        fine_south,
        fine_north,
    )

    marker_lons = []
    marker_lats = []

    for record in top:
        lon, lat = cell_coordinates(record, meta)
        marker_lons.append(lon)
        marker_lats.append(lat)

    print("Creating diagnostic maps...")

    # --------------------------------------------------
    # FIGURE 1: Four-panel overview
    # --------------------------------------------------

    fig, axes = plt.subplots(2, 2, figsize=(15, 12))

    panels = [
        (
            axes[0, 0],
            fine_slope,
            fine_extent,
            "Original-resolution slope",
            "viridis",
            0,
            30,
        ),
        (
            axes[0, 1],
            coarse_slope,
            extent,
            "Coarse-resolution slope",
            "viridis",
            0,
            30,
        ),
        (
            axes[1, 0],
            difference,
            extent,
            "Coarse minus fine-median slope",
            "coolwarm",
            -10,
            10,
        ),
        (
            axes[1, 1],
            absolute_difference,
            extent,
            "Absolute slope difference",
            "magma",
            0,
            10,
        ),
    ]

    for ax, data, image_extent, title, cmap, vmin, vmax in panels:
        image = ax.imshow(
            data,
            extent=image_extent,
            origin="upper",
            cmap=cmap,
            vmin=vmin,
            vmax=vmax,
            interpolation="nearest",
        )

        ax.set_title(title)
        ax.set_xlabel("East longitude (degrees)")
        ax.set_ylabel("Latitude (degrees)")
        ax.set_aspect("equal")

        fig.colorbar(
            image,
            ax=ax,
            label="Slope difference (degrees)"
            if "difference" in title.lower()
            else "Slope (degrees)",
        )

        ax.scatter(
            marker_lons,
            marker_lats,
            marker="x",
            color="red",
            s=28,
            linewidths=1.2,
            label="Top 20 discrepancies",
        )

        ax.legend(loc="lower left", fontsize=8)

    fig.suptitle(
        "MarsCraft: DEM Slope Resolution Sensitivity",
        fontsize=16,
    )

    fig.tight_layout()

    overview_path = OUTPUT_DIR / "slope_validation_overview.png"
    fig.savefig(overview_path, dpi=200)
    plt.close(fig)

    # --------------------------------------------------
    # FIGURE 2: Close-up around the largest discrepancy
    # --------------------------------------------------

    strongest = top[0]

    center_row = strongest["row"]
    center_col = strongest["col"]

    # Show a 21 x 21 coarse-cell region.
    radius_cells = 10

    row_start = max(0, center_row - radius_cells)
    row_end = min(coarse.shape[0], center_row + radius_cells + 1)

    col_start = max(0, center_col - radius_cells)
    col_end = min(coarse.shape[1], center_col + radius_cells + 1)

    zoom_extent = (
        meta["west"] + col_start * meta["dLon"],
        meta["west"] + col_end * meta["dLon"],
        meta["north"] - row_end * meta["dLat"],
        meta["north"] - row_start * meta["dLat"],
    )

    zoom_difference = difference[
        row_start:row_end,
        col_start:col_end
    ]

    zoom_abs = absolute_difference[
        row_start:row_end,
        col_start:col_end
    ]

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    for ax, data, title, cmap, vmin, vmax in [
        (
            axes[0],
            zoom_difference,
            "Signed slope difference",
            "coolwarm",
            -20,
            20,
        ),
        (
            axes[1],
            zoom_abs,
            "Absolute slope difference",
            "magma",
            0,
            20,
        ),
    ]:
        image = ax.imshow(
            data,
            extent=zoom_extent,
            origin="upper",
            cmap=cmap,
            vmin=vmin,
            vmax=vmax,
            interpolation="nearest",
        )

        ax.set_title(title)
        ax.set_xlabel("East longitude (degrees)")
        ax.set_ylabel("Latitude (degrees)")
        ax.set_aspect("equal")

        fig.colorbar(image, ax=ax, label="Degrees")

        # Show the discrepancy locations inside this zoom.
        for record in top:
            if (
                row_start <= record["row"] < row_end
                and col_start <= record["col"] < col_end
            ):
                lon, lat = cell_coordinates(record, meta)
                ax.scatter(lon, lat, marker="x", color="cyan", s=55)

    fig.suptitle(
        f"Largest discrepancy near cell "
        f"({center_row}, {center_col})"
    )

    fig.tight_layout()

    zoom_path = OUTPUT_DIR / "largest_discrepancy_zoom.png"
    fig.savefig(zoom_path, dpi=200)
    plt.close(fig)

    print("\nFinished.")
    print("Overview:", overview_path)
    print("Zoom:", zoom_path)

    print("\nLargest discrepancy:")
    print(strongest)


if __name__ == "__main__":
    main()
