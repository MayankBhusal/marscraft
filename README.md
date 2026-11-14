# MarsCraft

A terrain-aware exploration planning prototype for human exploration of Mars, built for the 2026 NASA Space Apps Challenge ("Interplanetary Survival Guide: Martian Map"). It is an independent project and is not endorsed by NASA.

**Status:** Real HRSC+MOLA DEM for the Jezero region is loaded. Optical, thermal (THEMIS) and spectral (CRISM) layers are available. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) and [DATA_SOURCES.md](DATA_SOURCES.md).

**Submission framing:** This is a research/planning prototype, not operational astronaut navigation software. The demo combines a regional topographic grid, optical/thermal context, qualitative orbital mineral context, science stops, and terrain-cost route alternatives. Geologic-map overlays, live radiation/space-weather, and live rover-image search are not integrated; see [DATA_SOURCES.md](DATA_SOURCES.md) for NASA challenge references and integration status.

## Problem

Planning surface traverses needs terrain, science targets and route trade-offs in one view. MarsCraft joins them over a shared grid and selection.

## Modules

1. **Mars Explorer.** Leaflet map in a plate carree frame with switchable multi-mission layers: Viking optical, THEMIS Day/Night IR (thermal), CRISM mineral signatures (spectral), HiRISE footprints (high-res context), elevation, slope, slope class, points of interest and routes. Legends, cursor coordinates, scale bar and source attribution.
2. **Terrain Intelligence.** Slope computed from elevation with Horn's method in metres, a three-class scheme with an explicit Unknown class, and per-location readout. Missing data stays unknown and is never read as safe.
3. **Scientific Discovery.** Four literature-sourced points with category, reported observations, instrument, source and caveats. Points can be added as route waypoints.
4. **Mission scenario.** One demonstration Marswalk (Jezero Delta Margin EVA) with science objective, habitat proxy, waypoints, EVA budget and Cautious defaults.
5. **Marswalk Planner.** A* routing under three documented cost profiles, side-by-side comparison on a common reference cost, generated explanations, mission summary, GeoJSON export and summary download.

## Stack

React, TypeScript, Vite, Leaflet, Vitest. No backend. Data preparation is a Python script (rasterio, numpy). Scientific code lives in `src/core` with no UI dependencies.

## Run

```bash
npm install
npm run data:synthetic   # development grid, already generated in the repo
npm run dev              # http://localhost:5173
npm test
npm run build
```

Real data (needs internet, `pip install rasterio numpy`):

```bash
npm run data:real                       # crops 74-79 E, 17-22 N from the USGS file
python3 scripts/prepare_dem.py --west 74 --east 79 --south 17 --north 22 --cell 0.01
```

After swapping data, the planner and legends update automatically. The terrain-source tags in the interface follow `synthetic` in `public/data/dem.meta.json`.

## Layout

```
src/core/      grid, slope and classes, routing, canvas renderers (tested)
src/App.tsx    panels and state     src/MapView.tsx   Leaflet map
src/config.ts  basemap configuration
public/data/   dem.bin, dem.meta.json, pois.json
scripts/       prepare_dem.py, make_synthetic_dem.mjs
```

## Documents

- [DATA_SOURCES.md](DATA_SOURCES.md): every dataset, provenance and status.
- [METHODOLOGY.md](METHODOLOGY.md): slope, classes, cost model, A*, comparison, assumptions.
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md): what was tested and what was not.

## Attribution

Elevation: MOLA (NASA / Mars Global Surveyor) and HRSC (ESA / Mars Express), blended by USGS Astrogeology (Fergason, Hare and Laura, 2018) — **loaded as the working DEM** for Jezero. Imagery: Viking MDIM 2.1 and THEMIS Day/Night IR via NASA Mars Trek when the network allows; local elevation/slope/class previews always available. CRISM mineral context: PIA23380 figure. See DATA_SOURCES.md.

## Known limitations

- Cost parameters are planning assumptions, not validated mobility data; slope bins are not safety limits.
- About 590 m cells cannot capture boulders, small craters or soft ground.
- The speed input is a user assumption and ignores slope.
- Slope and elevation come only from the DEM; no roughness, thermal or mineral rasters are used.
- POI coordinates are approximate and require verification.
