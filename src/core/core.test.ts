import { describe, it, expect } from "vitest";
import { Grid, GridMeta, cellSizeM } from "./grid";
import { computeSlope, classify } from "./terrain";
import { findPath, findRouteVia, stepFactor, PROFILES, planRoutes, evaluateRoute, REFERENCE_PARAMS } from "./route";

function mkGrid(rows: number, cols: number, fn: (r: number, c: number) => number, lat0 = 0, d = 0.01): Grid {
  const meta: GridMeta = {
    id: "t", title: "t", synthetic: true, source: "test", sourceUrl: "", radiusM: 3396190,
    rows, cols, west: 0, north: lat0, dLon: d, dLat: d, elevationUnit: "m", processing: [], limitations: [],
  };
  const e = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) e[r * cols + c] = fn(r, c);
  return new Grid(meta, e);
}

describe("slope", () => {
  it("flat terrain has zero slope", () => {
    const g = mkGrid(7, 7, () => 100);
    const s = computeSlope(g);
    expect(s[g.idx(3, 3)]).toBeCloseTo(0, 6);
  });
  it("matches the analytic slope of a plane (uses metres, not pixels)", () => {
    // Rise 10 m per cell eastward. Run is dx metres.
    const g = mkGrid(7, 7, (_r, c) => c * 10);
    const [dx] = cellSizeM(g, 3);
    const expected = Math.atan(10 / dx) * 180 / Math.PI;
    expect(computeSlope(g)[g.idx(3, 3)]).toBeCloseTo(expected, 4);
  });
  it("north-facing rise gives same magnitude as east-facing on a sphere at the equator", () => {
    const gN = mkGrid(7, 7, (r) => (6 - r) * 10);
    const [, dy] = cellSizeM(gN, 3);
    expect(computeSlope(gN)[gN.idx(3, 3)]).toBeCloseTo(Math.atan(10 / dy) * 180 / Math.PI, 4);
  });
  it("cell size shrinks east-west with latitude", () => {
    const g = mkGrid(5, 5, () => 0, 60);
    const [dx, dy] = cellSizeM(g, 2);
    expect(dx / dy).toBeCloseTo(Math.cos(g.centerLat(2) * Math.PI / 180), 6);
  });
  it("missing elevation yields unknown slope, never zero", () => {
    const g = mkGrid(7, 7, (r, c) => (r === 3 && c === 3 ? NaN : 50));
    const s = computeSlope(g);
    expect(Number.isNaN(s[g.idx(3, 3)])).toBe(true);
    expect(Number.isNaN(s[g.idx(2, 2)])).toBe(true); // neighbour of the hole
    expect(Number.isNaN(s[g.idx(0, 0)])).toBe(true); // border
  });
});

describe("classification", () => {
  it("follows documented thresholds", () => {
    expect(classify(0)).toBe("low");
    expect(classify(4.99)).toBe("low");
    expect(classify(5)).toBe("moderate");
    expect(classify(14.99)).toBe("moderate");
    expect(classify(15)).toBe("high");
    expect(classify(NaN)).toBe("unknown");
  });
});

