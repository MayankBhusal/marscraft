/**
 * Current-conditions logic: MEDA surface weather, DONKI space weather and the
 * pre-EVA planning checks that combine them with a planned route.
 *
 * Everything here is pure. Thresholds are PLANNING ASSUMPTIONS exposed as named
 * constants; none are flight rules or medical limits.
 */

// ---------- Surface weather (Mars 2020 MEDA) ----------

export interface MedaSol {
  sol: number;
  terrestrialDate: string;
  lsDeg: number | null;
  season: string | null;
  /** Air temperature, deg C. */
  minTempC: number | null;
  maxTempC: number | null;
  pressurePa: number | null;
  /** Local mean solar time, "HH:MM:SS". */
  sunrise: string | null;
  sunset: string | null;
}

/** The feed writes "--" for a value that was not reported. That stays null, never 0. */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const timeOrNull = (v: unknown) => (typeof v === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v) ? v : null);

export function parseMeda(raw: unknown): MedaSol[] {
  const list = (raw as { sols?: unknown } | null)?.sols;
  if (!Array.isArray(list)) throw new Error("the feed has no sol list");
  const sols: MedaSol[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const sol = numOrNull(item?.sol);
    if (sol == null || typeof item.terrestrial_date !== "string") continue;
    sols.push({
      sol,
      terrestrialDate: item.terrestrial_date,
      lsDeg: numOrNull(item.ls),
      season: typeof item.season === "string" ? item.season : null,
      minTempC: numOrNull(item.min_temp),
      maxTempC: numOrNull(item.max_temp),
      pressurePa: numOrNull(item.pressure),
      sunrise: timeOrNull(item.sunrise),
      sunset: timeOrNull(item.sunset),
    });
  }
  return sols.sort((a, b) => a.sol - b.sol);
}

/** "06:18:07" -> 6.302 Mars hours. */
export function parseLmstHours(t: string | null): number | null {
  if (!t) return null;
  const [h, m, s = 0] = t.split(":").map(Number);
  return h + m / 60 + s / 3600;
}

/** A report older than this is shown as an archived seasonal reference, not as current weather. */
export const MEDA_STALE_DAYS = 14;

export interface MedaSummary {
  latest: MedaSol;
  /** Most recent sol that reported both temperatures. */
  temp: { sol: number; terrestrialDate: string; minC: number; maxC: number } | null;
  pressure: { sol: number; terrestrialDate: string; pa: number } | null;
  reportedDaylightMarsHours: number | null;
  ageDays: number;
  stale: boolean;
}

export function summarizeMeda(sols: MedaSol[], nowMs: number): MedaSummary | null {
  if (!sols.length) return null;
  const latest = sols[sols.length - 1];
  const newestFirst = [...sols].reverse();
  const t = newestFirst.find((s) => s.minTempC != null && s.maxTempC != null);
  const p = newestFirst.find((s) => s.pressurePa != null);
  const rise = parseLmstHours(latest.sunrise), set = parseLmstHours(latest.sunset);
  const ageDays = Math.max(0, (nowMs - Date.parse(`${latest.terrestrialDate}T00:00:00Z`)) / 86400000);
  return {
    latest,
    temp: t ? { sol: t.sol, terrestrialDate: t.terrestrialDate, minC: t.minTempC!, maxC: t.maxTempC! } : null,
    pressure: p ? { sol: p.sol, terrestrialDate: p.terrestrialDate, pa: p.pressurePa! } : null,
    reportedDaylightMarsHours: rise != null && set != null && set > rise ? set - rise : null,
    ageDays,
    stale: !Number.isFinite(ageDays) || ageDays > MEDA_STALE_DAYS,
  };
}

// ---------- Space weather (NASA DONKI, WSA-ENLIL+Cone) ----------

export interface EnlilSimulation {
  simulationID: string;
  modelCompletionTime: string;
  cmeInputs?: { cmeStartTime?: string; speed?: number | null; CMEID?: string }[] | null;
  impactList?: { location: string; arrivalTime: string; isGlancingBlow?: boolean; isMinorImpact?: boolean }[] | null;
  link?: string;
}

export interface MarsArrival {
  arrivalMs: number;
  arrivalIso: string;
  glancing: boolean;
  minor: boolean;
  /** Fastest CME in the simulation, km/s. */
  cmeSpeedKms: number | null;
  cmeIds: string[];
  simulationID: string;
  modelCompletionTime: string;
  link: string | null;
}

/**
 * Predicted CME arrivals at Mars, soonest first. DONKI re-runs the model as CME
 * measurements improve; only the latest run for each set of CMEs is kept.
 */
