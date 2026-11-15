Live deployed app: https://marscraft-five.vercel.app/

# MarsCraft

A terrain-aware exploration planning prototype for human exploration of Mars, built for the 2026 NASA Space Apps Challenge ("Interplanetary Survival Guide: Martian Map"). It is an independent project and is not endorsed by NASA.

**Status:** Real HRSC+MOLA DEM for the Jezero region is loaded. Optical (Viking, CTX 6 m, HiRISE 25 cm), thermal (THEMIS), spectral (CRISM), in-situ (Perseverance traverse and Navcam), atmospheric (MEDA) and space-weather (DONKI) data are layered in. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) and [DATA_SOURCES.md](DATA_SOURCES.md).

**Submission framing:** This is a research/planning prototype, not operational astronaut navigation software. The demo combines a regional topographic grid, high-resolution optical context, thermal and mineral context, the path a NASA rover actually drove, current-conditions feeds, science stops, terrain-cost route alternatives and a set of pre-EVA planning checks. Routing runs on the ~590 m grid only: the high-resolution imagery is for the crew to inspect a route, not an input to the planner. Geologic-map units are not integrated. See [DATA_SOURCES.md](DATA_SOURCES.md) for NASA challenge references and integration status.

## Problem

Planning surface traverses needs terrain, science targets, current conditions and route trade-offs in one view. MarsCraft joins them over a shared grid and selection.

## Modules

1. **Mars Explorer.** Leaflet map in a plate carree frame with switchable multi-mission layers: Viking optical, CTX and HiRISE orthomosaics of Jezero, THEMIS Day/Night IR (thermal, blended over the imagery), CRISM mineral signatures (spectral, blended as colour over the imagery), the Perseverance traverse (in situ), elevation, slope, slope class, points of interest and routes. Legends, cursor coordinates, scale bar and source attribution. The view opens on Jezero and zooms to boulder scale.
2. **Terrain Intelligence.** Slope computed from elevation with Horn's method in metres, a three-class scheme with an explicit Unknown class, and per-location readout. Missing data stays unknown and is never read as safe. Where Perseverance stopped nearby, its own elevation and tilt are shown beside the grid values, with its camera frames from that sol.
3. **Scientific Discovery.** Four literature-sourced points with category, reported observations, instrument, source and caveats. Points can be added as route waypoints.
4. **Current conditions.** Season and day length computed for today at the EVA site; the latest public MEDA surface-weather report; CME arrivals at Mars predicted by the WSA-ENLIL model in NASA DONKI. Each feed is labelled live, cached or offline snapshot.
5. **Mission scenario.** One demonstration Marswalk (Jezero Delta Margin EVA) with science objective, habitat proxy, waypoints, EVA budget and Cautious defaults.
6. **Marswalk Planner.** A* routing under three documented cost profiles, side-by-side comparison on a common reference cost, generated explanations, pre-EVA planning checks (time budget, daylight, space weather, slope, rover ground truth, data gaps), elevation and slope profiles that trace the route on the map, a Cautious-profile walk-back reachability overlay, GeoJSON export and summary download.

## Navigation

Three workspaces (Mission overview, Mars explorer, Mission planner) share one map and one mission state. The workspace is in the URL (`#/overview`, `#/explorer`, `#/planner`), so views can be linked and reloaded and the browser's Back and Forward buttons work. Keys `1`, `2`, `3` switch workspace. Each navigation entry shows live status (layers on, stops set, route length and check tally).

## Stack

React, TypeScript, Vite, Leaflet, Vitest. No backend. Data preparation is a Python script (rasterio, numpy) plus a Node script for the NASA context snapshots. Scientific code lives in `src/core` with no UI dependencies.

## Run

Needs Node.js 20.19 or later.

```bash
npm install
npm run dev              # http://localhost:5173
npm test
npm run build
```

