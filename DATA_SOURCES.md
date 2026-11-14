# Data sources

MarsCraft layers data from multiple NASA science missions. All parameters below are planning assumptions chosen for transparency.

## 1. Elevation (topographic)

| Field | Value |
|---|---|
| Product | HRSC+MOLA blended DEM v2 (Fergason, Hare & Laura 2018) |
| Source | USGS Astrogeology |
| URL | https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m |
| Processing | Cropped to ~74–79°E, 17–22°N, then 3×3 block-averaged to ~0.01° cells (~590 m) |
| Status | Loaded in `public/data/dem.bin` + `dem.meta.json` (`synthetic: false`) |

Limitations are listed in the meta file and in METHODOLOGY.md. Resolution cannot resolve boulders or small dunes.

## 2. Optical imagery

| Field | Value |
|---|---|
| Product | Viking MDIM 2.1 color mosaic, global, 232 m/pixel |
| Service | NASA Mars Trek WMTS |
| URL pattern | `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg` |
| Status | Verified 2026-11-14. The service publishes tile matrices 0–7 only; deeper zooms upscale level 7. Browser rendering does not require CORS access. |

## 2b. High-resolution optical imagery (CTX and HiRISE, Jezero)

| Field | CTX | HiRISE |
|---|---|---|
| Product | Controlled CTX orthomosaic of Jezero, about 6 m/pixel | Controlled HiRISE orthomosaic of Jezero, about 25 cm/pixel |
| Mission / instrument | Mars Reconnaissance Orbiter / CTX | Mars Reconnaissance Orbiter / HiRISE |
| Producer | USGS Astrogeology, for Mars 2020 Terrain Relative Navigation | Same |
| Trek layer | `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` |
| Tile matrices | 0–13 | 0–17 |
| Coverage | 77.160–77.699°E, 18.211–18.721°N | 77.223–77.584°E, 18.307–18.669°N |
| Status | Verified 2026-11-14 from the WMTS capabilities and sample tiles | Same |

These are the maps Mars 2020 used to land: Trek's catalogue describes the CTX mosaic as the Lander Vision System map and the HiRISE mosaic as the base on which landing hazards were mapped. They cover the demonstration EVA and the rover traverse. They are imagery only: MarsCraft does not derive slope or route cost from them. Tiles are requested only inside each layer's coverage box.

## 3. Thermal (THEMIS)

| Field | Value |
|---|---|
| Product | THEMIS Day IR and Night IR controlled mosaics, 100 m/pixel |
| Mission / instrument | Mars Odyssey / THEMIS (ASU / NASA) |
| Service | NASA Mars Trek WMTS |
| Day URL | `.../THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png` |
| Night URL | `.../THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png` |
| Status | Verified 2026-11-14. Capabilities XML and sample tiles return 200. |

Day IR: brighter ≈ warmer surface. Night IR: high thermal inertia materials (rock, bedrock) remain warmer overnight. Useful for distinguishing rocky vs dusty surfaces that affect mobility and landing safety. When a CTX or HiRISE layer is on, THEMIS is drawn at 55% opacity above it so thermal brightness and optical detail read together.

## 4. Spectral / mineral (CRISM)

| Field | Value |
|---|---|
| Product | PIA23380 — Jezero crater mineral distribution |
| Instruments | CRISM + CTX on Mars Reconnaissance Orbiter |
| Credit | NASA/JPL-Caltech/MSSS/JHU-APL/Purdue/USGS |
| Local file | `public/data/crism_jezero_minerals.png` + meta |
| Bounds (approx.) | 76.95–78.35°E, 17.95–19.05°N (approximate; publication figure) |
| Interpretation | Green ≈ carbonates; red ≈ olivine sand eroding from carbonate-bearing rocks |

Geographic bounds are approximate, matched visually to crater morphology for planning context. This is a qualitative colour composite, not a quantitative abundance map. Coverage is limited to the immediate Jezero region. The figure is composited over the imagery in colour-only blend mode, so its mineral hues tint the CTX or HiRISE detail instead of its own lower-resolution base image covering it; against the sharper imagery the approximate georeference is more noticeable.

## 5. Scientific points of interest

`public/data/pois.json` — four literature-sourced points (Jezero crater, Perseverance landing site, western delta, Nili Fossae). Each record cites published findings (Ehlmann et al. 2008, Goudge et al. 2015, Hoefen et al. 2003, NASA Mars 2020 docs). Coordinates are approximate and should be checked against the IAU Gazetteer.

## Challenge resources and integration status

These challenge-supplied references are linked in the app's Mission overview, under "NASA data in this view". A link does not imply that its data are integrated:

