import { Grid, cellSizeM, haversineM } from "./grid";
import { classify, TerrainClass } from "./terrain";

/**
 * Movement-cost model. All values are PLANNING PARAMETERS chosen for
 * transparency. They are not validated astronaut or rover mobility data.
 *
 *   step cost = step length (m) * factor
 *   known slope s (deg, mean of both cells): factor = 1 + (s / slopeRefDeg)^2
 *   either cell slope unknown:               factor = unknownFactor
 *   either cell slope > maxSlopeDeg:         step is excluded
 */
export interface CostParams {
  slopeRefDeg: number;
  maxSlopeDeg: number;
  unknownFactor: number;
}

export const PROFILES = {
  shortest: { label: "Shortest", params: { slopeRefDeg: 1e6, maxSlopeDeg: 25, unknownFactor: 1 } },
  balanced: { label: "Balanced", params: { slopeRefDeg: 10, maxSlopeDeg: 25, unknownFactor: 5 } },
  cautious: { label: "Cautious", params: { slopeRefDeg: 5, maxSlopeDeg: 15, unknownFactor: 20 } },
} as const satisfies Record<string, { label: string; params: CostParams }>;
export type ProfileId = keyof typeof PROFILES;

export const REFERENCE_PARAMS: CostParams = PROFILES.balanced.params;

const NEIGHBOURS: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
];

export function stepLengthM(g: Grid, r1: number, c1: number, r2: number, c2: number): number {
  return haversineM(g.centerLon(c1), g.centerLat(r1), g.centerLon(c2), g.centerLat(r2), g.meta.radiusM);
}

/** Returns the cost multiplier for a step, or Infinity if excluded. */
export function stepFactor(slope: Float32Array, i1: number, i2: number, p: CostParams): number {
  const s1 = slope[i1], s2 = slope[i2];
  if ((Number.isFinite(s1) && s1 > p.maxSlopeDeg) || (Number.isFinite(s2) && s2 > p.maxSlopeDeg)) return Infinity;
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) return p.unknownFactor;
  const s = (s1 + s2) / 2;
  return 1 + (s / p.slopeRefDeg) ** 2;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    let i = this.k.length;
    this.k.push(key); this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.v[0];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface Cell { r: number; c: number }

/**
 * A* on an 8-connected grid. The heuristic is great-circle distance, which is
 * admissible because every cost factor is >= 1. Returns null if no path exists.
 */
export function findPath(g: Grid, slope: Float32Array, from: Cell, to: Cell, p: CostParams): Cell[] | null {
  const n = g.rows * g.cols;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const s = g.idx(from.r, from.c), t = g.idx(to.r, to.c);
  const h = (r: number, c: number) => stepLengthM(g, r, c, to.r, to.c);
  const open = new MinHeap();
  gScore[s] = 0;
  open.push(h(from.r, from.c), s);
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === t) break;
    const r = Math.floor(cur / g.cols), c = cur % g.cols;
    for (const [dr, dc] of NEIGHBOURS) {
      const rr = r + dr, cc = c + dc;
      if (!g.inBounds(rr, cc)) continue;
      const ni = g.idx(rr, cc);
      if (closed[ni]) continue;
      const f = stepFactor(slope, cur, ni, p);
      if (!Number.isFinite(f)) continue;
      const cost = gScore[cur] + stepLengthM(g, r, c, rr, cc) * f;
      if (cost < gScore[ni]) {
        gScore[ni] = cost;
        came[ni] = cur;
        open.push(cost + h(rr, cc), ni);
      }
    }
  }
  if (!closed[t]) return null;
  const path: Cell[] = [];
  for (let i = t; i !== -1; i = came[i]) path.push({ r: Math.floor(i / g.cols), c: i % g.cols });
  return path.reverse();
}