The checked-in DEM is the real HRSC+MOLA Jezero grid, so no data-generation step is needed for normal development. `npm run data:synthetic` replaces it with generated terrain that is not Mars data; use that only when intentionally testing synthetic-terrain behavior.

Real data (needs internet, `pip install rasterio numpy`):

```bash
npm run data:real                       # crops 74-79 E, 17-22 N from the USGS file
python3 scripts/prepare_dem.py --west 74 --east 79 --south 17 --north 22 --cell 0.01
npm run data:context                    # refreshes the rover traverse, MEDA and DONKI snapshots
node scripts/validate_rover_ground_truth.mjs   # DEM vs rover cross-check
```

After swapping data, the planner and legends update automatically. The terrain-source tags in the interface follow `synthetic` in `public/data/dem.meta.json`.

**NASA API key.** Space weather is requested from `api.nasa.gov` with NASA's shared `DEMO_KEY`, which is limited to about 30 requests an hour and 50 a day per IP address. Responses are cached in the browser for an hour and the bundled snapshot is used when the request fails. For a demo on a shared network, get a free key at <https://api.nasa.gov> and put `VITE_NASA_API_KEY=your_key` in a `.env` file (git-ignored) before `npm run dev` or `npm run build`.

**Offline behaviour.** Topography, slope, the CRISM figure, the rover traverse and the feed snapshots are bundled. Without network access the imagery layers and rover camera views are unavailable, and the conditions panel says it is showing snapshots.

## Layout

```
src/core/      grid, slope and classes, routing, renderers, Mars season and
               day length, conditions and pre-EVA checks, rover lookup (tested)
src/App.tsx    workspaces and state     src/MapView.tsx   Leaflet map
src/panels.tsx conditions, checks, rover ground truth, data inventory
src/nasa.ts    NASA feed loaders with cache and snapshot fallback
src/config.ts  layer configuration
public/data/   dem.bin, dem.meta.json, pois.json, m20_traverse.json, feed snapshots
scripts/       prepare_dem.py, make_synthetic_dem.mjs, fetch_nasa_context.mjs, validation
```

## Documents

- [DATA_SOURCES.md](DATA_SOURCES.md): every dataset, provenance and status.
- [METHODOLOGY.md](METHODOLOGY.md): slope, classes, cost model, A*, comparison, conditions, checks, assumptions.
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md): what was tested and what was not.

## Attribution

Elevation: MOLA (NASA / Mars Global Surveyor) and HRSC (ESA / Mars Express), blended by USGS Astrogeology (Fergason, Hare and Laura, 2018) — **loaded as the working DEM** for Jezero. Imagery via NASA Mars Trek when the network allows: Viking MDIM 2.1 (NASA/JPL/USGS), CTX and HiRISE Jezero orthomosaics (NASA/JPL-Caltech/MSSS, University of Arizona, USGS), THEMIS Day/Night IR (NASA/JPL-Caltech/ASU). CRISM mineral context: PIA23380 figure. Rover traverse and camera frames: NASA/JPL-Caltech. Surface weather: Mars 2020 MEDA. Space weather: NASA CCMC DONKI. See DATA_SOURCES.md.

## Known limitations

- Cost parameters are planning assumptions, not validated mobility data; slope bins are not safety limits.
- About 590 m cells cannot capture boulders, small craters or soft ground. Against Perseverance's own measurements the grid elevation agrees to about 27 m RMSE, but rover tilt exceeded the grid slope at 80% of 554 stops (see METHODOLOGY.md). Routes are not obstacle-aware at walking scale.
- The speed input is a user assumption and ignores slope.
- Slope and elevation come only from the DEM; imagery, thermal and mineral layers are visual context and do not enter the route cost.
- The public MEDA feed stopped updating in April 2024; it is shown as an archived seasonal reference.
- Space weather is model-predicted CME arrival, not measured radiation, and is not a dose forecast.
- POI coordinates are approximate and require verification.
