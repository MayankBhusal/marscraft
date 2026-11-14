// Refreshes the bundled NASA context files. Needs internet and Node 18+.
//
//   public/data/m20_traverse.json            Perseverance traverse + end-of-drive stops (always read locally)
//   public/data/meda_snapshot.json           Mars 2020 MEDA weather feed (fallback when the live feed is unreachable)
//   public/data/space_weather_snapshot.json  DONKI WSA-ENLIL runs with a predicted Mars arrival (same fallback role)
//
// Nothing here is modelled or invented: values are copied from the NASA feeds,
// with geometry simplification as the only processing step.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "data");
mkdirSync(out, { recursive: true });

const MARS_RADIUS_M = 3396190;
const RAD = Math.PI / 180;
const SIMPLIFY_TOLERANCE_M = 1.5;
const SEGMENT_GAP_M = 25;
const DONKI_WINDOW_DAYS = 30;

const TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json";
const WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json";
const MEDA_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json";
const DONKI_URL = "https://api.nasa.gov/DONKI/WSAEnlilSimulations";

const today = new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const save = (name, data) => {
  const text = JSON.stringify(data);
  writeFileSync(join(out, name), text);
  console.log(`wrote ${name} (${(text.length / 1024).toFixed(1)} kB)`);
};

function toLocalXY(lon, lat, lat0) {
  return [lon * RAD * MARS_RADIUS_M * Math.cos(lat0 * RAD), lat * RAD * MARS_RADIUS_M];
}

/** Douglas-Peucker on [lon, lat] points, tolerance in metres. */
function simplify(points, toleranceM) {
  if (points.length < 3) return points;
  const lat0 = points[0][1];
  const xy = points.map(([lon, lat]) => toLocalXY(lon, lat, lat0));
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1, worstD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst !== -1 && worstD > toleranceM) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function distM(a, b) {
  const [ax, ay] = toLocalXY(a[0], a[1], a[1]);
  const [bx, by] = toLocalXY(b[0], b[1], a[1]);
  return Math.hypot(bx - ax, by - ay);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > -9000 ? v : null);
const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

async function traverse() {
  const [path, waypoints] = await Promise.all([getJson(TRAVERSE_URL), getJson(WAYPOINTS_URL)]);

  const features = [...path.features].sort(
    (a, b) => a.properties.sol - b.properties.sol || a.properties.SCLK_START - b.properties.SCLK_START,
  );
  const lines = [];
  let current = [];
  let rawPoints = 0;
  for (const f of features) {
    const coords = f.geometry.type === "MultiLineString" ? f.geometry.coordinates.flat() : f.geometry.coordinates;
    for (const c of coords) {
      rawPoints++;
      const pt = [c[0], c[1]];
      const last = current[current.length - 1];
      if (last && last[0] === pt[0] && last[1] === pt[1]) continue;
      if (last && distM(last, pt) > SEGMENT_GAP_M) {
        if (current.length > 1) lines.push(current);
        current = [];
      }
      current.push(pt);
    }
  }
  if (current.length > 1) lines.push(current);

  const paths = lines.map((l) => simplify(l, SIMPLIFY_TOLERANCE_M).map(([lon, lat]) => [round(lon, 6), round(lat, 6)]));
  const keptPoints = paths.reduce((n, l) => n + l.length, 0);

  const stops = waypoints.features
    .filter((f) => f.properties.final === "y")
    .map((f) => {
      const p = f.properties;
      return {
        sol: p.sol,
        site: p.site,
        drive: p.drive,
        lon: round(p.lon, 6),
        lat: round(p.lat, 6),
        elevM: round(num(p.elev_geoid), 1),
        tiltDeg: round(num(p.tilt), 1),
        distTotalM: round(num(p.dist_total_m), 0),
      };
    })
    .sort((a, b) => a.sol - b.sol || (a.distTotalM ?? 0) - (b.distTotalM ?? 0));

  const lastSol = Math.max(...stops.map((s) => s.sol));
  const totalDistanceM = Math.max(...stops.map((s) => s.distTotalM ?? 0));

  save("m20_traverse.json", {
    _note:
      "Perseverance (Mars 2020) traverse and end-of-drive localizations, copied from the NASA/JPL-Caltech mission location map. Path geometry is simplified; stop values are as published. elevM is the rover-reported elevation relative to the Mars areoid; tiltDeg is the rover's tilt at the end of the drive (metre-scale, in situ).",
    source: "NASA/JPL-Caltech Mars 2020 mission location map (MMGIS layers)",
    sourceUrls: [TRAVERSE_URL, WAYPOINTS_URL],
    retrieved: today,
    upstreamNames: [path.name, waypoints.name],
    lastSol,
    totalDistanceM,
    simplifyToleranceM: SIMPLIFY_TOLERANCE_M,
    paths,
    stops,
  });
  console.log(`  traverse: ${rawPoints} raw points -> ${keptPoints} in ${paths.length} line(s); ${stops.length} stops to sol ${lastSol}`);
}

async function meda() {
  const data = await getJson(MEDA_URL);
  if (!Array.isArray(data.sols) || !data.sols.length) throw new Error("MEDA feed has no sols");
  save("meda_snapshot.json", {
    _note: "Verbatim copy of the Mars 2020 MEDA weather feed, used only when the live feed cannot be reached.",
    source: "NASA/JPL-Caltech/CAB (CSIC-INTA) Mars 2020 MEDA",
    sourceUrl: MEDA_URL,
    retrieved: today,
    sols: data.sols,
  });
  const last = data.sols[data.sols.length - 1];
  console.log(`  MEDA: ${data.sols.length} sols, latest sol ${last.sol} (${last.terrestrial_date})`);
}

async function spaceWeather() {
  const end = new Date();
  const start = new Date(end.getTime() - DONKI_WINDOW_DAYS * 86400000);
  const day = (d) => d.toISOString().slice(0, 10);
  const key = process.env.NASA_API_KEY || "DEMO_KEY";
  const sims = await getJson(`${DONKI_URL}?startDate=${day(start)}&endDate=${day(end)}&api_key=${key}`);
  if (!Array.isArray(sims)) throw new Error("DONKI response is not a list");
  const marsOnly = sims
    .filter((s) => (s.impactList ?? []).some((i) => i.location === "Mars"))
    .map((s) => ({
      simulationID: s.simulationID,
      modelCompletionTime: s.modelCompletionTime,
      cmeInputs: (s.cmeInputs ?? []).map((c) => ({ cmeStartTime: c.cmeStartTime, speed: c.speed, halfAngle: c.halfAngle, CMEID: c.CMEID })),
      impactList: s.impactList.filter((i) => i.location === "Mars"),
      link: s.link,
    }));
  save("space_weather_snapshot.json", {
    _note:
      "WSA-ENLIL+Cone simulations from NASA DONKI that list a predicted arrival at Mars. Used only when the live DONKI request fails or is rate-limited. Model predictions, not measurements.",
    source: "NASA CCMC DONKI (Space Weather Database Of Notifications, Knowledge, Information)",
    sourceUrl: DONKI_URL,
    retrieved: new Date().toISOString(),
    window: { start: day(start), end: day(end) },
    simulationCount: sims.length,
    simulations: marsOnly,
  });
  console.log(`  DONKI: ${sims.length} simulations in window, ${marsOnly.length} with a Mars arrival`);
}

let failed = false;
for (const [name, job] of [["traverse", traverse], ["meda", meda], ["space weather", spaceWeather]]) {
  try {
    await job();
  } catch (e) {
    failed = true;
    console.error(`FAILED ${name}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