/** Route through ordered stops (start, waypoints..., end). */
export function findRouteVia(g: Grid, slope: Float32Array, stops: Cell[], p: CostParams): Cell[] | null {
  const full: Cell[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const seg = findPath(g, slope, stops[i], stops[i + 1], p);
    if (!seg) return null;
    full.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return full.length ? full : stops.length === 1 ? [stops[0]] : null;
}

export interface Poi { id: string; name: string; lon: number; lat: number }

export interface RouteMetrics {
  distanceKm: number;
  /** Cost under REFERENCE_PARAMS, so routes from different profiles are comparable. */
  referenceCost: number;
  /** referenceCost / straight-line-equivalent distance; 1.0 means flat and fully known. */
  costPerMetre: number;
  meanSlopeDeg: number | null;
  maxSlopeDeg: number | null;
  distanceByClassKm: Record<TerrainClass, number>;
  unknownShare: number;
  ascentM: number | null;
  descentM: number | null;
  nearbyPois: { id: string; name: string; distKm: number }[];
  steps: number;
}

export function evaluateRoute(g: Grid, slope: Float32Array, path: Cell[], pois: Poi[], corridorKm: number): RouteMetrics {
  const byClass: Record<TerrainClass, number> = { low: 0, moderate: 0, high: 0, unknown: 0 };
  let dist = 0, cost = 0, slopeSum = 0, slopeLen = 0, maxS = -Infinity, up = 0, down = 0, elevKnown = false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const ia = g.idx(a.r, a.c), ib = g.idx(b.r, b.c);
    const len = stepLengthM(g, a.r, a.c, b.r, b.c);
    const f = stepFactor(slope, ia, ib, REFERENCE_PARAMS);
    dist += len;
    cost += len * (Number.isFinite(f) ? f : REFERENCE_PARAMS.unknownFactor);
    const s1 = slope[ia], s2 = slope[ib];
    if (Number.isNaN(s1) || Number.isNaN(s2)) {
      byClass.unknown += len;
    } else {
      const s = (s1 + s2) / 2;
      byClass[classify(s)] += len;
      slopeSum += s * len; slopeLen += len;
      if (Math.max(s1, s2) > maxS) maxS = Math.max(s1, s2);
    }
    const e1 = g.elev[ia], e2 = g.elev[ib];
    if (!Number.isNaN(e1) && !Number.isNaN(e2)) {
      elevKnown = true;
      if (e2 > e1) up += e2 - e1; else down += e1 - e2;
    }
  }
  const nearby: RouteMetrics["nearbyPois"] = [];
  for (const p of pois) {
    let best = Infinity;
    for (const c of path) {
      const d = haversineM(g.centerLon(c.c), g.centerLat(c.r), p.lon, p.lat, g.meta.radiusM) / 1000;
      if (d < best) best = d;
    }
    if (best <= corridorKm) nearby.push({ id: p.id, name: p.name, distKm: best });
  }
  nearby.sort((a, b) => a.distKm - b.distKm);
  const km = (m: number) => m / 1000;
  return {
    distanceKm: km(dist),
    referenceCost: km(cost),
    costPerMetre: dist > 0 ? cost / dist : 1,
    meanSlopeDeg: slopeLen > 0 ? slopeSum / slopeLen : null,
    maxSlopeDeg: maxS === -Infinity ? null : maxS,
    distanceByClassKm: { low: km(byClass.low), moderate: km(byClass.moderate), high: km(byClass.high), unknown: km(byClass.unknown) },
    unknownShare: dist > 0 ? byClass.unknown / dist : 0,
    ascentM: elevKnown ? up : null,
    descentM: elevKnown ? down : null,
    nearbyPois: nearby,
    steps: path.length - 1,
  };
}

export interface PlannedRoute {
  profile: ProfileId;
  label: string;
  path: Cell[];
  metrics: RouteMetrics;
  /** True if the path is identical (cell for cell) to an earlier profile's path. */
  duplicateOf: ProfileId | null;
}

export function planRoutes(g: Grid, slope: Float32Array, stops: Cell[], pois: Poi[], corridorKm = 3): { routes: PlannedRoute[]; failed: ProfileId[] } {
  const routes: PlannedRoute[] = [];
  const failed: ProfileId[] = [];
  for (const id of Object.keys(PROFILES) as ProfileId[]) {
    const path = findRouteVia(g, slope, stops, PROFILES[id].params);
    if (!path) { failed.push(id); continue; }
    const key = path.map((c) => c.r * g.cols + c.c).join(",");
    const dup = routes.find((r) => r.path.map((c) => c.r * g.cols + c.c).join(",") === key);
    routes.push({ profile: id, label: PROFILES[id].label, path, metrics: evaluateRoute(g, slope, path, pois, corridorKm), duplicateOf: dup ? dup.profile : null });
  }
  return { routes, failed };
}