export function marsArrivals(sims: EnlilSimulation[]): MarsArrival[] {
  const latestRun = new Map<string, MarsArrival>();
  for (const s of sims) {
    const hit = (s.impactList ?? []).find((i) => i.location === "Mars");
    if (!hit) continue;
    const arrivalMs = Date.parse(hit.arrivalTime);
    if (!Number.isFinite(arrivalMs)) continue;
    const cmes = s.cmeInputs ?? [];
    const cmeIds = cmes.map((c) => c.CMEID).filter((id): id is string => !!id).sort();
    const speeds = cmes.map((c) => c.speed).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const arrival: MarsArrival = {
      arrivalMs,
      arrivalIso: hit.arrivalTime,
      glancing: !!hit.isGlancingBlow,
      minor: !!hit.isMinorImpact,
      cmeSpeedKms: speeds.length ? Math.max(...speeds) : null,
      cmeIds,
      simulationID: s.simulationID,
      modelCompletionTime: s.modelCompletionTime,
      link: s.link ?? null,
    };
    const key = cmeIds.length ? cmeIds.join("|") : s.simulationID;
    const prev = latestRun.get(key);
    if (!prev || Date.parse(s.modelCompletionTime) >= Date.parse(prev.modelCompletionTime)) latestRun.set(key, arrival);
  }
  return [...latestRun.values()].sort((a, b) => a.arrivalMs - b.arrivalMs);
}

export type SpaceWeatherLevel = "quiet" | "watch" | "alert";

/** A predicted arrival this close to now (either side) counts as in progress or imminent. */
export const SW_ALERT_HOURS = 24;
export const SW_WATCH_AHEAD_HOURS = 7 * 24;
export const SW_WATCH_BEHIND_HOURS = 72;

export interface SpaceWeatherAssessment {
  level: SpaceWeatherLevel;
  /** Predicted within SW_ALERT_HOURS of now. */
  current: MarsArrival[];
  upcoming: MarsArrival[];
  recent: MarsArrival[];
  next: MarsArrival | null;
  total: number;
}

export function assessSpaceWeather(arrivals: MarsArrival[], nowMs: number): SpaceWeatherAssessment {
  const hours = (a: MarsArrival) => (a.arrivalMs - nowMs) / 3600000;
  const current = arrivals.filter((a) => Math.abs(hours(a)) <= SW_ALERT_HOURS);
  const upcoming = arrivals.filter((a) => hours(a) > SW_ALERT_HOURS && hours(a) <= SW_WATCH_AHEAD_HOURS);
  const recent = arrivals.filter((a) => hours(a) < -SW_ALERT_HOURS && hours(a) >= -SW_WATCH_BEHIND_HOURS);
  const level: SpaceWeatherLevel = current.some((a) => !a.minor)
    ? "alert"
    : current.length || upcoming.length || recent.length
      ? "watch"
      : "quiet";
  return { level, current, upcoming, recent, next: arrivals.find((a) => a.arrivalMs > nowMs) ?? null, total: arrivals.length };
}

// ---------- Pre-EVA planning checks ----------

export type CheckStatus = "ok" | "caution" | "flag" | "unknown";

export interface EvaCheck {
  id: "budget" | "daylight" | "spaceWeather" | "slope" | "roverTruth" | "dataGaps";
  label: string;
  status: CheckStatus;
  detail: string;
}

/** Remaining EVA budget below this fraction is a caution. */
export const BUDGET_MARGIN_FRACTION = 0.1;
/** Hours of daylight to keep in hand after the planned EVA. */
export const DAYLIGHT_MARGIN_HOURS = 1;
export const UNKNOWN_SHARE_CAUTION = 0.05;
/** A "quiet" reading from space-weather data older than this is not trusted. */
export const SW_FRESH_HOURS = 24;
/** Rover tilt at or above this inside a route cell is a caution (the high-slope class boundary). */
export const ROVER_TILT_CAUTION_DEG = 15;

export interface EvaCheckInput {
  walkHours: number;
  scienceHours: number;
  /** null when no scenario budget is set. */
  budgetHours: number | null;
  /** Sunrise-to-sunset in Earth hours at the EVA site, or null if unavailable. */
  daylightEarthHours: number | null;
  unknownShare: number;
  maxSlopeDeg: number | null;
  /** Route length on cells classified as high slope. */
  highSlopeKm: number;
  /** Rover stops inside the cells the route crosses, or null when the traverse is not loaded. */
  roverOnRoute: { stops: number; maxTiltDeg: number | null } | null;
  spaceWeather: SpaceWeatherAssessment | null;
  /** Age of the space-weather data in hours, or null when there is none. */
  spaceWeatherAgeHours: number | null;
}

const h1 = (v: number) => v.toFixed(1);

