import { Grid } from "./grid";
import { CLASS_COLOR, classify } from "./terrain";

export const MISSING_RGBA: [number, number, number, number] = [110, 110, 110, 190];

/** Hypsometric-style ramp: [fraction, r, g, b]. */
export const ELEV_RAMP: [number, number, number, number][] = [
  [0.0, 40, 55, 90],
  [0.25, 70, 105, 125],
  [0.5, 130, 145, 110],
  [0.75, 180, 155, 100],
  [1.0, 220, 200, 160],
];
export const SLOPE_MAX_DEG = 30;
export const SLOPE_RAMP: [number, number, number, number][] = [
  [0.0, 240, 236, 220],
  [0.5, 214, 160, 90],
  [1.0, 120, 40, 40],
];

export function ramp(stops: [number, number, number, number][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, r0, g0, b0] = stops[i - 1], [t1, r1, g1, b1] = stops[i];
      const u = (x - t0) / (t1 - t0);
      return [r0 + (r1 - r0) * u, g0 + (g1 - g0) * u, b0 + (b1 - b0) * u];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], l[2], l[3]];
}

/**
 * Local preview PNGs (pre-rendered from the DEM). Prefer these over canvas
 * data-URLs so the map stays visible even when remote Trek tiles are blocked
 * and so large data-URLs cannot fail silently in some browsers.
 */
export function staticTerrainUrls(base = import.meta.env.BASE_URL + "data/") {
  return {
    elevation: base + "elev_preview.png",
    slope: base + "slope_preview.png",
    terrainClass: base + "class_preview.png",
  };
}

function paint(g: Grid, alpha: number, fn: (i: number) => [number, number, number, number]): string {
  const canvas = document.createElement("canvas");
  canvas.width = g.cols;
  canvas.height = g.rows;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(g.cols, g.rows);
  for (let i = 0; i < g.rows * g.cols; i++) {
    const [r, gg, b, a] = fn(i);
    img.data.set([r, gg, b, Math.round(a * alpha)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function elevationImage(g: Grid, lo: number, hi: number): string {
  return paint(g, 1, (i) => {
    const v = g.elev[i];
    if (Number.isNaN(v)) return MISSING_RGBA;
    const [r, gg, b] = ramp(ELEV_RAMP, (v - lo) / (hi - lo || 1));
    return [r, gg, b, 255];
  });
}

export function slopeImage(g: Grid, slope: Float32Array): string {
  return paint(g, 1, (i) => {
    const v = slope[i];
    if (Number.isNaN(v)) return MISSING_RGBA;
    const [r, gg, b] = ramp(SLOPE_RAMP, v / SLOPE_MAX_DEG);
    return [r, gg, b, 255];
  });
}

export function classImage(g: Grid, slope: Float32Array): string {
  return paint(g, 1, (i) => {
    const c = classify(slope[i]);
    const [r, gg, b] = CLASS_COLOR[c];
    return [r, gg, b, c === "unknown" ? 190 : 255];
  });
}

export const cssRamp = (stops: [number, number, number, number][]) =>
  `linear-gradient(to right, ${stops.map(([t, r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0}) ${t * 100}%`).join(", ")})`;

/** Semi-transparent green where walk-back to habitat is feasible within radiusM. */
export function reachabilityImage(g: Grid, distM: Float32Array, radiusM: number): string {
  return paint(g, 1, (i) => {
    const d = distM[i];
    if (!Number.isFinite(d) || d > radiusM) return [0, 0, 0, 0];
    // Fade toward the edge of the radius
    const t = 1 - d / radiusM;
    const a = Math.round(40 + 90 * t);
    return [46, 140, 90, a];
  });
}
