export interface GridMeta {
  id: string;
  title: string;
  /** True only for generated development data. Must be shown to the user. */
  synthetic: boolean;
  source: string;
  sourceUrl: string;
  /** Planetary radius used for degree-to-metre conversion (sphere). */
  radiusM: number;
  rows: number;
  cols: number;
  /** Planetocentric longitude (deg, positive east, -180..180) of the west edge. */
  west: number;
  /** Planetocentric latitude (deg) of the north edge. */
  north: number;
  /** Cell size in degrees. */
  dLon: number;
  dLat: number;
  elevationUnit: "m";
  processing: string[];
  limitations: string[];
}

/** Row 0 is the northernmost row. Missing elevation is NaN. */
export class Grid {
  constructor(public meta: GridMeta, public elev: Float32Array) {
  if (!Number.isInteger(meta.rows) || meta.rows < 3 ||
      !Number.isInteger(meta.cols) || meta.cols < 3) {
    throw new Error("Grid dimensions must be integers of at least 3.");
  }

  if (elev.length !== meta.rows * meta.cols) {
    throw new Error(`Grid size mismatch: ${elev.length} != ${meta.rows}x${meta.cols}`);
  }

  if (!Number.isFinite(meta.radiusM) || meta.radiusM <= 0 ||
      !Number.isFinite(meta.dLon) || meta.dLon <= 0 ||
      !Number.isFinite(meta.dLat) || meta.dLat <= 0) {
    throw new Error("Invalid grid geographic metadata.");
  }
}
  get rows() { return this.meta.rows; }
  get cols() { return this.meta.cols; }
  get south() { return this.meta.north - this.meta.rows * this.meta.dLat; }
  get east() { return this.meta.west + this.meta.cols * this.meta.dLon; }
  idx(r: number, c: number) { return r * this.meta.cols + c; }
  inBounds(r: number, c: number) { return r >= 0 && c >= 0 && r < this.rows && c < this.cols; }
  centerLat(r: number) { return this.meta.north - (r + 0.5) * this.meta.dLat; }
  centerLon(c: number) { return this.meta.west + (c + 0.5) * this.meta.dLon; }
  /** Returns null if the point lies outside the grid. */
  toCell(lon: number, lat: number): { r: number; c: number } | null {
    const c = Math.floor((lon - this.meta.west) / this.meta.dLon);
    const r = Math.floor((this.meta.north - lat) / this.meta.dLat);
    return this.inBounds(r, c) ? { r, c } : null;
  }
}

const RAD = Math.PI / 180;

/** Metric size of one cell at a given row: [east-west, north-south] metres. */
export function cellSizeM(g: Grid, r: number): [number, number] {
  const R = g.meta.radiusM;
  const dy = g.meta.dLat * RAD * R;
  const dx = g.meta.dLon * RAD * R * Math.cos(g.centerLat(r) * RAD);
  return [dx, dy];
}

/** Great-circle distance on the sphere (haversine), metres. */
export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number, R: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD;
  const dp = p2 - p1, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function loadGrid(base = import.meta.env.BASE_URL + "data/"): Promise<Grid> {
  const [metaRes, binRes] = await Promise.all([fetch(base + "dem.meta.json"), fetch(base + "dem.bin")]);
  if (!metaRes.ok || !binRes.ok) throw new Error("Elevation grid not found. Run `npm run data:synthetic` or `npm run data:real`.");
  const meta = (await metaRes.json()) as GridMeta;
  const buf = await binRes.arrayBuffer();
  return new Grid(meta, new Float32Array(buf));
}