describe("routing", () => {
  it("straight path on flat terrain", () => {
    const g = mkGrid(15, 15, () => 0);
    const s = computeSlope(g);
    const p = findPath(g, s, { r: 7, c: 2 }, { r: 7, c: 12 }, PROFILES.balanced.params)!;
    expect(p.every((c) => c.r === 7)).toBe(true);
    expect(p.length).toBe(11);
  });
  it("never crosses cells above the maximum slope", () => {
    // Plateau wall (3000 m) over columns 11-13; a 3-row gap (rows 3-5) at 0 m.
    // The gap is 3 rows tall so Horn's 3x3 window leaves row 4 genuinely flat.
    const g = mkGrid(25, 25, (r, c) => (c >= 11 && c <= 13 && (r < 3 || r > 5) ? 3000 : 0));
    const s = computeSlope(g);
    const params = { ...PROFILES.balanced.params, unknownFactor: Infinity };
    const p = findPath(g, s, { r: 4, c: 3 }, { r: 4, c: 21 }, params)!;
    expect(p).not.toBeNull();
    for (let i = 1; i < p.length; i++) {
      const f = stepFactor(s, g.idx(p[i - 1].r, p[i - 1].c), g.idx(p[i].r, p[i].c), params);
      expect(Number.isFinite(f)).toBe(true);
    }
    // Every wall-column cell on the path must be in the gap row.
    expect(p.filter((c) => c.c >= 11 && c.c <= 13).every((c) => c.r === 4)).toBe(true);
  });
  it("terrain changes the route: cautious detours around a hill that shortest crosses", () => {
    // Cone with ~11 degree flanks at 0.01 deg cells (~590 m): 120 m rise per cell.
    const g = mkGrid(41, 41, (r, c) => {
      const d = Math.hypot(r - 20, c - 20);
      return d < 8 ? (8 - d) * 120 : 0;
    });
    const s = computeSlope(g);
    const a = { r: 20, c: 3 }, b = { r: 20, c: 37 };
    const { routes } = planRoutes(g, s, [a, b], []);
    const shortest = routes.find((r) => r.profile === "shortest")!;
    const cautious = routes.find((r) => r.profile === "cautious")!;
    expect(cautious.metrics.distanceKm).toBeGreaterThan(shortest.metrics.distanceKm);
    expect(cautious.metrics.referenceCost).toBeLessThan(shortest.metrics.referenceCost);
    expect((cautious.metrics.maxSlopeDeg ?? 0)).toBeLessThan(shortest.metrics.maxSlopeDeg ?? 0);
  });
  it("unknown terrain is penalised rather than treated as safe", () => {
    const g = mkGrid(21, 21, (r, c) => (r >= 8 && r <= 12 && c >= 8 && c <= 12 ? NaN : 0));
    const s = computeSlope(g);
    const p = findPath(g, s, { r: 10, c: 2 }, { r: 10, c: 18 }, PROFILES.cautious.params)!;
    // Cautious unknownFactor is 20, so it must go around the 7x7 unknown patch.
    const m = evaluateRoute(g, s, p, [], 3);
    expect(m.unknownShare).toBeLessThan(0.2);
    const through = findPath(g, s, { r: 10, c: 2 }, { r: 10, c: 18 }, PROFILES.shortest.params)!;
    expect(evaluateRoute(g, s, through, [], 3).unknownShare).toBeGreaterThan(0.2);
  });
  it("distance of a straight run equals cells * cell size", () => {
    const g = mkGrid(9, 9, () => 0, 0, 0.01);
    const s = computeSlope(g);
    const p = findPath(g, s, { r: 4, c: 1 }, { r: 4, c: 7 }, PROFILES.shortest.params)!;
    const expectedKm = 6 * 0.01 * (Math.PI / 180) * 3396190 / 1000;
    expect(evaluateRoute(g, s, p, [], 3).distanceKm).toBeCloseTo(expectedKm, 2);
  });
  it("routes through waypoints in order", () => {
    const g = mkGrid(21, 21, () => 0);
    const s = computeSlope(g);
    const p = findRouteVia(g, s, [{ r: 2, c: 2 }, { r: 18, c: 4 }, { r: 2, c: 18 }], REFERENCE_PARAMS)!;
    expect(p.some((c) => c.r === 18 && c.c === 4)).toBe(true);
  });
  it("returns null when steep cells (and impassable unknown border) fully block the way", () => {
    const g = mkGrid(15, 15, (_r, c) => (c >= 6 && c <= 8 ? 3000 : 0));
    const s = computeSlope(g);
    const params = { ...PROFILES.balanced.params, unknownFactor: Infinity };
    expect(findPath(g, s, { r: 7, c: 2 }, { r: 7, c: 12 }, params)).toBeNull();
  });
  it("with finite unknown penalty, border cells remain traversable but costly", () => {
    const g = mkGrid(15, 15, (_r, c) => (c >= 6 && c <= 8 ? 3000 : 0));
    const s = computeSlope(g);
    const p = findPath(g, s, { r: 7, c: 2 }, { r: 7, c: 12 }, PROFILES.balanced.params);
    expect(p).not.toBeNull();
    expect(evaluateRoute(g, s, p!, [], 3).unknownShare).toBeGreaterThan(0);
  });
});