/** Plain-language comparison derived only from computed metrics. */
export function explain(routes: PlannedRoute[]): string[] {
  const uniq = routes.filter((r) => !r.duplicateOf);
  if (!uniq.length) return ["No route could be found under any profile. Excluded steep or unreachable cells may block every connection."];
  const lines: string[] = [];
  const byCost = [...uniq].sort((a, b) => a.metrics.referenceCost - b.metrics.referenceCost)[0];
  const byDist = [...uniq].sort((a, b) => a.metrics.distanceKm - b.metrics.distanceKm)[0];
  lines.push(`Lowest reference cost: ${byCost.label} (${byCost.metrics.referenceCost.toFixed(2)} cost-km over ${byCost.metrics.distanceKm.toFixed(2)} km).`);
  if (byDist.profile !== byCost.profile) {
    const extra = (byCost.metrics.distanceKm / byDist.metrics.distanceKm - 1) * 100;
    const saved = (1 - byCost.metrics.referenceCost / byDist.metrics.referenceCost) * 100;
    lines.push(`${byDist.label} is shortest at ${byDist.metrics.distanceKm.toFixed(2)} km, but ${byCost.label} lowers reference cost by ${saved.toFixed(0)}% for ${extra.toFixed(0)}% more distance.`);
  } else {
    lines.push(`${byDist.label} is both the shortest and the lowest-cost route.`);
  }
  const dups = routes.filter((x) => x.duplicateOf);
  for (const r of dups) lines.push(`${r.label} produced the same path as ${PROFILES[r.duplicateOf!].label}.`);
  if (uniq.length === 1 && routes.length > 1) {
    lines.push(
      "All cost profiles produced the same corridor on this grid. On flat floor terrain at ~590 m cells the planners often agree; that is expected, not a failed comparison. Finer DTMs can separate alternatives near scarps and delta fronts.",
    );
  }
  const unk = uniq.filter((r) => r.metrics.unknownShare > 0);
  if (unk.length) lines.push(`Unknown-slope terrain on route: ${unk.map((r) => `${r.label} ${(r.metrics.unknownShare * 100).toFixed(0)}%`).join(", ")}. Unknown terrain is penalised, never assumed safe.`);
  lines.push("Reference cost applies the Balanced profile to every route so profiles are compared on the same scale.");
  return lines;
}

/**
 * Dijkstra distances (metres of geometric path length) from a habitat cell
 * under the given cost params. Cells with Infinite cost stay NaN.
 * Used for walk-back reachability shading.
 */
export function distanceField(
  g: Grid,
  slope: Float32Array,
  origin: Cell,
  p: CostParams,
  /** Optional max distance (m). Nodes beyond this are not expanded. */
  maxDistM = Infinity,
): Float32Array {
  const n = g.rows * g.cols;
  const dist = new Float32Array(n).fill(Number.NaN);
  const open = new MinHeap();
  const oi = g.idx(origin.r, origin.c);
  dist[oi] = 0;
  open.push(0, oi);
  while (open.size) {
    const cur = open.pop()!;
    const d0 = dist[cur];
    if (!Number.isFinite(d0)) continue;
    // Skip expanding past the reachability radius.
    if (d0 > maxDistM) continue;
    const r = Math.floor(cur / g.cols), c = cur % g.cols;
    for (const [dr, dc] of NEIGHBOURS) {
      const rr = r + dr, cc = c + dc;
      if (!g.inBounds(rr, cc)) continue;
      const ni = g.idx(rr, cc);
      const f = stepFactor(slope, cur, ni, p);
      if (!Number.isFinite(f)) continue;
      const nd = d0 + stepLengthM(g, r, c, rr, cc);
      if (nd > maxDistM) continue;
      if (!Number.isFinite(dist[ni]) || nd < dist[ni]) {
        dist[ni] = nd;
        open.push(nd, ni);
      }
    }
  }
  return dist;
}

/** One-way walk-back radius (m) given EVA budget, science reserve, and speed. */
export function walkBackRadiusM(evaBudgetHours: number, scienceHours: number, speedKmh: number): number {
  const walkHours = Math.max(0, evaBudgetHours - scienceHours);
  // Half the walking time must remain for return.
  const oneWayHours = walkHours / 2;
  return oneWayHours * speedKmh * 1000;
}