| Resource | Use in MarsCraft |
|---|---|
| [JPL Mars Trek](https://trek.nasa.gov/mars/) | Serves the Viking, CTX and HiRISE optical layers and the THEMIS thermal layers. |
| [USGS–NASA Planetary Geologic Mapping Program](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) | Reference only; geologic map data are not currently integrated. |
| [Curiosity's proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) | Route-planning inspiration; it is a different mission and region. |
| [Perseverance raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/) | Queried live for Left Navcam frames from the rover stop nearest a selected point (section 8). Two credited context stills are also bundled. |
| [NASA Worldview](https://worldview.earthdata.nasa.gov/) | Earth observation viewer; it is not a Mars dataset and is not integrated. |

MarsCraft's active data products and provenance are described in the numbered sections. No quantitative geologic-map layer and no measured radiation feed is included.


## 6. HiRISE footprints (high-resolution optical context)

| Field | Value |
|---|---|
| Product | Approximate observation footprints near Perseverance landing and Jezero delta |
| Instrument | HiRISE on Mars Reconnaissance Orbiter (UArizona / NASA) |
| Local file | `public/data/hirise_footprints.json` |
| Status | Context boxes only — full ~25–50 cm tiles are not loaded in the browser |

Footprints are simplified rectangles around published centres (e.g. ESP_073912_1985). They show where boulder-scale imagery exists so a crew can expect detailed surface context at science stops. They are not survey-grade PDS polygons. The HiRISE orthomosaic in section 2b is actual imagery; this layer is off by default.

## 7. Perseverance traverse and stops (in situ)

| Field | Value |
|---|---|
| Product | Rover traverse path and end-of-drive localizations |
| Mission | Mars 2020 / Perseverance (NASA/JPL-Caltech) |
| Source | Mission location map layers: `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json` and `M20_waypoints.json` |
| Local file | `public/data/m20_traverse.json`, written by `npm run data:context` |
| Snapshot | Retrieved 2026-11-14: 45.2 km driven to sol 2022, 554 end-of-drive stops |
| Processing | Drives joined into polylines; Douglas–Peucker simplification at 1.5 m (36,661 points to 2,204). Stop values are copied as published. |

Each stop carries the sol, site and drive index, position, rover-reported elevation relative to the areoid, rover tilt and cumulative distance. The app draws the path, and for a selected location within 1 km of a stop shows the rover's elevation and tilt beside the grid's elevation and slope. In the planner, stops inside the cells a route crosses feed the "Rover ground truth" check. Rover tilt is a metre-scale attitude, not a terrain slope product; see METHODOLOGY.md.

## 8. Rover camera views (in situ, live)

| Field | Value |
|---|---|
| Product | Left Navigation Camera raw frames |
| Service | Mars 2020 raw-image API, `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020` filtered to one sol and `NAVCAM_LEFT`, full frames |
| Status | Verified 2026-11-14 in a browser (CORS `*`). Live only; nothing is bundled. |

Requested when the user asks for views at a rover stop. Frames taken at the stop's site index are listed first; others are labelled as taken elsewhere on that sol. Thumbnails link to each frame's NASA archive page. Camera pointing is not interpreted, so no compass direction is claimed.

## 9. Surface weather (atmospheric)

| Field | Value |
|---|---|
| Product | Daily air temperature (min/max, °C), pressure (Pa), sunrise and sunset (local mean solar time), solar longitude and season |
| Mission / instrument | Mars 2020 / MEDA (NASA/JPL-Caltech, CAB CSIC-INTA) |
| Service | `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json` |
| Fallback | `public/data/meda_snapshot.json` |
| Status | Reachable 2026-11-14, but the feed's newest sol is 1133 (2024-04-27). |

Because the public feed is no longer updated, the app labels any report older than 14 days as an archived seasonal reference and never presents it as today's weather. Values the feed marks `--` are shown as "not reported"; the most recent sol that did report is used and named. Today's season and day length are computed instead (METHODOLOGY.md) and checked against this feed's own solar longitude and sunrise/sunset values in the test suite.

## 10. Space weather

| Field | Value |
|---|---|
| Product | WSA-ENLIL+Cone simulation results listing predicted CME arrival at Mars |
| Source | NASA CCMC DONKI, `https://api.nasa.gov/DONKI/WSAEnlilSimulations` (30-day window) |
| Upstream observations | Coronagraph CME measurements (SOHO, STEREO-A) that drive the model |
| Fallback | Browser cache for one hour, then `public/data/space_weather_snapshot.json` |
| Status | Verified 2026-11-14: 57 simulations in the window, 13 with a Mars arrival (10 after keeping the latest run per CME) |

DONKI's `impactList` names Mars explicitly, which makes this a Mars-specific product rather than an Earth forecast reused. It is model output: arrival times carry errors of roughly half a day, and an arrival is not a radiation dose. The app shows the level, each arrival with a link to its model run, the data's origin and age, and treats a "quiet" reading from data older than 24 hours as unknown. The request uses NASA's shared `DEMO_KEY` unless `VITE_NASA_API_KEY` is set.

## 11. Radiation reference

Curiosity RAD surface dose rates at Gale crater (Hassler et al. 2014): about 0.21 mGy/day absorbed and 0.64 mSv/day dose equivalent. A published figure, not a feed, and not measured at Jezero. The planner scales the daily dose equivalent linearly to the EVA duration as an order-of-magnitude note.
