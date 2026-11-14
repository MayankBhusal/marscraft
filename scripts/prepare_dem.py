#!/usr/bin/env python3
"""
Crop a regional elevation grid from the USGS HRSC+MOLA blended DEM (200 m/pixel)
and write the files MarsCraft loads: public/data/dem.bin + dem.meta.json.

Source (verified via the USGS Astrogeology catalogue record):
  https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m
  https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif
The global file is about 11 GB. This script reads only the requested window
through GDAL's /vsicurl, so run it on a machine with open internet access
(the MarsCraft build sandbox blocked this host). Alternatively pass --tif with
a local copy.

Requires: pip install rasterio numpy

Processing:
  1. Windowed read of the requested bounding box (no reprojection: the source
     is already a simple cylindrical Mars raster, planetocentric lat, east+ lon).
  2. Block-average to the target cell size (default 0.01 deg, about 590 m) using
     only valid pixels. A block with fewer than --min-valid valid pixels stays NaN.
  3. Write float32 little-endian, row 0 = north, NaN = missing.
"""
import argparse, json, math, os, sys
import numpy as np
import rasterio
from rasterio.windows import from_bounds

URL = "/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
RADIUS_M = 3396190.0  # sphere radius stated in the USGS product label

ap = argparse.ArgumentParser()
ap.add_argument("--tif", default=URL)
ap.add_argument("--west", type=float, default=74.0)
ap.add_argument("--east", type=float, default=79.0)
ap.add_argument("--south", type=float, default=17.0)
ap.add_argument("--north", type=float, default=22.0)
ap.add_argument("--cell", type=float, default=0.01, help="output cell size, degrees")
ap.add_argument("--min-valid", type=float, default=0.5)
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "data"))
a = ap.parse_args()

with rasterio.open(a.tif) as ds:
    print("CRS:", ds.crs, "res:", ds.res, "nodata:", ds.nodata, "dtype:", ds.dtypes[0], file=sys.stderr)
    # Source longitudes may be 0..360 or -180..180; check the dataset bounds.
    west, east = a.west, a.east
    if ds.bounds.left >= 0 and west < 0:
        west, east = west % 360, east % 360
    
# Calculate the requested geographic window.
    win = from_bounds(west, a.south, east, a.north, ds.transform)

# Align the window to actual source pixel boundaries.
# This ensures the raster read and its affine transform agree.
    win = win.round_offsets().round_lengths()

# Read the integer-aligned window.
    arr = ds.read(1, window=win, masked=True).astype("float64")
    arr = np.ma.filled(arr, np.nan)

# Obtain the transform of the actual pixels read.
    wtrans = ds.window_transform(win)

    print("Aligned source window:", win, file=sys.stderr)
    print("Actual source origin:", wtrans.c, wtrans.f, file=sys.stderr)
    print("Actual source resolution:", wtrans.a, wtrans.e, file=sys.stderr)
    print("Actual array shape:", arr.shape, file=sys.stderr)


px_deg = abs(wtrans.a)
k = max(1, round(a.cell / px_deg))
rows = arr.shape[0] // k
cols = arr.shape[1] // k
blocks = arr[: rows * k, : cols * k].reshape(rows, k, cols, k)
valid = np.isfinite(blocks)
frac = valid.mean(axis=(1, 3))
sums = np.where(valid, blocks, 0).sum(axis=(1, 3))
cnt = np.maximum(valid.sum(axis=(1, 3)), 1)
out = np.where(frac >= a.min_valid, sums / cnt, np.nan).astype("<f4")

cell = k * px_deg
meta = {
    "id": "mola-hrsc-blend-200m-crop",
    "title": "HRSC+MOLA blended DEM v2, block-averaged crop",
    "synthetic": False,
    "source": "USGS Astrogeology; MOLA (Mars Global Surveyor, NASA) blended with HRSC (Mars Express, ESA). Fergason, Hare & Laura (2018).",
    "sourceUrl": "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m",
    "radiusM": RADIUS_M,
    "rows": int(rows), "cols": int(cols),
    "west": float(wtrans.c),
    "north": float(wtrans.f),
    "dLon": float(cell), "dLat": float(cell),
    "elevationUnit": "m",
    "processing": [
       f"Requested bbox W{a.west} E{a.east} S{a.south} N{a.north} deg.",
       f"Actual aligned origin: W{wtrans.c:.12f}, N{wtrans.f:.12f}.",
    ],
    "limitations": [
        "Blended product: USGS notes the HRSC-on-MOLA blend did not always work well; use care for scientific analysis.",
        "Averaging smooths relief, so slopes computed from this grid underestimate local steepness at the 200 m scale.",
        "Elevation is relative to the Mars datum used by the product, not a measured terrain-height uncertainty.",
    ],
}
os.makedirs(a.out, exist_ok=True)
out.tofile(os.path.join(a.out, "dem.bin"))
with open(os.path.join(a.out, "dem.meta.json"), "w") as f:
    json.dump(meta, f, indent=2)
print(f"wrote {rows}x{cols} grid, elevation {np.nanmin(out):.0f}..{np.nanmax(out):.0f} m, missing {np.isnan(out).mean():.1%}")
