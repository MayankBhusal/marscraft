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
| Status | Verified 2026-11-14. Sample tiles return 200; browser rendering does not require CORS access. |

## 3. Thermal (THEMIS)

| Field | Value |
|---|---|
| Product | THEMIS Day IR and Night IR controlled mosaics, 100 m/pixel |
| Mission / instrument | Mars Odyssey / THEMIS (ASU / NASA) |
| Service | NASA Mars Trek WMTS |
| Day URL | `.../THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png` |
| Night URL | `.../THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png` |
| Status | Verified 2026-11-14. Capabilities XML and sample tiles return 200. |

Day IR: brighter ≈ warmer surface. Night IR: high thermal inertia materials (rock, bedrock) remain warmer overnight. Useful for distinguishing rocky vs dusty surfaces that affect mobility and landing safety.

## 4. Spectral / mineral (CRISM)

| Field | Value |
|---|---|
| Product | PIA23380 — Jezero crater mineral distribution |
| Instruments | CRISM + CTX on Mars Reconnaissance Orbiter |
| Credit | NASA/JPL-Caltech/MSSS/JHU-APL/Purdue/USGS |
| Local file | `public/data/crism_jezero_minerals.png` + meta |
| Bounds (approx.) | 76.95–78.35°E, 17.95–19.05°N (approximate; publication figure) |
| Interpretation | Green ≈ carbonates; red ≈ olivine sand eroding from carbonate-bearing rocks |

Geographic bounds are approximate, matched visually to crater morphology for planning context. This is a qualitative colour composite, not a quantitative abundance map. Coverage is limited to the immediate Jezero region.

## 5. Scientific points of interest

`public/data/pois.json` — four literature-sourced points (Jezero crater, Perseverance landing site, western delta, Nili Fossae). Each record cites published findings (Ehlmann et al. 2008, Goudge et al. 2015, Hoefen et al. 2003, NASA Mars 2020 docs). Coordinates are approximate and should be checked against the IAU Gazetteer.

## Challenge resources and integration status

These challenge-supplied references are linked in the app's Mission overview. A link does not imply that its data are integrated:

| Resource | Use in MarsCraft |
|---|---|
| [JPL Mars Trek](https://trek.nasa.gov/mars/) | Serves the active Viking optical and THEMIS thermal basemaps. |
| [USGS–NASA Planetary Geologic Mapping Program](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) | Reference only; geologic map data are not currently integrated. |
| [Curiosity's proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) | Route-planning inspiration; it is a different mission and region. |
| [Perseverance raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/) | Mission archive reference; the app currently shows two credited, local context images rather than querying the live archive. |
| [NASA Worldview](https://worldview.earthdata.nasa.gov/) | Earth observation viewer; it is not a Mars dataset and is not integrated. |

MarsCraft's active data products and provenance are described above. No live radiation or space-weather feed, quantitative geologic-map layer, or live raw-image search is included.


## 6. HiRISE footprints (high-resolution optical context)

| Field | Value |
|---|---|
| Product | Approximate observation footprints near Perseverance landing and Jezero delta |
| Instrument | HiRISE on Mars Reconnaissance Orbiter (UArizona / NASA) |
| Local file | `public/data/hirise_footprints.json` |
| Status | Context boxes only — full ~25–50 cm tiles are not loaded in the browser |

Footprints are simplified rectangles around published centres (e.g. ESP_073912_1985). They show where boulder-scale imagery exists so a crew can expect detailed surface context at science stops. They are not survey-grade PDS polygons.
