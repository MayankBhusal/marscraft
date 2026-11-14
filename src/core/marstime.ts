/**
 * Mars solar longitude (Ls) and day length.
 *
 * Ls follows the "Mars24" algorithm of Allison & McEwen (2000), Planetary and
 * Space Science 48, 215-235, without the planetary perturbation terms (their
 * combined effect is below 0.1 deg). Day length is purely geometric: a flat
 * horizon with no refraction, dust or terrain shadowing.
 *
 * Both are checked against the Mars 2020 MEDA feed in conditions.test.ts.
 */

const RAD = Math.PI / 180;

/** Mean solar day on Mars, in SI seconds. */
export const SOL_SECONDS = 88775.244;
/** Length of one Mars hour (1/24 sol) in Earth hours. */
export const MARS_HOUR_IN_EARTH_HOURS = SOL_SECONDS / 86400;
export const MARS_OBLIQUITY_DEG = 25.19;

/** TT - UTC in seconds (32.184 s + 37 leap seconds, unchanged since 2017). */
const TT_MINUS_UTC_S = 69.184;

/** Areocentric solar longitude in degrees [0, 360) for a UTC instant. */
export function solarLongitudeDeg(utcMs: number): number {
  const jdTt = utcMs / 86400000 + 2440587.5 + TT_MINUS_UTC_S / 86400;
  const d = jdTt - 2451545.0;
  const m = (19.3871 + 0.52402073 * d) * RAD;
  const fictitiousMeanSun = 270.3871 + 0.524038496 * d;
  const equationOfCentre =
    (10.691 + 3.0e-7 * d) * Math.sin(m) +
    0.623 * Math.sin(2 * m) +
    0.05 * Math.sin(3 * m) +
    0.005 * Math.sin(4 * m) +
    0.0005 * Math.sin(5 * m);
  return (((fictitiousMeanSun + equationOfCentre) % 360) + 360) % 360;
}

export function solarDeclinationDeg(lsDeg: number): number {
  return Math.asin(Math.sin(MARS_OBLIQUITY_DEG * RAD) * Math.sin(lsDeg * RAD)) / RAD;
}

/** Sunrise-to-sunset duration in Mars hours (24 per sol). 0 or 24 in polar night / day. */
export function daylightMarsHours(latDeg: number, lsDeg: number): number {
  const x = -Math.tan(latDeg * RAD) * Math.tan(solarDeclinationDeg(lsDeg) * RAD);
  if (x >= 1) return 0;
  if (x <= -1) return 24;
  return (2 * Math.acos(x)) / RAD / 15;
}

export const marsHoursToEarthHours = (h: number) => h * MARS_HOUR_IN_EARTH_HOURS;

const SEASONS_NORTH = ["spring", "summer", "autumn", "winter"] as const;
const THIRDS = ["early", "mid", "late"] as const;

/** Season name in the style of the MEDA feed, e.g. "late autumn". */
export function seasonName(lsDeg: number, latDeg = 1): string {
  const ls = ((lsDeg % 360) + 360) % 360;
  const quarter = Math.floor(ls / 90);
  const season = SEASONS_NORTH[latDeg >= 0 ? quarter : (quarter + 2) % 4];
  return `${THIRDS[Math.min(2, Math.floor((ls % 90) / 30))]} ${season}`;
}
