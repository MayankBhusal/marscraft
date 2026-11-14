// Cross-checks the working DEM against Perseverance's own end-of-drive
// localizations (public/data/m20_traverse.json). The rover values are in situ
// and independent of the orbital DEM, so this is a ground-truth comparison for
// elevation and a scale comparison for slope.
//
// Rover tilt is not the same quantity as grid slope: it is the attitude of a
// 3 m vehicle on metre-scale relief, while grid slope is a gradient across
// ~590 m cells. The comparison shows how much relief the grid averages away.
//
//   node scripts/validate_rover_ground_truth.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, "..", "public", "data");
const outDir = join(here, "..", "validation");
mkdirSync(outDir, { recursive: true });

const meta = JSON.parse(readFileSync(join(data, "dem.meta.json"), "utf8"));
const buf = readFileSync(join(data, "dem.bin"));
const elev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const traverse = JSON.parse(readFileSync(join(data, "m20_traverse.json"), "utf8"));

const RAD = Math.PI / 180;
const HIGH_SLOPE_DEG = 15;
const z = (r, c) => elev[r * meta.cols + c];
const cellOf = (lon, lat) => ({
  r: Math.floor((meta.north - lat) / meta.dLat),
  c: Math.floor((lon - meta.west) / meta.dLon),
});

// Horn 3x3, identical to src/core/terrain.ts.
function slopeDeg(r, c) {
  if (r < 1 || c < 1 || r >= meta.rows - 1 || c >= meta.cols - 1) return NaN;
  const dy = meta.dLat * RAD * meta.radiusM;
  const dx = meta.dLon * RAD * meta.radiusM * Math.cos((meta.north - (r + 0.5) * meta.dLat) * RAD);
  const a = z(r - 1, c - 1), b = z(r - 1, c), cc = z(r - 1, c + 1);
  const d = z(r, c - 1), f = z(r, c + 1);
  const g = z(r + 1, c - 1), h = z(r + 1, c), i = z(r + 1, c + 1);
  if (![a, b, cc, d, z(r, c), f, g, h, i].every(Number.isFinite)) return NaN;
  const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * dx);
  const dzdy = ((a + 2 * b + cc) - (g + 2 * h + i)) / (8 * dy);
  return Math.atan(Math.hypot(dzdx, dzdy)) / RAD;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const r1 = (v) => Number(v.toFixed(1));
const r2 = (v) => Number(v.toFixed(2));

const elevDiff = [];
const pairs = [];
const cells = new Set();
for (const s of traverse.stops) {
  const { r, c } = cellOf(s.lon, s.lat);
  if (r < 0 || c < 0 || r >= meta.rows || c >= meta.cols) continue;
  cells.add(r * meta.cols + c);
  const e = z(r, c);
  if (s.elevM != null && Number.isFinite(e)) elevDiff.push(e - s.elevM);
  const g = slopeDeg(r, c);
  if (s.tiltDeg != null && Number.isFinite(g)) pairs.push({ tilt: s.tiltDeg, grid: g });
}

const absDiff = elevDiff.map(Math.abs);
const tilt = pairs.map((p) => p.tilt);
const grid = pairs.map((p) => p.grid);

const result = {
  generated: new Date().toISOString().slice(0, 10),
  dem: meta.title,
  traverse: { source: traverse.source, retrieved: traverse.retrieved, lastSol: traverse.lastSol },
  stops: traverse.stops.length,
  demCellsTouched: cells.size,
  elevationGridMinusRoverM: {
    n: elevDiff.length,
    mean: r1(mean(elevDiff)),
    median: r1(pct(elevDiff, 0.5)),
    meanAbs: r1(mean(absDiff)),
    p90Abs: r1(pct(absDiff, 0.9)),
    maxAbs: r1(Math.max(...absDiff)),
    rmse: r1(Math.sqrt(mean(elevDiff.map((d) => d * d)))),
  },
  roverTiltDeg: { n: tilt.length, mean: r2(mean(tilt)), median: r2(pct(tilt, 0.5)), p90: r2(pct(tilt, 0.9)), max: r1(Math.max(...tilt)) },
  gridSlopeAtStopsDeg: { n: grid.length, mean: r2(mean(grid)), median: r2(pct(grid, 0.5)), p90: r2(pct(grid, 0.9)), max: r1(Math.max(...grid)) },
  stopsWhereTiltExceedsGridSlopePct: r1((pairs.filter((p) => p.tilt > p.grid).length / pairs.length) * 100),
  stopsWithTiltAtLeast15Deg: tilt.filter((t) => t >= HIGH_SLOPE_DEG).length,
  stopsInHighSlopeGridCells: grid.filter((g) => g >= HIGH_SLOPE_DEG).length,
};

writeFileSync(join(outDir, "rover_ground_truth.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
