import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { daylightMarsHours, seasonName, solarLongitudeDeg } from "./marstime";
import {
  EnlilSimulation, EvaCheckInput, assessSpaceWeather, evaChecks, marsArrivals, parseLmstHours, parseMeda, summarizeMeda,
} from "./conditions";
import { RoverTraverse, nearestStop, roverOnPath } from "./rover";
import { Grid, GridMeta } from "./grid";

const dir = new URL("../../public/data/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const HOUR = 3600000;

describe("Mars season and day length against the NASA MEDA feed", () => {
  const sols = parseMeda(read("meda_snapshot.json"));

  it("reproduces the feed's solar longitude and season for every sol", () => {
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) {
      const ls = solarLongitudeDeg(Date.parse(`${s.terrestrialDate}T12:00:00Z`));
      expect(Math.abs(ls - s.lsDeg!), `sol ${s.sol}`).toBeLessThan(1);
      expect(seasonName(ls, 18.44)).toBe(s.season);
    }
  });

  it("reproduces the feed's sunrise-to-sunset duration at Jezero to within 3 minutes", () => {
    for (const s of sols) {
      const reported = parseLmstHours(s.sunset)! - parseLmstHours(s.sunrise)!;
      expect(Math.abs(daylightMarsHours(18.44, s.lsDeg!) - reported), `sol ${s.sol}`).toBeLessThan(0.05);
    }
  });

  it("places the start of Mars Year 37 (northern spring equinox, 2022-12-26) at Ls 0", () => {
    const ls = solarLongitudeDeg(Date.parse("2022-12-26T12:00:00Z"));
    expect(Math.min(ls, 360 - ls)).toBeLessThan(1);
  });
});

describe("MEDA parsing", () => {
  const raw = {
    sols: [
      { terrestrial_date: "2024-04-26", sol: "1132", ls: "243.4", season: "late autumn", min_temp: -77.9, max_temp: -23.4, pressure: 774.1, sunrise: "06:17:18", sunset: "17:13:27" },
      { terrestrial_date: "2024-04-27", sol: "1133", ls: "244.1", season: "late autumn", min_temp: "--", max_temp: "--", pressure: "--", sunrise: "06:18:07", sunset: "17:13:51" },
    ],
  };

  it("keeps unreported values as null and falls back to the last sol that reported them", () => {
    const sols = parseMeda(raw);
    expect(sols[1].minTempC).toBeNull();
    expect(sols[1].pressurePa).toBeNull();
    const sum = summarizeMeda(sols, Date.parse("2024-04-29T00:00:00Z"))!;
    expect(sum.latest.sol).toBe(1133);
    expect(sum.temp).toMatchObject({ sol: 1132, minC: -77.9, maxC: -23.4 });
    expect(sum.pressure?.pa).toBe(774.1);
    expect(sum.stale).toBe(false);
  });

  it("marks an old report as stale and rejects a feed without sols", () => {
    expect(summarizeMeda(parseMeda(raw), Date.parse("2026-11-14T00:00:00Z"))!.stale).toBe(true);
    expect(() => parseMeda({})).toThrow();
  });
});

describe("space weather assessment", () => {
  const now = Date.parse("2026-11-14T00:00:00Z");
  const iso = (offsetH: number) => new Date(now + offsetH * HOUR).toISOString();
  const sim = (id: string, completed: string, cme: string, arrivalH: number | null, extra: object = {}): EnlilSimulation => ({
    simulationID: id,
    modelCompletionTime: completed,
    cmeInputs: [{ CMEID: cme, speed: 700 }],
    impactList: [
      { location: "STEREO A", arrivalTime: iso(1) },
      ...(arrivalH == null ? [] : [{ location: "Mars", arrivalTime: iso(arrivalH), ...extra }]),
    ],
  });

  it("keeps only Mars arrivals and only the latest model run per CME", () => {
    const arrivals = marsArrivals([
      sim("A/1", "2026-11-10T00:00Z", "cme-a", 60),
      sim("A/2", "2026-11-11T00:00Z", "cme-a", 48),
      sim("B/1", "2026-11-11T00:00Z", "cme-b", null),
      { simulationID: "C/1", modelCompletionTime: "2026-11-11T00:00Z", impactList: null },
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ simulationID: "A/2", cmeSpeedKms: 700 });
  });

  it("grades by distance in time and treats a minor impact as a watch, not an alert", () => {
    const level = (...sims: EnlilSimulation[]) => assessSpaceWeather(marsArrivals(sims), now).level;
    expect(level()).toBe("quiet");
    expect(level(sim("A", iso(-200), "a", 12))).toBe("alert");
    expect(level(sim("A", iso(-200), "a", -12))).toBe("alert");
    expect(level(sim("A", iso(-200), "a", 12, { isMinorImpact: true }))).toBe("watch");
    expect(level(sim("A", iso(-200), "a", 100))).toBe("watch");
    expect(level(sim("A", iso(-200), "a", -60))).toBe("watch");
    expect(level(sim("A", iso(-200), "a", 9 * 24))).toBe("quiet");
    expect(level(sim("A", iso(-400), "a", -100))).toBe("quiet");
  });

  it("reads the shipped snapshot", () => {
    const snap = read("space_weather_snapshot.json");
    const arrivals = marsArrivals(snap.simulations);
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.length).toBeLessThanOrEqual(snap.simulations.length);
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i].arrivalMs).toBeGreaterThanOrEqual(arrivals[i - 1].arrivalMs);
  });
});

