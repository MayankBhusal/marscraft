import { Grid, cellSizeM } from "./grid";

/**
 * Slope (degrees) by Horn's method (3x3 weighted finite difference),
 * with the east-west and north-south cell sizes converted to metres per row.
 * Cells whose 3x3 neighbourhood contains any missing elevation, and the outer
 * border ring, are NaN (unknown). They are never filled with a value.
 */
export function computeSlope(g: Grid): Float32Array {
  const { rows, cols, elev } = g;
  const out = new Float32Array(rows * cols).fill(NaN);
  for (let r = 1; r < rows - 1; r++) {
    const [dx, dy] = cellSizeM(g, r);
    for (let c = 1; c < cols - 1; c++) {
      const z = (rr: number, cc: number) => elev[rr * cols + cc];
      const a = z(r - 1, c - 1), b = z(r - 1, c), cN = z(r - 1, c + 1);
      const d = z(r, c - 1), f = z(r, c + 1);
      const gg = z(r + 1, c - 1), h = z(r + 1, c), i = z(r + 1, c + 1);
      const e = z(r, c);
      if (
  !Number.isFinite(a) ||
  !Number.isFinite(b) ||
  !Number.isFinite(cN) ||
  !Number.isFinite(d) ||
  !Number.isFinite(e) ||
  !Number.isFinite(f) ||
  !Number.isFinite(gg) ||
  !Number.isFinite(h) ||
  !Number.isFinite(i)
) continue;
      const dzdx = ((cN + 2 * f + i) - (a + 2 * d + gg)) / (8 * dx);
      // Row index grows southward, so northward gradient is (top - bottom).
      const dzdy = ((a + 2 * b + cN) - (gg + 2 * h + i)) / (8 * dy);
      out[r * cols + c] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
    }
  }
  return out;
}

export type TerrainClass = "low" | "moderate" | "high" | "unknown";

/** Documented, user-visible thresholds. Descriptive bins, not safety limits. */
export const SLOPE_THRESHOLDS = { lowMax: 5, moderateMax: 15 } as const;

export function classify(slopeDeg: number): TerrainClass {
  if (!Number.isFinite(slopeDeg)) return "unknown";
  if (slopeDeg < SLOPE_THRESHOLDS.lowMax) return "low";
  if (slopeDeg < SLOPE_THRESHOLDS.moderateMax) return "moderate";
  return "high";
}

export const CLASS_LABEL: Record<TerrainClass, string> = {
  low: `Low slope (< ${SLOPE_THRESHOLDS.lowMax} deg)`,
  moderate: `Moderate slope (${SLOPE_THRESHOLDS.lowMax} to ${SLOPE_THRESHOLDS.moderateMax} deg)`,
  high: `High slope (>= ${SLOPE_THRESHOLDS.moderateMax} deg)`,
  unknown: "Unknown (no slope could be computed)",
};

export const CLASS_COLOR: Record<TerrainClass, [number, number, number]> = {
  low: [92, 140, 110],
  moderate: [201, 169, 74],
  high: [168, 76, 62],
  unknown: [120, 120, 120],
};

export function elevationRange(g: Grid): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of g.elev) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}
