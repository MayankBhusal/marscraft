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
  /** Coverage from the layer's WMTS capabilities; tiles outside it are not requested. */
  bounds?: { west: number; east: number; south: number; north: number };
}

/** Viking optical basemap (default). The service publishes tile matrices 0-7 only. */
export const BASEMAP: TrekLayer = {
  id: "viking",
  name: "Viking MDIM 2.1 color mosaic",
  attribution: "Viking MDIM 2.1: NASA/JPL/USGS",
  url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
  zoomOffset: 0,
  minZoom: 1,
  maxNativeZoom: 7,
  note: "Optical surface context (visible wavelengths).",
};

/**
 * Controlled CTX orthomosaic of Jezero (about 6 m/pixel), produced by USGS
 * Astrogeology for Mars 2020 Terrain Relative Navigation.
 */
export const CTX_JEZERO: TrekLayer = {
  id: "ctx-jezero",
  name: "CTX orthomosaic, Jezero (6 m)",
  attribution: "CTX: NASA/JPL-Caltech/MSSS/USGS",
  url: "https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/default/default028mm/{z}/{y}/{x}.png",
  zoomOffset: 0,
  minZoom: 1,
  maxNativeZoom: 13,
  note: "Visible imagery at about 6 m/pixel: scarps, dune fields and craters at traverse scale.",
  bounds: { west: 77.1604655, east: 77.6991776, south: 18.2110274, north: 18.7211945 },
};

/** Controlled HiRISE orthomosaic of Jezero (about 25 cm/pixel), same USGS product family. */
export const HIRISE_JEZERO: TrekLayer = {
  id: "hirise-jezero",
  name: "HiRISE orthomosaic, Jezero (25 cm)",
  attribution: "HiRISE: NASA/JPL-Caltech/UArizona/USGS",
  url: "https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png",
  zoomOffset: 0,
  minZoom: 1,
  maxNativeZoom: 17,
  note: "Visible imagery at about 25 cm/pixel: individual boulders and outcrops.",
  bounds: { west: 77.2229331, east: 77.583964, south: 18.3067994, north: 18.669315 },
};

/** THEMIS infrared is drawn at this opacity when it sits over the high-resolution imagery. */
export const THERMAL_BLEND_OPACITY = 0.55;

/** THEMIS daytime infrared — thermal. */
export const THEMIS_DAY: TrekLayer = {
  id: "themis-day",
  name: "THEMIS Day IR (100 m controlled mosaic)",
  attribution: "THEMIS: NASA/JPL-Caltech/ASU",
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
  attribution: "THEMIS: NASA/JPL-Caltech/ASU",
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
  attribution: "CRISM: NASA/JPL-Caltech/MSSS/JHU-APL/Purdue/USGS (PIA23380)",
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

/** Opening map view: Jezero crater, its western delta and the rover traverse. */
export const JEZERO_VIEW = { west: 77.12, east: 77.98, south: 18.05, north: 18.78 } as const;
/** Latitude used for day length when no start point is set (Octavia E. Butler Landing). */
export const DEFAULT_SITE_LAT = 18.44;
/** A rover stop is offered as ground truth when it lies within this distance of the selected cell centre. */
export const ROVER_NEAR_M = 1000;

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
    "Solar particle events can raise dose rates by orders of magnitude for hours to days. This tool lists predicted CME arrivals at Mars but does not forecast particle dose.",
  /** What the planner does and does not model. */
  modelled: [
    "Elevation and derived slope from the working DEM",
    "Missing data treated as unknown (never assumed safe)",
    "Route cost profiles that penalise or exclude steep / unknown cells",
    "Day length for the EVA site and date (geometric)",
    "Predicted CME arrivals at Mars from NASA DONKI (model output)",
  ],
  notModelled: [
    "Surface roughness, rock abundance, or soil strength",
    "Terrain shadowing, dust opacity, or thermal load on the suit",
    "Line-of-sight, communications, or suit mobility limits",
    "Radiation dose during a solar particle event",
  ],
} as const;
