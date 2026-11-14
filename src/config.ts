/**
 * Layer and basemap configuration for MarsCraft.
 *
 * Trek WMTS endpoints were verified live (2026-11-14). Tile URLs use the
 * RESTful pattern documented by NASA Mars Trek:
 *   https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/{Style}/{TileMatrixSet}/{z}/{y}/{x}.{ext}
 * Leaflet EPSG:4326 zoom 0 already has the WMTS level 0 matrix (2×1 tiles).
 * Keep the zoom offset at 0 so matrix indices and tile coordinates stay aligned.
 */

export interface TrekLayer {
  id: string;
  name: string;
  attribution: string;
  url: string;
  zoomOffset: number;
  minZoom: number;
  maxNativeZoom: number;
  /** Brief science context shown in the UI. */
  note: string;
}

/** Viking optical basemap (default). */
export const BASEMAP: TrekLayer = {
  id: "viking",
  name: "Viking MDIM 2.1 color mosaic",
  attribution: "Imagery: NASA/JPL/USGS Viking MDIM 2.1 via NASA Mars Trek",
  url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
  zoomOffset: 0,
  minZoom: 1,
  maxNativeZoom: 8,
  note: "Optical surface context (visible wavelengths).",
};

/** THEMIS daytime infrared — thermal. */
export const THEMIS_DAY: TrekLayer = {
  id: "themis-day",
  name: "THEMIS Day IR (100 m controlled mosaic)",
  attribution: "Thermal: NASA/JPL/ASU THEMIS Day IR controlled mosaic via NASA Mars Trek",
  url: "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png",
  zoomOffset: 0,
  minZoom: 1,
  maxNativeZoom: 9,
  note: "Daytime thermal infrared. Brighter = warmer surface. Sensitive to rock abundance and thermal inertia.",
};

/** THEMIS nighttime infrared — thermal. */
export const THEMIS_NIGHT: TrekLayer = {
  id: "themis-night",
  name: "THEMIS Night IR (100 m controlled mosaic)",
  attribution: "Thermal: NASA/JPL/ASU THEMIS Night IR controlled mosaic via NASA Mars Trek",
  url: "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{z}/{y}/{x}.png",
  zoomOffset: 0,
  minZoom: 1,
  maxNativeZoom: 9,
  note: "Nighttime thermal infrared. High thermal inertia (rocky) areas stay warmer at night.",
};

/**
 * CRISM-derived mineral colour overlay for Jezero crater (PIA23380).
 * Bounds are approximate, matched to crater morphology for planning context.
 */
export const CRISM_MINERALS = {
  id: "crism-minerals",
  name: "CRISM mineral signatures (Jezero)",
  attribution: "Minerals: NASA/JPL-Caltech/MSSS/JHU-APL/Purdue/USGS (PIA23380)",
  url: "data/crism_jezero_minerals.png",
  bounds: {
    // Tightened to Jezero crater + western delta / rim (approx.).
    // Source PNG is a publication figure with its own basemap; alignment is qualitative.
    west: 76.95,
    east: 78.35,
    south: 17.95,
    north: 19.05,
  } as const,
  note: "Green ≈ carbonates; red ≈ olivine. Qualitative spectral indicators, not abundance.",
};

export const MARS_RADIUS_M = 3396190;
export const POI_CORRIDOR_KM = 3;
export const DEFAULT_SPEED_KMH = 2;

/**
 * Safety context shown in the UI. These are published order-of-magnitude
 * figures for crew awareness, not operational limits or medical advice.
 * Sources: Hassler et al. 2014 (Curiosity RAD), NASA Human Research Program
 * summaries of Mars surface radiation environment.
 */
export const SAFETY = {
  /**
   * GCR absorbed dose rate ~0.21 mGy/day (Curiosity RAD, Gale crater).
   * Dose equivalent ~0.64 mSv/day. Do not mix the units.
   * Order-of-magnitude context only; not Jezero-specific or operational limits.
   * Hassler et al. 2014, Science.
   */
  gcrDoseMgyPerDay: 0.21,
  gcrDoseMsvPerDay: 0.64,
  radiationNote:
    "Curiosity RAD at Gale: ~0.21 mGy/day absorbed GCR, ~0.64 mSv/day dose equivalent (Hassler et al. 2014). Not measured at Jezero; quiet-sun order of magnitude only.",
  /** Short note on solar particle events. */
  speNote:
    "Solar particle events can raise dose rates by orders of magnitude for hours to days. No real-time SPE forecast is included in this tool.",
  /** What the planner does and does not model. */
  modelled: [
    "Elevation and derived slope from the working DEM",
    "Missing data treated as unknown (never assumed safe)",
    "Route cost profiles that penalise or exclude steep / unknown cells",
  ],
  notModelled: [
    "Surface roughness, rock abundance, or soil strength",
    "Illumination, shadows, or thermal extremes on the suit",
    "Line-of-sight, dust, or suit mobility limits",
    "Real-time radiation or space-weather alerts",
  ],
} as const;
