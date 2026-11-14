import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Grid, GridMeta } from "./grid";
import { computeSlope, classify, elevationRange } from "./terrain";
import { planRoutes, PROFILES, stepFactor } from "./route";

const dir = new URL("../../public/data/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("dem.meta.json", dir), "utf8")) as GridMeta;
const buf = readFileSync(new URL("dem.bin", dir));
const grid = new Grid(meta, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
const slope = computeSlope(grid);
const pois = JSON.parse(readFileSync(new URL("pois.json", dir), "utf8")).pois as { id: string; name: string; lon: number; lat: number }[];

describe("shipped data files", () => {
  it("metadata matches the binary and declares provenance", () => {
    expect(grid.elev.length).toBe(meta.rows * meta.cols);
    expect(typeof meta.synthetic).toBe("boolean");
    expect(meta.source.length).toBeGreaterThan(10);
  });
  it("elevation range is plausible for Mars (MOLA datum spans about -8200 to +21200 m globally)", () => {
    const [lo, hi] = elevationRange(grid);
    expect(lo).toBeGreaterThan(-9000);
    expect(hi).toBeLessThan(22000);
  });
it("propagates missing elevation cells to unknown slope", () => {
  // Create a small, flat test grid.
  const testMeta: GridMeta = {
    ...meta,
    rows: 7,
    cols: 7,
    synthetic: true,
  };

  const elevations = new Float32Array(7 * 7).fill(1000);

  // Introduce one missing elevation cell at the centre.
  const missingIndex = 3 * 7 + 3;
  elevations[missingIndex] = Number.NaN;

  const testGrid = new Grid(testMeta, elevations);
  const testSlope = computeSlope(testGrid);

  // The missing elevation must remain identifiable.
  expect(Number.isNaN(testGrid.elev[missingIndex])).toBe(true);

  // Its slope must be unknown.
  expect(Number.isNaN(testSlope[missingIndex])).toBe(true);

  // A neighbouring cell whose 3x3 window includes NoData
  // should also have unknown slope.
  const neighbourIndex = testGrid.idx(2, 3);
  expect(Number.isNaN(testSlope[neighbourIndex])).toBe(true);

  // An unaffected interior cell should still have a valid slope.
  const unaffectedIndex = testGrid.idx(1, 1);
  expect(Number.isFinite(testSlope[unaffectedIndex])).toBe(true);

  // Unknown slope must be classified as unknown.
  expect(classify(testSlope[missingIndex])).toBe("unknown");
});
  it("all points of interest fall inside the grid", () => {
    for (const p of pois) expect(grid.toCell(p.lon, p.lat), p.id).not.toBeNull();
  });
});

describe("planner on the full grid", () => {
  it("finds three profiles between two POIs, quickly, with no excluded step used", () => {
    const a = grid.toCell(pois[0].lon, pois[0].lat)!, b = grid.toCell(pois[3].lon, pois[3].lat)!;
    const t0 = performance.now();
    const { routes, failed } = planRoutes(grid, slope, [a, b], pois, 3);
    const ms = performance.now() - t0;
    expect(failed).toEqual([]);
    expect(routes.length).toBe(3);
    expect(ms).toBeLessThan(3000);
    for (const r of routes) {
      const params = PROFILES[r.profile].params;
      for (let i = 1; i < r.path.length; i++) {
        const f = stepFactor(slope, grid.idx(r.path[i - 1].r, r.path[i - 1].c), grid.idx(r.path[i].r, r.path[i].c), params);
        expect(Number.isFinite(f)).toBe(true);
      }
    }
    const s = routes.find((r) => r.profile === "shortest")!.metrics;
    const bal = routes.find((r) => r.profile === "balanced")!.metrics;
    expect(bal.referenceCost).toBeLessThanOrEqual(s.referenceCost + 1e-9);
    expect(s.distanceKm).toBeLessThanOrEqual(bal.distanceKm + 1e-9);
    console.log(`routing ${ms.toFixed(0)} ms; km: ${routes.map((r) => `${r.profile}=${r.metrics.distanceKm.toFixed(1)}`).join(" ")}; cost: ${routes.map((r) => `${r.profile}=${r.metrics.referenceCost.toFixed(1)}`).join(" ")}`);
  });
});