export function evaChecks(i: EvaCheckInput): EvaCheck[] {
  const total = i.walkHours + i.scienceHours;
  const checks: EvaCheck[] = [];

  if (i.budgetHours == null) {
    checks.push({ id: "budget", label: "EVA time budget", status: "unknown", detail: `${h1(total)} h planned; no budget set (load a scenario to check one).` });
  } else {
    const spare = i.budgetHours - total;
    checks.push({
      id: "budget",
      label: "EVA time budget",
      status: spare < 0 ? "flag" : spare < i.budgetHours * BUDGET_MARGIN_FRACTION ? "caution" : "ok",
      detail:
        spare < 0
          ? `${h1(total)} h planned exceeds the ${i.budgetHours} h budget by ${h1(-spare)} h.`
          : `${h1(total)} h planned of ${i.budgetHours} h; ${h1(spare)} h in hand.`,
    });
  }

  if (i.daylightEarthHours == null) {
    checks.push({ id: "daylight", label: "Daylight window", status: "unknown", detail: "Day length unavailable." });
  } else {
    const spare = i.daylightEarthHours - total;
    checks.push({
      id: "daylight",
      label: "Daylight window",
      status: spare < 0 ? "flag" : spare < DAYLIGHT_MARGIN_HOURS ? "caution" : "ok",
      detail:
        spare < 0
          ? `${h1(total)} h EVA is longer than the ${h1(i.daylightEarthHours)} h of daylight.`
          : `${h1(total)} h EVA within ${h1(i.daylightEarthHours)} h of daylight; ${h1(spare)} h in hand if it starts at sunrise.`,
    });
  }

  const sw = i.spaceWeather;
  if (!sw || i.spaceWeatherAgeHours == null) {
    checks.push({ id: "spaceWeather", label: "Space weather", status: "unknown", detail: "No DONKI data available. Radiation conditions are not known to this tool." });
  } else if (sw.level === "alert") {
    checks.push({ id: "spaceWeather", label: "Space weather", status: "flag", detail: `A CME is predicted to reach Mars within ${SW_ALERT_HOURS} h of now. Confirm conditions before egress.` });
  } else if (sw.level === "watch") {
    checks.push({ id: "spaceWeather", label: "Space weather", status: "caution", detail: "A predicted CME arrival at Mars is close to this period. Review the list under Current conditions." });
  } else if (i.spaceWeatherAgeHours > SW_FRESH_HOURS) {
    checks.push({ id: "spaceWeather", label: "Space weather", status: "unknown", detail: `No arrival listed, but the data is ${Math.round(i.spaceWeatherAgeHours / 24)} days old.` });
  } else {
    checks.push({ id: "spaceWeather", label: "Space weather", status: "ok", detail: "No CME arrival at Mars predicted in the next 7 days." });
  }

  if (i.maxSlopeDeg == null) {
    checks.push({ id: "slope", label: "Slope on route", status: "unknown", detail: "No slope could be computed along this route." });
  } else {
    checks.push({
      id: "slope",
      label: "Slope on route",
      status: i.highSlopeKm > 0 ? "caution" : "ok",
      detail:
        i.highSlopeKm > 0
          ? `${i.highSlopeKm.toFixed(2)} km crosses high-slope cells (max ${h1(i.maxSlopeDeg)} deg).`
          : `No high-slope cells; max ${h1(i.maxSlopeDeg)} deg on the working grid.`,
    });
  }

  const rover = i.roverOnRoute;
  if (!rover || rover.stops === 0 || rover.maxTiltDeg == null) {
    checks.push({
      id: "roverTruth",
      label: "Rover ground truth",
      status: "unknown",
      detail: rover ? "No rover stops in the cells this route crosses, so its grid slope is unverified at walking scale." : "Rover traverse data is not loaded.",
    });
  } else {
    const where = `Perseverance stopped ${rover.stops} time${rover.stops === 1 ? "" : "s"} in cells on this route`;
    const steep = rover.maxTiltDeg >= ROVER_TILT_CAUTION_DEG;
    checks.push({
      id: "roverTruth",
      label: "Rover ground truth",
      status: steep ? "caution" : "ok",
      detail: steep
        ? `${where} and tilted up to ${h1(rover.maxTiltDeg)} deg${i.maxSlopeDeg == null ? "" : `, against a grid maximum of ${h1(i.maxSlopeDeg)} deg`}. Expect steeper ground than the grid shows.`
        : `${where}; its tilt stayed at or below ${h1(rover.maxTiltDeg)} deg.`,
    });
  }

  const pct = (i.unknownShare * 100).toFixed(0);
  checks.push({
    id: "dataGaps",
    label: "Terrain data gaps",
    status: i.unknownShare > UNKNOWN_SHARE_CAUTION ? "caution" : "ok",
    detail: i.unknownShare > 0 ? `${pct}% of the route has unknown slope.` : "No unknown-slope cells on this route.",
  });

  return checks;
}