describe("pre-EVA checks", () => {
  const quiet = assessSpaceWeather([], 0);
  const base: EvaCheckInput = {
    walkHours: 5.6, scienceHours: 2, budgetHours: 8, daylightEarthHours: 12.2,
    unknownShare: 0, maxSlopeDeg: 6, highSlopeKm: 0, roverOnRoute: { stops: 4, maxTiltDeg: 6 },
    spaceWeather: quiet, spaceWeatherAgeHours: 1,
  };
  const status = (over: Partial<EvaCheckInput>) => Object.fromEntries(evaChecks({ ...base, ...over }).map((c) => [c.id, c.status]));

  it("passes a plan that fits, with fresh quiet space weather", () => {
    expect(status({})).toEqual({ budget: "caution", daylight: "ok", spaceWeather: "ok", slope: "ok", roverTruth: "ok", dataGaps: "ok" });
    expect(status({ walkHours: 4 }).budget).toBe("ok");
  });

  it("flags time overruns against the budget and against daylight", () => {
    expect(status({ walkHours: 7 }).budget).toBe("flag");
    expect(status({ walkHours: 11 }).daylight).toBe("flag");
    expect(status({ daylightEarthHours: 8 }).daylight).toBe("caution");
  });

  it("never reports unknown inputs as passing", () => {
    expect(status({ budgetHours: null }).budget).toBe("unknown");
    expect(status({ daylightEarthHours: null }).daylight).toBe("unknown");
    expect(status({ maxSlopeDeg: null }).slope).toBe("unknown");
    expect(status({ spaceWeather: null }).spaceWeather).toBe("unknown");
    expect(status({ spaceWeatherAgeHours: 100 }).spaceWeather).toBe("unknown");
    expect(status({ roverOnRoute: null }).roverTruth).toBe("unknown");
    expect(status({ roverOnRoute: { stops: 0, maxTiltDeg: null } }).roverTruth).toBe("unknown");
  });

  it("lets rover tilt overrule a gentle grid slope", () => {
    const checks = evaChecks({ ...base, maxSlopeDeg: 2.5, roverOnRoute: { stops: 12, maxTiltDeg: 17.4 } });
    expect(checks.find((c) => c.id === "slope")!.status).toBe("ok");
    const rover = checks.find((c) => c.id === "roverTruth")!;
    expect(rover.status).toBe("caution");
    expect(rover.detail).toContain("17.4");
    expect(rover.detail).toContain("2.5");
  });

  it("raises terrain and space-weather cautions", () => {
    expect(status({ highSlopeKm: 0.6, maxSlopeDeg: 17 }).slope).toBe("caution");
    expect(status({ unknownShare: 0.2 }).dataGaps).toBe("caution");
    const alert = assessSpaceWeather(marsArrivals([{ simulationID: "x", modelCompletionTime: "2026-01-01T00:00Z", impactList: [{ location: "Mars", arrivalTime: new Date(2 * HOUR).toISOString() }] }]), 0);
    expect(status({ spaceWeather: alert, spaceWeatherAgeHours: 100 }).spaceWeather).toBe("flag");
  });
});

describe("rover traverse", () => {
  const traverse = read("m20_traverse.json") as RoverTraverse;
  const R = 3396190;

  it("ships a traverse that starts at the landing site and stays inside Jezero", () => {
    expect(traverse.stops.length).toBeGreaterThan(100);
    expect(traverse.stops[0]).toMatchObject({ sol: 13, site: 3 });
    for (const line of traverse.paths) for (const [lon, lat] of line) {
      expect(lon).toBeGreaterThan(77.1); expect(lon).toBeLessThan(77.6);
      expect(lat).toBeGreaterThan(18.3); expect(lat).toBeLessThan(18.6);
    }
  });

  it("finds the nearest stop and respects the search radius", () => {
    const first = traverse.stops[0];
    const hit = nearestStop(traverse.stops, first.lon, first.lat, R, 50)!;
    expect(hit.distM).toBeLessThan(1);
    expect(hit.stop.sol).toBe(13);
    expect(nearestStop(traverse.stops, 75, 20, R, 1000)).toBeNull();
  });

  it("counts only the stops inside the cells a route crosses", () => {
    const meta = read("dem.meta.json") as GridMeta;
    const grid = new Grid(meta, new Float32Array(meta.rows * meta.cols));
    const landing = grid.toCell(traverse.stops[0].lon, traverse.stops[0].lat)!;
    const inCell = traverse.stops.filter((s) => { const c = grid.toCell(s.lon, s.lat)!; return c.r === landing.r && c.c === landing.c; });
    const here = roverOnPath(traverse.stops, grid, [landing]);
    expect(here.stops).toBe(inCell.length);
    expect(here.maxTiltDeg).toBe(Math.max(...inCell.map((s) => s.tiltDeg ?? -Infinity)));
    expect(roverOnPath(traverse.stops, grid, [{ r: 0, c: 0 }])).toEqual({ stops: 0, maxTiltDeg: null });
  });
});
