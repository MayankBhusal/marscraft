import { Grid, haversineM } from "./grid";

/** An end-of-drive localization of the Perseverance rover. */
export interface RoverStop {
  sol: number;
  site: number;
  drive: number;
  lon: number;
  lat: number;
  /** Rover-reported elevation relative to the Mars areoid, metres. */
  elevM: number | null;
  /** Rover tilt at the stop, degrees. Metre-scale and in situ; not the same quantity as grid slope. */
  tiltDeg: number | null;
  distTotalM: number | null;
}

export interface RoverTraverse {
  source: string;
  sourceUrls: string[];
  retrieved: string;
  lastSol: number;
  totalDistanceM: number;
  simplifyToleranceM: number;
  /** Polylines of [lon, lat]. */
  paths: [number, number][][];
  stops: RoverStop[];
}

/** Closest stop within maxDistM of a point, or null. */
export function nearestStop(
  stops: RoverStop[],
  lon: number,
  lat: number,
  radiusM: number,
  maxDistM = Infinity,
): { stop: RoverStop; distM: number } | null {
  let best: RoverStop | null = null;
  let bestD = Infinity;
  for (const s of stops) {
    const d = haversineM(lon, lat, s.lon, s.lat, radiusM);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best && bestD <= maxDistM ? { stop: best, distM: bestD } : null;
}

/** Rover stops that fall inside the grid cells a route crosses, with the steepest tilt among them. */
export function roverOnPath(stops: RoverStop[], g: Grid, path: { r: number; c: number }[]): { stops: number; maxTiltDeg: number | null } {
  const cells = new Set(path.map((c) => g.idx(c.r, c.c)));
  let count = 0;
  let maxTiltDeg: number | null = null;
  for (const s of stops) {
    const cell = g.toCell(s.lon, s.lat);
    if (!cell || !cells.has(g.idx(cell.r, cell.c))) continue;
    count++;
    if (s.tiltDeg != null && (maxTiltDeg == null || s.tiltDeg > maxTiltDeg)) maxTiltDeg = s.tiltDeg;
  }
  return { stops: count, maxTiltDeg };
}
