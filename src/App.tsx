import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { ROUTE_COLORS, RouteLine, TRAVERSE_COLOR } from "./MapView";
import { Grid, loadGrid } from "./core/grid";
import { CLASS_COLOR, CLASS_LABEL, TerrainClass, classify, computeSlope, elevationRange } from "./core/terrain";
import { ELEV_RAMP, SLOPE_MAX_DEG, SLOPE_RAMP, cssRamp, staticTerrainUrls, reachabilityImage } from "./core/render";
import { PROFILES, PlannedRoute, ProfileId, explain, planRoutes, distanceField, walkBackRadiusM } from "./core/route";
import { assessSpaceWeather, evaChecks, marsArrivals, parseMeda, summarizeMeda, SW_FRESH_HOURS } from "./core/conditions";
import { daylightMarsHours, marsHoursToEarthHours, seasonName, solarLongitudeDeg } from "./core/marstime";
import { RoverTraverse, nearestStop, roverOnPath } from "./core/rover";
import { BASEMAP, DEFAULT_SITE_LAT, DEFAULT_SPEED_KMH, JEZERO_VIEW, POI_CORRIDOR_KM, ROVER_NEAR_M, SAFETY, THERMAL_BLEND_OPACITY } from "./config";
import { DELTA_MARGIN_EVA, MissionScenario } from "./mission";
import { loadMeda, loadRoverTraverse, loadSpaceWeather } from "./nasa";
import { ConditionsPanel, DataInventoryPanel, EvaChecksList, LEVEL_LABEL, Loadable, MedaState, RoverGroundTruth, WeatherState } from "./panels";
import { HiriseFootprint, LayerState, LonLat, PoiFull } from "./types";
import { ElevationProfile, Panel, ProfileMark, SlopeProfile } from "./ui";

const f = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "n/a" : v.toFixed(d));
const coord = (p: LonLat) => `${p.lat.toFixed(4)} N, ${p.lon.toFixed(4)} E`;

const WORKSPACES = ["overview", "explorer", "planner"] as const;
type Workspace = (typeof WORKSPACES)[number];
const WORKSPACE_TITLE: Record<Workspace, string> = { overview: "Mission overview", explorer: "Mars explorer", planner: "Mission planner" };

/** Workspace named by the URL hash (#/planner), so views can be linked, reloaded and stepped through with Back. */
function workspaceFromHash(): Workspace | null {
  const name = window.location.hash.replace(/^#\/?/, "");
  return (WORKSPACES as readonly string[]).includes(name) ? (name as Workspace) : null;
}

type FitTarget = "route" | "region" | "jezero" | LonLat;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(() => workspaceFromHash() ?? "overview");
  const [error, setError] = useState<string | null>(null);
  const [resourceErrors, setResourceErrors] = useState<string[]>([]);
  const [pois, setPois] = useState<PoiFull[]>([]);
  const [hirise, setHirise] = useState<HiriseFootprint[]>([]);
  const [traverse, setTraverse] = useState<RoverTraverse | null>(null);
  const [meda, setMeda] = useState<Loadable<MedaState>>({ state: "loading" });
  const [weather, setWeather] = useState<Loadable<WeatherState>>({ state: "loading" });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [layers, setLayers] = useState<LayerState>({ basemap: true, ctx: true, hiriseMosaic: false, themisDay: false, themisNight: false, minerals: false, hirise: false, traverse: true, elevation: false, slope: false, terrainClass: true, reachability: false, poi: true, routes: true });
  const [opacity, setOpacity] = useState(0.45);
  const [basemap, setBasemap] = useState<"loading" | "ok" | "error">("loading");
  const [hover, setHover] = useState<LonLat | null>(null);
  const [selected, setSelected] = useState<LonLat | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<string | null>(null);
  const [start, setStart] = useState<LonLat | null>(null);
  const [end, setEnd] = useState<LonLat | null>(null);
  const [wpIds, setWpIds] = useState<string[]>([]);
  const [speed, setSpeed] = useState(DEFAULT_SPEED_KMH);
  const [plan, setPlan] = useState<{ routes: PlannedRoute[]; failed: ProfileId[] } | null>(null);
  const [active, setActive] = useState<ProfileId | null>(null);
  const [scenario, setScenario] = useState<MissionScenario | null>(null);
  const [showProfile, setShowProfile] = useState(true);
  const [profileView, setProfileView] = useState<"elevation" | "slope">("elevation");
  const [fit, setFit] = useState<{ seq: number; target: FitTarget }>({ seq: 0, target: "jezero" });
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const skipInvalidate = useRef(false);
  const leftSide = useRef<HTMLElement>(null);
  const rightSide = useRef<HTMLElement>(null);

  const go = useCallback((w: Workspace) => {
    if (workspaceFromHash() !== w) window.location.hash = `/${w}`;
    setWorkspace(w);
  }, []);

  // Keep the workspace in step with the URL (Back / Forward, typed links) and with the 1-3 keys.
  useEffect(() => {
    const onHash = () => setWorkspace(workspaceFromHash() ?? "overview");
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      const w = WORKSPACES[Number(e.key) - 1];
      if (w) go(w);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, [go]);

  useEffect(() => {
    document.title = `${WORKSPACE_TITLE[workspace]} · MarsCraft`;
    leftSide.current?.scrollTo({ top: 0 });
    rightSide.current?.scrollTo({ top: 0 });
  }, [workspace]);

  const refreshWeather = useCallback((force: boolean) => {
    setWeather({ state: "loading" });
    loadSpaceWeather(force).then(
      (feed) => {
        const now = Date.now();
        const assessment = assessSpaceWeather(marsArrivals(feed.data.simulations), now);
        const ageHours = Math.max(0, (now - feed.retrievedMs) / 3600000);
        setNowMs(now);
        setWeather({ state: "ready", value: { feed, assessment, ageHours, level: assessment.level === "quiet" && ageHours > SW_FRESH_HOURS ? "unknown" : assessment.level } });
      },
      (e) => setWeather({ state: "error", message: errorText(e) }),
    );
  }, []);

  useEffect(() => {
    loadGrid().then(setGrid).catch((e) => setError(String(e.message ?? e)));
    let cancelled = false;
    const reportResourceError = (name: string, reason: unknown) => {
      if (!cancelled) {
        const detail = reason instanceof Error ? reason.message : String(reason);
        setResourceErrors((current) => [...current, `${name}: ${detail}`]);
      }
    };
    const loadPois = async () => {
      try {
        const response = await fetch(import.meta.env.BASE_URL + "data/pois.json");
        if (!response.ok) throw new Error(`request failed (${response.status})`);
        const data: { pois?: PoiFull[] } = await response.json();
        if (!Array.isArray(data.pois)) throw new Error("the file has no points-of-interest list");
        if (!cancelled) setPois(data.pois);
      } catch (reason) {
        reportResourceError("Science points", reason);
      }
    };
    const loadHirise = async () => {
      try {
        const response = await fetch(import.meta.env.BASE_URL + "data/hirise_footprints.json");
        if (!response.ok) throw new Error(`request failed (${response.status})`);
        const data: { footprints?: HiriseFootprint[] } = await response.json();
        if (!Array.isArray(data.footprints)) throw new Error("the file has no footprint list");
        if (!cancelled) setHirise(data.footprints);
      } catch (reason) {
        reportResourceError("HiRISE footprints", reason);
      }
    };
    void loadPois();
    void loadHirise();
    loadRoverTraverse().then((t) => { if (!cancelled) setTraverse(t); }, (e) => reportResourceError("Perseverance traverse", e));
    loadMeda().then(
      (feed) => {
        if (cancelled) return;
        try {
          setMeda({ state: "ready", value: { feed, summary: summarizeMeda(parseMeda(feed.data), Date.now()) } });
        } catch (e) {
          setMeda({ state: "error", message: errorText(e) });
        }
      },
      (e) => { if (!cancelled) setMeda({ state: "error", message: errorText(e) }); },
    );
    refreshWeather(false);
    return () => { cancelled = true; };
  }, [refreshWeather]);

  const slope = useMemo(() => (grid ? computeSlope(grid) : null), [grid]);
  const range = useMemo(() => (grid ? elevationRange(grid) : [0, 1] as [number, number]), [grid]);
  const walkBackM = useMemo(() => {
    const budget = scenario?.evaBudgetHours ?? 8;
    const science = scenario?.scienceHours ?? 2;
    return walkBackRadiusM(budget, science, speed);
  }, [scenario, speed]);

  // Static terrain previews only — never recompute on start/end clicks.
  const baseImages = useMemo(() => (grid && slope ? staticTerrainUrls() : null), [grid, slope]);

  const [reachUrl, setReachUrl] = useState<string | null>(null);
  const [reachBusy, setReachBusy] = useState(false);

  // Build reachability off the click path so "Set as start" stays responsive.
  // Only runs when the layer is enabled and a start point exists.
  useEffect(() => {
    if (!layers.reachability || !grid || !slope || !start) {
      setReachUrl(null);
      setReachBusy(false);
      return;
    }
    const cell = grid.toCell(start.lon, start.lat);
    if (!cell) {
      setReachUrl(null);
      return;
    }
    let cancelled = false;
    setReachBusy(true);
    const handle = window.setTimeout(() => {
      try {
        const dist = distanceField(grid, slope, cell, PROFILES.cautious.params, walkBackM);
        if (cancelled) return;
        setReachUrl(reachabilityImage(grid, dist, walkBackM));
      } finally {
        if (!cancelled) setReachBusy(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [layers.reachability, grid, slope, start, walkBackM]);

  const images = useMemo(() => {
    if (!baseImages) return null;
    return { ...baseImages, reachability: reachUrl };
  }, [baseImages, reachUrl]);
  const stats = useMemo(() => {
    if (!grid || !slope) return null;
    const c: Record<TerrainClass, number> = { low: 0, moderate: 0, high: 0, unknown: 0 };
    for (const s of slope) c[classify(s)]++;
    let missing = 0;
    for (const v of grid.elev) if (Number.isNaN(v)) missing++;
    return { c, total: slope.length, missing };
  }, [grid, slope]);

  // User edits to stops invalidate routes; scenario load sets skipInvalidate to keep the new plan.
  useEffect(() => {
    if (skipInvalidate.current) {
      skipInvalidate.current = false;
      return;
    }
    setPlan(null);
    setActive(null);
  }, [start, end, wpIds]);

  useEffect(() => setScrubIdx(null), [plan, active]);

  const lines = useMemo<RouteLine[]>(
    () => (!grid ? [] : (plan?.routes ?? []).map((r) => ({
      profile: r.profile,
      latlngs: r.path.map((c) => [grid.centerLat(c.r), grid.centerLon(c.c)] as [number, number]),
    }))),
    [grid, plan],
  );

  // Rover stop closest to the selected cell, offered as in-situ ground truth.
  const nearRover = useMemo(
    () => (traverse && selected && grid ? nearestStop(traverse.stops, selected.lon, selected.lat, grid.meta.radiusM, ROVER_NEAR_M) : null),
    [traverse, selected, grid],
  );
  const roverMarker = useMemo(
    () => (nearRover && layers.traverse ? { lon: nearRover.stop.lon, lat: nearRover.stop.lat, sol: nearRover.stop.sol } : null),
    [nearRover, layers.traverse],
  );
  const traverseLabel = traverse
    ? `Perseverance traverse · ${(traverse.totalDistanceM / 1000).toFixed(1)} km to sol ${traverse.lastSol}`
    : "Perseverance traverse";

  // Season and day length for today at the EVA start (or the landing site).
  const siteLat = start?.lat ?? DEFAULT_SITE_LAT;
  const sun = useMemo(() => {
    const ls = solarLongitudeDeg(nowMs);
    const marsH = daylightMarsHours(siteLat, ls);
    return { ls, season: seasonName(ls, siteLat), marsH, earthH: marsHoursToEarthHours(marsH) };
  }, [nowMs, siteLat]);

  if (error) {
    return (
      <div className="boot">
        <div className="boot-card">
          <img src={`${import.meta.env.BASE_URL}marscraft-emblem.png`} alt="" />
          <strong>MarsCraft could not start</strong>
          <p className="err">{error}</p>
        </div>
      </div>
    );
  }
  if (!grid || !slope || !images || !stats) {
    return (
      <div className="boot" role="status">
        <div className="boot-card">
          <img src={`${import.meta.env.BASE_URL}marscraft-emblem.png`} alt="" />
          <strong>MarsCraft</strong>
          <p>Loading the Jezero elevation grid…</p>
        </div>
      </div>
    );
  }

  const probe = (p: LonLat) => {
    const cell = grid.toCell(p.lon, p.lat);
    if (!cell) return null;
    const i = grid.idx(cell.r, cell.c);
    const e = grid.elev[i], s = slope[i];
    return { cell, e, s, cls: classify(s), centre: { lon: grid.centerLon(cell.c), lat: grid.centerLat(cell.r) } };
  };
  const poiById = (id: string) => pois.find((x) => x.id === id);
  const sel = selected ? probe(selected) : null;
  const selPoi = selectedPoi ? poiById(selectedPoi) ?? null : null;
  const hov = hover ? probe(hover) : null;
  const snap = (p: LonLat): LonLat => probe(p)?.centre ?? p;

  const handleMapClick = (p: LonLat) => {
    if (!grid.toCell(p.lon, p.lat)) return;
    setSelected(snap(p)); setSelectedPoi(null);
  };
  const handlePoi = (id: string) => {
    setSelectedPoi(id);
    const poi = poiById(id);
    if (poi) setSelected({ lon: poi.lon, lat: poi.lat });
  };
  const requestFit = (target: FitTarget) => setFit((v) => ({ seq: v.seq + 1, target }));
  /** Select a science target from a list and bring it into view. */
  const focusPoi = (id: string) => {
    const poi = poiById(id);
    if (!poi) return;
    handlePoi(id);
    requestFit({ lon: poi.lon, lat: poi.lat });
  };

  const stopsReady = !!start && !!end;
  const runWith = (
    s: LonLat,
    e: LonLat,
    waypointIds: string[],
    preferred: ProfileId = "balanced",
  ) => {
    const cell = (p: LonLat) => grid.toCell(p.lon, p.lat);
    if (!cell(s) || !cell(e)) return;
    const wps = waypointIds.map((id) => poiById(id)!).filter(Boolean);
    for (const w of wps) if (!cell({ lon: w.lon, lat: w.lat })) return;
    const stops = [cell(s)!, ...wps.map((w) => cell({ lon: w.lon, lat: w.lat })!), cell(e)!];
    const res = planRoutes(grid, slope, stops, pois.map(({ id, name, lon, lat }) => ({ id, name, lon, lat })), POI_CORRIDOR_KM);
    setPlan(res);
    const pick =
      res.routes.find((r) => r.profile === preferred)?.profile ??
      res.routes.find((r) => r.profile === "balanced")?.profile ??
      res.routes[0]?.profile ??
      null;
    setActive(pick);
  };

  const run = () => {
    if (!start || !end) return;
    runWith(start, end, wpIds, scenario?.preferredProfile ?? "balanced");
    setShowProfile(true);
    requestFit("route");
  };

  /** Load the demonstration Marswalk: points, speed, brief, and planned routes. */
  const loadScenario = (sc: MissionScenario = DELTA_MARGIN_EVA) => {
    const sp = poiById(sc.startPoiId);
    const dp = poiById(sc.destinationPoiId);
    if (!sp || !dp) return;
    const s = { lon: sp.lon, lat: sp.lat };
    const e = { lon: dp.lon, lat: dp.lat };
    const wps = sc.waypointPoiIds.filter((id) => !!poiById(id));
    skipInvalidate.current = true;
    setScenario(sc);
    setStart(s);
    setEnd(e);
    setWpIds(wps);
    setSpeed(sc.speedKmh);
    setSelected(s);
    setSelectedPoi(sc.startPoiId);
    // Layers for the scenario's science goal: mineral signatures over high-resolution
    // imagery. The slope-class tint is left off because its green competes with the
    // CRISM carbonate green; class along the route stays visible on the profile strip.
    // Without Trek imagery the bundled slope class stays on so the map is never blank.
    setLayers((L) => ({ ...L, ctx: true, minerals: true, traverse: true, terrainClass: basemap === "error", elevation: false, slope: false, poi: true, routes: true }));
    runWith(s, e, wps, sc.preferredProfile);
    setShowProfile(true);
    requestFit("route");
    // The comparison, checks and exports live in the planner.
    go("planner");
  };

  const activeRoute = plan?.routes.find((r) => r.profile === active) ?? null;
  const synth = grid.meta.synthetic;
  const cellKm = (grid.meta.dLat * Math.PI / 180 * grid.meta.radiusM) / 1000;
  const weatherNow = weather.state === "ready" ? weather.value : null;
  const medaNow = meda.state === "ready" ? meda.value.summary : null;

  const cellLatLng = (c: { r: number; c: number }) => [grid.centerLat(c.r), grid.centerLon(c.c)] as [number, number];
  const fitLatLngs: [number, number][] | undefined =
    fit.target === "route" ? activeRoute?.path.map(cellLatLng)
    : fit.target === "region" ? [[grid.south, grid.meta.west], [grid.meta.north, grid.east]]
    : fit.target === "jezero" ? [[JEZERO_VIEW.south, JEZERO_VIEW.west], [JEZERO_VIEW.north, JEZERO_VIEW.east]]
    : [[fit.target.lat, fit.target.lon]];

  const scrubCell = scrubIdx == null ? null : activeRoute?.path[scrubIdx] ?? null;
  const scrubPoint = scrubCell ? { lon: grid.centerLon(scrubCell.c), lat: grid.centerLat(scrubCell.r) } : null;

  // Where each science stop falls along the active route, for the profile markers.
  const profileMarks: ProfileMark[] = [];
  if (activeRoute) {
    let from = 0;
    wpIds.forEach((id, n) => {
      const poi = poiById(id);
      const cell = poi ? grid.toCell(poi.lon, poi.lat) : null;
      if (!cell) return;
      const at = activeRoute.path.findIndex((c, i) => i >= from && c.r === cell.r && c.c === cell.c);
      if (at === -1) return;
      profileMarks.push({ index: at, label: `Science stop ${n + 1}` });
      from = at;
    });
  }

  const walkHours = activeRoute ? activeRoute.metrics.distanceKm / speed : 0;
  const scienceHours = scenario?.scienceHours ?? 0;
  const checks = activeRoute
    ? evaChecks({
        walkHours,
        scienceHours,
        budgetHours: scenario?.evaBudgetHours ?? null,
        daylightEarthHours: sun.earthH,
        unknownShare: activeRoute.metrics.unknownShare,
        maxSlopeDeg: activeRoute.metrics.maxSlopeDeg,
        highSlopeKm: activeRoute.metrics.distanceByClassKm.high,
        roverOnRoute: traverse ? roverOnPath(traverse.stops, grid, activeRoute.path) : null,
        spaceWeather: weatherNow?.assessment ?? null,
        spaceWeatherAgeHours: weatherNow?.ageHours ?? null,
      })
    : [];
  /** GCR dose equivalent for the planned EVA at the quiet-sun Gale rate; order of magnitude only. */
  const evaDoseMsv = (SAFETY.gcrDoseMsvPerDay * (walkHours + scienceHours)) / 24;

  const geojson = () => {
    if (!plan || !start || !end) return;
    const fc = {
      type: "FeatureCollection",
      properties: { synthetic_terrain: synth, terrain_source: grid.meta.source, crs: "Mars planetocentric lon/lat (deg), east positive" },
      features: [
        ...plan.routes.map((r) => ({
          type: "Feature",
          properties: { profile: r.label, duplicate_of: r.duplicateOf, ...r.metrics },
          geometry: { type: "LineString", coordinates: r.path.map((c) => [grid.centerLon(c.c), grid.centerLat(c.r)]) },
        })),
        { type: "Feature", properties: { role: "start" }, geometry: { type: "Point", coordinates: [start.lon, start.lat] } },
        { type: "Feature", properties: { role: "destination" }, geometry: { type: "Point", coordinates: [end.lon, end.lat] } },
        ...wpIds.map((id) => poiById(id)!).filter(Boolean).map((w) => ({ type: "Feature", properties: { role: "waypoint", name: w.name }, geometry: { type: "Point", coordinates: [w.lon, w.lat] } })),
      ],
    };
    download("marscraft-routes.geojson", JSON.stringify(fc, null, 2), "application/geo+json");
  };

  const summaryText = () => {
    if (!activeRoute || !start || !end) return;
    const m = activeRoute.metrics;
    const t = [
      `MarsCraft mission summary (${activeRoute.label} route)`,
      scenario ? `Scenario: ${scenario.title}` : "Scenario: free-form plan",
      scenario ? `Objective: ${scenario.objective}` : "",
      synth ? "WARNING: terrain is SYNTHETIC development data, not NASA measurements." : `Terrain source: ${grid.meta.source}`,
      `Start: ${coord(start)}`,
      `Destination: ${coord(end)}`,
      `Waypoints: ${wpIds.map((id) => poiById(id)?.name).join("; ") || "none"}`,
      `Distance: ${m.distanceKm.toFixed(2)} km`,
      `Assumed speed (user input, not validated): ${speed} km/h -> ${f(m.distanceKm / speed, 1)} h`,
      `Terrain along route (km): low ${f(m.distanceByClassKm.low, 2)}, moderate ${f(m.distanceByClassKm.moderate, 2)}, high ${f(m.distanceByClassKm.high, 2)}, unknown ${f(m.distanceByClassKm.unknown, 2)}`,
      `Mean slope (known cells): ${f(m.meanSlopeDeg)} deg; max ${f(m.maxSlopeDeg)} deg`,
      `Cumulative ascent / descent (derived): ${f(m.ascentM, 0)} m / ${f(m.descentM, 0)} m`,
      `Science targets within ${POI_CORRIDOR_KM} km: ${m.nearbyPois.map((p) => `${p.name} (${p.distKm.toFixed(1)} km)`).join("; ") || "none"}`,
      `Reference cost (Balanced model): ${m.referenceCost.toFixed(2)} cost-km`,
      "",
      "--- Pre-EVA planning checks (assumptions, not flight rules) ---",
      ...checks.map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`),
      "",
      "--- Conditions ---",
      `Season: ${sun.season}, Ls ${sun.ls.toFixed(1)} deg; daylight ${sun.earthH.toFixed(1)} h at ${siteLat.toFixed(2)} N (computed, flat horizon).`,
      medaNow
        ? `MEDA (Perseverance) sol ${medaNow.latest.sol}, ${medaNow.latest.terrestrialDate}: air ${medaNow.temp ? `${medaNow.temp.minC.toFixed(0)} to ${medaNow.temp.maxC.toFixed(0)} C` : "not reported"}, pressure ${medaNow.pressure ? `${medaNow.pressure.pa.toFixed(0)} Pa` : "not reported"}${medaNow.stale ? ` (archived report, ${Math.round(medaNow.ageDays)} days old)` : ""}.`
        : "MEDA surface weather: unavailable.",
      weatherNow
        ? `Space weather (NASA DONKI WSA-ENLIL, ${weatherNow.feed.origin}, retrieved ${new Date(weatherNow.feed.retrievedMs).toISOString()}): ${LEVEL_LABEL[weatherNow.level]}; ${weatherNow.assessment.next ? `next predicted CME arrival at Mars ${weatherNow.assessment.next.arrivalIso}` : "no upcoming CME arrival at Mars listed"}.`
        : "Space weather: unavailable.",
      "",
      "--- Safety notes ---",
      `GCR dose equivalent ~${SAFETY.gcrDoseMsvPerDay} mSv/day (~${SAFETY.gcrDoseMgyPerDay} mGy/day absorbed; Curiosity RAD / Gale; not Jezero-specific), i.e. ~${evaDoseMsv.toFixed(2)} mSv for this EVA under quiet conditions.`,
      SAFETY.speNote,
      "Not modelled: roughness, rock abundance, terrain shadowing, particle-event dose, suit mobility limits.",
      "Slope classes and cost profiles are planning assumptions, not certified mobility limits.",
      "", ...explain(plan!.routes),
    ];
    download("marscraft-mission-summary.txt", t.join("\n"), "text/plain");
  };

  const toggle = (k: keyof LayerState) => setLayers((l) => {
    const next = { ...l, [k]: !l[k] };
    // When NASA Trek imagery is unreachable, keep one bundled terrain layer on so
    // the map never goes blank. With imagery available, any combination is allowed.
    const localOn = next.elevation || next.slope || next.terrainClass;
    if (basemap === "error" && !localOn && (k === "elevation" || k === "slope" || k === "terrainClass")) {
      return { ...next, elevation: true };
    }
    return next;
  });

  const workspaceCopy: Record<Workspace, { eyebrow: string; title: string; description: string; action: string; next: Workspace }> = {
    overview: { eyebrow: "MISSION CONTROL / JEZERO", title: "Mission overview", description: "Scenario brief, current conditions and the NASA data behind this view.", action: "Explore surface", next: "explorer" },
    explorer: { eyebrow: "SURFACE OPERATIONS / JEZERO", title: "Mars explorer", description: "Layer imagery, thermal, mineral and rover data; inspect any location.", action: plan ? "Review routes" : start && end ? "Plan this traverse" : "Open planner", next: "planner" },
    planner: { eyebrow: "TRAVERSE DESIGN / JEZERO", title: "Mission planner", description: "Choose science stops, compare terrain-aware routes and run the pre-EVA checks.", action: "Back to explorer", next: "explorer" },
  };

  const activeLayerCount = (Object.keys(layers) as (keyof LayerState)[]).filter((k) => layers[k]).length;
  const flagged = checks.filter((c) => c.status === "flag").length;
  const cautions = checks.filter((c) => c.status === "caution").length;
  const navStatus: Record<Workspace, string> = {
    overview: scenario ? "Scenario loaded" : "Scenario & data status",
    explorer: `${activeLayerCount} layers on${selected ? " · point selected" : ""}`,
    planner: activeRoute
      ? `${f(activeRoute.metrics.distanceKm, 1)} km ${activeRoute.label}${flagged ? ` · ${flagged} flagged` : cautions ? ` · ${cautions} caution${cautions > 1 ? "s" : ""}` : " · checks pass"}`
      : start && end ? "Stops set · ready to plan" : start || end ? "One stop set" : "Routes & EVA checks",
  };
  const openPlannerAction = () => {
    if (workspace === "explorer" && start && end && !plan) run();
    go(workspaceCopy[workspace].next);
  };
  const remainingPois = pois.filter((poi) => !wpIds.includes(poi.id));

  return (
    <div className={`app workspace-${workspace}`} data-workspace={workspace}>
      <aside className="side left" data-workspace={workspace} ref={leftSide}>
        <div className="brand-block">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}marscraft-emblem.png`} alt="MarsCraft emblem" />
          <div className="brand-copy"><h1>MarsCraft</h1><small>HUMAN SURFACE EXPLORATION</small></div>
          <span className="brand-region">JEZERO</span>
        </div>
        <div className="workspace-nav-label">WORKSPACES</div>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {WORKSPACES.map((w, i) => (
            <a
              key={w}
              href={`#/${w}`}
              className={`workspace-nav-item${workspace === w ? " active" : ""}`}
              aria-current={workspace === w ? "page" : undefined}
              title={`${WORKSPACE_TITLE[w]} (press ${i + 1})`}
            >
              <span className="nav-index">0{i + 1}</span>
              <span className="nav-label"><strong>{WORKSPACE_TITLE[w]}</strong><small>{navStatus[w]}</small></span>
            </a>
          ))}
        </nav>
        <div className="side-divider" />
        <div className="howto workspace-panel overview-panel">
          <strong>Quick path</strong>
          <ol>
            <li>Load the demo EVA, or pick a start and destination on the map.</li>
            <li>Check the layers and current conditions, then compare routes (prefer Cautious near steep or unknown ground).</li>
            <li>Run the pre-EVA checks, trace the elevation profile and export the summary.</li>
          </ol>
        </div>
        {synth && (
          <div className="warn"><strong>Synthetic terrain.</strong> The elevation grid is generated development data, not NASA measurements. Slopes and routes below do not describe the real surface. Points of interest are real literature locations drawn over this fake terrain. Run <code>npm run data:real</code> to load the USGS MOLA/HRSC DEM.</div>
        )}
        {resourceErrors.map((message) => <div className="warn err" key={message}>{message}. Affected layers may be unavailable.</div>)}
        <Panel title="Layers" className="workspace-panel explorer-panel planner-panel" info="Show or hide map data. Topography, minerals and the rover traverse are bundled and work offline. Viking, CTX, HiRISE and THEMIS imagery streams from NASA Mars Trek. Imagery sits beneath the topography overlays, so lower the overlay opacity to see more of it.">
          <div className="layer-group">Imagery · optical</div>
          <label className="row"><input type="checkbox" checked={layers.basemap} onChange={() => toggle("basemap")} />Viking colour mosaic <span className="tag">232 m</span></label>
          <div className="sub">{basemap === "error" ? <span className="err">NASA Trek imagery is unreachable from this network. Topography, minerals and the rover traverse are bundled and still work.</span> : basemap === "loading" ? "Loading tiles..." : "Regional context, NASA Mars Trek"}</div>
          <label className="row"><input type="checkbox" checked={layers.ctx} onChange={() => toggle("ctx")} />CTX mosaic, Jezero <span className="tag">6 m</span></label>
          <label className="row"><input type="checkbox" checked={layers.hiriseMosaic} onChange={() => toggle("hiriseMosaic")} />HiRISE mosaic, Jezero <span className="tag">25 cm</span></label>
          {layers.hiriseMosaic && <div className="sub">Boulder-scale imagery (MRO). Zoom in along the route to see individual rocks and outcrops.</div>}
          <label className="row"><input type="checkbox" checked={layers.hirise} onChange={() => toggle("hirise")} />HiRISE footprints <span className="tag">approx.</span></label>
          {layers.hirise && <div className="sub">Approximate boxes marking other high-resolution coverage; not image tiles.</div>}

          <div className="layer-group">Thermal · spectral</div>
          <label className="row"><input type="checkbox" checked={layers.themisDay} onChange={() => toggle("themisDay")} />THEMIS day infrared <span className="tag">100 m</span></label>
          <label className="row"><input type="checkbox" checked={layers.themisNight} onChange={() => toggle("themisNight")} />THEMIS night infrared <span className="tag">100 m</span></label>
          {(layers.themisDay || layers.themisNight) && (
            <div className="sub">
              {basemap === "error"
                ? <span className="err">THEMIS also streams from NASA Trek and is unreachable.</span>
                : <>Day: brighter is warmer. Night: rocky, high-inertia ground stays brighter; dust and sand go dark.{(layers.ctx || layers.hiriseMosaic) && ` Blended at ${Math.round(THERMAL_BLEND_OPACITY * 100)}% over the high-resolution imagery.`}</>}
            </div>
          )}
          <label className="row"><input type="checkbox" checked={layers.minerals} onChange={() => toggle("minerals")} />CRISM mineral signatures <span className="tag">figure</span></label>
          {layers.minerals && (
            <div className="sub">
              Green ≈ carbonates; red ≈ olivine (PIA23380). Publication figure with approximate georeference — use for science context, not surveying.
            </div>
          )}

          <div className="layer-group">In situ</div>
          <label className="row"><input type="checkbox" checked={layers.traverse} onChange={() => toggle("traverse")} disabled={!traverse} />Perseverance traverse <span className="tag">Mars 2020</span></label>
          {layers.traverse && traverse && (
            <div className="sub">{(traverse.totalDistanceM / 1000).toFixed(1)} km actually driven, to sol {traverse.lastSol}. Select a point within {ROVER_NEAR_M / 1000} km of it to compare the grid with rover measurements and camera views.</div>
          )}

          <div className="layer-group">Topography · this grid</div>
          <label className="row"><input type="checkbox" checked={layers.elevation} onChange={() => toggle("elevation")} />Elevation <span className="tag">{synth ? "synthetic" : "DEM"}</span></label>
          <label className="row"><input type="checkbox" checked={layers.slope} onChange={() => toggle("slope")} />Slope <span className="tag derived">derived</span></label>
          <label className="row"><input type="checkbox" checked={layers.terrainClass} onChange={() => toggle("terrainClass")} />Slope class <span className="tag derived">derived</span></label>
          <label className="row range">Overlay opacity <input type="range" min={0.15} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} aria-label="Topography overlay opacity" /><span>{Math.round(opacity * 100)}%</span></label>

          <div className="layer-group">Planning</div>
          <label className="row"><input type="checkbox" checked={layers.reachability} onChange={() => toggle("reachability")} disabled={!start} />Walk-back reachability <span className="tag derived">derived</span></label>
          {!start && <div className="sub">Set a start point to enable the walk-back range.</div>}
          {layers.reachability && start && (
            <div className="sub">
              {reachBusy
                ? "Computing walk-back range…"
                : `Cyan-blue = reachable from start with return still possible within half the walking budget (${f(walkBackM / 1000, 1)} km one-way at ${speed} km/h; Cautious exclusions).`}
            </div>
          )}
          <label className="row"><input type="checkbox" checked={layers.poi} onChange={() => toggle("poi")} />Scientific points of interest</label>
          <label className="row"><input type="checkbox" checked={layers.routes} onChange={() => toggle("routes")} />Planned routes <span className="tag derived">derived</span></label>
        </Panel>
        <Panel title="Science targets" className="workspace-panel explorer-panel" info="Literature-sourced points of interest. Choosing one selects it and moves the map to it; its details, caveats and any rover ground truth appear under Selected location.">
          <ul className="target-list">
            {pois.map((poi) => (
              <li key={poi.id}>
                <button type="button" className={`target${selectedPoi === poi.id ? " active" : ""}`} onClick={() => focusPoi(poi.id)}>
                  <strong>{poi.name.split(" (")[0]}</strong>
                  <small>{poi.category}{wpIds.includes(poi.id) ? " · waypoint" : ""}</small>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Legend" className="legend workspace-panel explorer-panel planner-panel" info="Colour keys for active overlays and routes. Derived layers are computed here from the DEM, not separate NASA products.">
          {layers.elevation && (<div><div>Elevation (m)</div><div className="bar" style={{ background: cssRamp(ELEV_RAMP) }} /><div className="ends"><span>{f(range[0], 0)}</span><span>{f(range[1], 0)}</span></div></div>)}
          {layers.slope && (<div style={{ marginTop: 6 }}><div>Slope (degrees, computed)</div><div className="bar" style={{ background: cssRamp(SLOPE_RAMP) }} /><div className="ends"><span>0</span><span>{SLOPE_MAX_DEG}+</span></div></div>)}
          {layers.terrainClass && (<div style={{ marginTop: 6 }}>{(Object.keys(CLASS_COLOR) as TerrainClass[]).map((k) => (<div className="item" key={k}><span className="sw" style={{ background: `rgb(${CLASS_COLOR[k].join(",")})` }} />{CLASS_LABEL[k]}</div>))}</div>)}
          {(layers.elevation || layers.slope) && (<div className="item" style={{ marginTop: 4 }}><span className="sw" style={{ background: "rgb(110,110,110)" }} />Missing data (not safe, not flat)</div>)}
          {layers.poi && (<div className="item" style={{ marginTop: 4 }}><span className="sw" style={{ background: "#f2f2f2", borderRadius: 7, border: "2px solid #1d1d1d" }} />Point of interest (filled purple: route waypoint)</div>)}
          {layers.routes && (<div style={{ marginTop: 4 }}>{(Object.keys(PROFILES) as ProfileId[]).map((k) => (<div className="item" key={k}><span className="sw" style={{ background: ROUTE_COLORS[k] }} />{PROFILES[k].label} route</div>))}</div>)}
          {(layers.themisDay || layers.themisNight) && (
            <div className="item" style={{ marginTop: 6 }}>
              <span className="sw" style={{ background: "linear-gradient(90deg,#1a1a2e,#e8e0d0)" }} />
              THEMIS IR: bright = warmer (day) / higher inertia (night)
            </div>
          )}
          {layers.minerals && (
            <div className="item" style={{ marginTop: 4 }}>
              <span className="sw" style={{ background: "linear-gradient(90deg,#c44,#4a8,#c84)" }} />
              CRISM: red ≈ olivine · green ≈ carbonates
            </div>
          )}
          {layers.hirise && (
            <div className="item" style={{ marginTop: 4 }}>
              <span className="sw" style={{ background: "transparent", border: "2px dashed #c45c26" }} />
              HiRISE footprint (approx. high-res coverage)
            </div>
          )}
          {layers.reachability && (
            <div className="item" style={{ marginTop: 4 }}>
              <span className="sw" style={{ background: "rgba(0,190,255,0.7)" }} />
              Walk-back reachability (from start)
            </div>
          )}
          {layers.traverse && (
            <>
              <div className="item" style={{ marginTop: 4 }}>
                <span className="sw line" style={{ background: TRAVERSE_COLOR }} />
                Perseverance traverse (driven path)
              </div>
              <div className="item">
                <span className="sw pin-key">R</span>
                Rover stop nearest the selected point
              </div>
            </>
          )}
        </Panel>
        <Panel title="About this data" className="workspace-panel overview-panel explorer-panel" info="Working grid is a cropped HRSC+MOLA blend around Jezero. Product names, processing steps, and limits are in DATA_SOURCES.md and METHODOLOGY.md.">
          <dl className="kv">
            <dt>Extent</dt><dd>{grid.south.toFixed(1)} to {grid.meta.north.toFixed(1)} N, {grid.meta.west.toFixed(1)} to {grid.east.toFixed(1)} E</dd>
            <dt>Cell size</dt><dd>{grid.meta.dLon.toFixed(4)} deg (about {cellKm.toFixed(2)} km)</dd>
            <dt>Missing elevation</dt><dd>{(stats.missing / stats.total * 100).toFixed(1)}% of cells</dd>
            <dt>Unknown slope</dt><dd>{(stats.c.unknown / stats.total * 100).toFixed(1)}% of cells</dd>
            <dt>Low / mod / high</dt><dd>{(stats.c.low / stats.total * 100).toFixed(0)}% / {(stats.c.moderate / stats.total * 100).toFixed(0)}% / {(stats.c.high / stats.total * 100).toFixed(0)}%</dd>
          </dl>
          <div style={{ marginTop: 8 }}><strong>Elevation:</strong> {grid.meta.title}</div>
          <div className="sub" style={{ marginLeft: 0 }}>{grid.meta.source}{grid.meta.sourceUrl && <> <a href={grid.meta.sourceUrl} target="_blank" rel="noreferrer">Record</a></>}</div>
          <div style={{ marginTop: 4 }}><strong>Imagery:</strong> {BASEMAP.name}; CTX and HiRISE orthomosaics inside Jezero</div>
          <div style={{ marginTop: 4 }}><strong>Slope:</strong> Horn 3×3 on this DEM (derived).</div>
          {traverse && (
            <div style={{ marginTop: 4 }}><strong>In situ:</strong> Perseverance traverse to sol {traverse.lastSol}, retrieved {traverse.retrieved}.</div>
          )}
          <details className="disclosure" style={{ marginTop: 4 }}>
            <summary>Processing and limitations</summary>
            <div className="disclosure-body">
              <ul className="plain">{grid.meta.processing.map((x, i) => <li key={"p" + i}>{x}</li>)}{grid.meta.limitations.map((x, i) => <li key={"l" + i}>{x}</li>)}</ul>
            </div>
          </details>
        </Panel>
      </aside>

      <main className="mapwrap">
        <header className="workspace-header">
          <div className="workspace-heading-copy">
            <span className="workspace-eyebrow">{workspaceCopy[workspace].eyebrow}</span>
            <strong>{workspaceCopy[workspace].title}</strong>
            <span>{workspaceCopy[workspace].description}</span>
          </div>
          <div className="header-chips" role="group" aria-label="Current conditions summary">
            <span className="chip daylight" title={`Sunrise to sunset today at ${siteLat.toFixed(2)}° N (computed, flat horizon)`}>
              <small>DAYLIGHT</small>{sun.earthH.toFixed(1)} h
            </span>
            <span className="chip season" title="Season at the site, from today's solar longitude">
              <small>SEASON</small>{sun.season}
            </span>
            <span className={`chip level ${weatherNow?.level ?? "unknown"}`} title="Predicted CME arrivals at Mars (NASA DONKI). Details under Current conditions.">
              <small>SPACE WEATHER</small>{weather.state === "loading" ? "checking…" : LEVEL_LABEL[weatherNow?.level ?? "unknown"]}
            </span>
          </div>
          <button type="button" className="workspace-header-action" onClick={openPlannerAction}>
            {workspaceCopy[workspace].action}<span aria-hidden="true">→</span>
          </button>
        </header>
        <div className="map-area">
          <MapView
            grid={grid} images={images} layers={layers} overlayOpacity={opacity} pois={pois} hirise={hirise}
            traverse={traverse?.paths ?? null} traverseLabel={traverseLabel} roverStop={roverMarker} scrub={scrubPoint}
            selected={selected} selectedPoiId={selectedPoi} start={start} end={end} waypointIds={wpIds}
            routes={lines} activeProfile={active}
            initialView={JEZERO_VIEW}
            fitSeq={fit.seq}
            fitLatLngs={fitLatLngs}
            onMapClick={handleMapClick} onHover={setHover} onPoiClick={handlePoi} onBasemapStatus={(s) => {
              setBasemap(s);
              if (s === "error") {
                // Remote Trek tiles blocked — keep a local DEM visible so the map is never blank.
                setLayers((L) => ({ ...L, elevation: true }));
              }
            }}
          />
          {synth && <div className="overlay-note">Synthetic terrain: not NASA data</div>}
          <div className="map-tools" role="group" aria-label="Map view">
            <button type="button" onClick={() => requestFit("jezero")} title="Jezero crater, delta and rover traverse">Jezero</button>
            <button type="button" onClick={() => requestFit("region")} title="Whole analysed grid">Region</button>
            <button type="button" onClick={() => requestFit("route")} disabled={!activeRoute} title={activeRoute ? "Fit the active route" : "Plan a route first"}>Route</button>
            {activeRoute && !showProfile && (
              <button type="button" aria-label="Show elevation profile" onClick={() => { setProfileView("elevation"); setScrubIdx(null); setShowProfile(true); }} title="Show elevation profile">Profile</button>
            )}
          </div>
        </div>
        {activeRoute && showProfile && (
          <div className="profile-dock">
            <div className="profile-dock-head">
              <span>Route profile · {activeRoute.label} · {f(activeRoute.metrics.distanceKm, 2)} km</span>
              <div className="profile-dock-actions">
                <div className="profile-tabs" role="group" aria-label="Profile type">
                  <button type="button" aria-pressed={profileView === "elevation"} onClick={() => { setProfileView("elevation"); setScrubIdx(null); }}>Elevation Profile</button>
                  <button type="button" aria-pressed={profileView === "slope"} onClick={() => { setProfileView("slope"); setScrubIdx(null); }}>Slope Profile</button>
                </div>
                <button type="button" className="text-btn" onClick={() => setShowProfile(false)}>Hide</button>
              </div>
            </div>
            {profileView === "elevation"
              ? <ElevationProfile grid={grid} slope={slope} path={activeRoute.path} marks={profileMarks} onScrub={setScrubIdx} />
              : <SlopeProfile grid={grid} slope={slope} path={activeRoute.path} marks={profileMarks} onScrub={setScrubIdx} />}
          </div>
        )}
      </main>

      <aside className="side right" data-workspace={workspace} ref={rightSide}>
        {activeRoute && (
          <button
            type="button"
            className="plan-status workspace-panel planner-panel"
            onClick={() => document.getElementById("mission-summary")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            title="Jump to the pre-EVA checks and mission summary"
          >
            <span className="sw" style={{ background: ROUTE_COLORS[activeRoute.profile] }} />
            <span className="plan-status-main">
              <strong>{activeRoute.label} route · {f(activeRoute.metrics.distanceKm, 2)} km · {f(walkHours + scienceHours, 1)} h</strong>
              <small>
                {checks.filter((c) => c.status === "ok").length} pass · {cautions} caution · {flagged} flagged · {checks.filter((c) => c.status === "unknown").length} unknown
              </small>
            </span>
            <span className="plan-status-go">Checks ↓</span>
          </button>
        )}
        <Panel title="Selected location" className="workspace-panel explorer-panel planner-panel" info="Click the map or a point of interest. Slope class is a planning bin, not a certified safety limit. Missing elevation is treated as unknown, never as flat or safe.">
          {!selected && (
            <div className="sub" style={{ marginLeft: 0 }}>
              Click the map or a point of interest to inspect it{workspace === "planner" ? ", then set it as the start or destination" : ""}.
            </div>
          )}
          {selected && sel && (
            <>
              <dl className="kv">
                <dt>Position</dt><dd>{coord(selected)}</dd>
                <dt>Elevation</dt><dd>{Number.isNaN(sel.e) ? <span className="err">missing in source grid</span> : `${sel.e.toFixed(0)} m`} <span className="tag">{synth ? "synthetic" : "DEM"}</span></dd>
                <dt>Slope</dt><dd>{Number.isNaN(sel.s) ? <span className="err">unknown (missing neighbour data or grid edge)</span> : `${sel.s.toFixed(1)} deg`} <span className="tag derived">derived</span></dd>
                <dt>Class</dt><dd>{CLASS_LABEL[sel.cls]}</dd>
                <dt>Data</dt><dd>{sel.cls === "unknown" ? "Insufficient. Not treated as safe." : "Elevation and neighbours available."}</dd>
              </dl>
              {!selPoi && (
                <div className="btns">
                  <button onClick={() => setStart(selected)}>Set as start</button>
                  <button onClick={() => setEnd(selected)}>Set as destination</button>
                </div>
              )}
            </>
          )}
          {selPoi && (
            <div style={{ marginTop: 8, borderTop: "1px solid #e2e2de", paddingTop: 6 }}>
              <strong>{selPoi.name}</strong>
              <div><span className="tag">{selPoi.category}</span></div>
              <div className="btns">
                <button onClick={() => setStart({ lon: selPoi.lon, lat: selPoi.lat })}>Start here</button>
                <button onClick={() => setEnd({ lon: selPoi.lon, lat: selPoi.lat })}>Destination here</button>
                <button onClick={() => setWpIds((w) => (w.includes(selPoi.id) ? w : [...w, selPoi.id]))} disabled={wpIds.includes(selPoi.id)}>{wpIds.includes(selPoi.id) ? "Waypoint added" : "Add as waypoint"}</button>
              </div>
              {/* Open while exploring; folded in the planner so route results stay in reach. */}
              <details className="poi-details disclosure" open={workspace !== "planner"}>
                <summary>Science notes, sources and surface view</summary>
                <div className="disclosure-body">
                  <dl className="kv" style={{ marginTop: 4 }}>
                    <dt>Status</dt><dd>{selPoi.status}</dd>
                    <dt>Summary</dt><dd>{selPoi.summary}</dd>
                    <dt>Reported</dt><dd>{selPoi.observations}</dd>
                    <dt>Instrument</dt><dd>{selPoi.mission}</dd>
                    <dt>Source</dt><dd>{selPoi.source}</dd>
                    <dt>Caveats</dt><dd>{selPoi.uncertainty}</dd>
                  </dl>
                  {selPoi.pov && (
                    <div className="pov">
                      <div className="pov-title">What you may see · {selPoi.pov.title}</div>
                      <img
                        src={selPoi.pov.url.startsWith("http") ? selPoi.pov.url : (import.meta.env.BASE_URL + selPoi.pov.url)}
                        alt={selPoi.pov.title}
                        loading="lazy"
                      />
                      <div className="sub" style={{ marginLeft: 0 }}>{selPoi.pov.caption}</div>
                      <div className="sub" style={{ marginLeft: 0 }}>
                        {selPoi.pov.credit}
                        {selPoi.pov.sourceUrl && <> · <a href={selPoi.pov.sourceUrl} target="_blank" rel="noreferrer">Source</a></>}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}
          {selected && sel && nearRover && (
            <RoverGroundTruth stop={nearRover.stop} distM={nearRover.distM} gridElevM={sel.e} gridSlopeDeg={sel.s} cellKm={cellKm} />
          )}
        </Panel>

        <Panel title="Marswalk planner" className="workspace-panel planner-panel" info="Set start, destination, and optional science waypoints, then plan three cost profiles. Walking speed only estimates duration — it is not validated mobility data.">
          <dl className="kv">
            <dt>Start</dt><dd>{start ? <>{coord(snap(start))} <button onClick={() => setStart(null)}>Clear</button></> : <span className="sub" style={{ marginLeft: 0 }}>not set</span>}</dd>
            <dt>Destination</dt>
            <dd>
              {end ? <>{coord(snap(end))} <button onClick={() => setEnd(null)}>Clear</button></> : <span className="sub" style={{ marginLeft: 0 }}>not set</span>}
              {start && (!end || end.lon !== start.lon || end.lat !== start.lat) && <> <button onClick={() => setEnd(start)} title="Make this a round trip back to the start point">Return to start</button></>}
            </dd>
            <dt>Waypoints</dt>
            <dd>
              {wpIds.length === 0 ? <span className="sub" style={{ marginLeft: 0 }}>none yet</span> : (
                <ul className="plain" style={{ margin: 0 }}>{wpIds.map((id, i) => (
                  <li key={id}>{poiById(id)?.name}{" "}
                    <button disabled={i === 0} onClick={() => setWpIds((w) => { const n = [...w]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>Up</button>{" "}
                    <button onClick={() => setWpIds((w) => w.filter((x) => x !== id))}>Remove</button></li>))}</ul>)}
              {remainingPois.length > 0 && (
                <select
                  className="add-stop"
                  value=""
                  aria-label="Add a science stop"
                  onChange={(e) => { const id = e.target.value; if (id) setWpIds((w) => (w.includes(id) ? w : [...w, id])); }}
                >
                  <option value="">Add a science stop…</option>
                  {remainingPois.map((poi) => <option key={poi.id} value={poi.id}>{poi.name.split(" (")[0]}</option>)}
                </select>
              )}
            </dd>
            <dt>Speed (km/h)</dt><dd><input type="number" min={0.1} step={0.1} value={speed} onChange={(e) => setSpeed(Math.max(0.1, +e.target.value || DEFAULT_SPEED_KMH))} /> <span className="sub" style={{ marginLeft: 0 }}>your assumption, not validated</span></dd>
          </dl>
          <div className="btns"><button className="primary" disabled={!stopsReady} onClick={run}>{plan ? "Replan routes" : "Plan routes"}</button></div>
          {!stopsReady && (
            <>
              <div className="sub" style={{ marginLeft: 0, marginTop: 4 }}>
                Click the map or a point of interest, then use <strong>Set as start</strong> and <strong>Set as destination</strong> under Selected location above.
              </div>
              {!scenario && <div className="btns"><button onClick={() => loadScenario(DELTA_MARGIN_EVA)}>Or load the demo EVA</button></div>}
            </>
          )}
          {start && end && wpIds.length === 0 && start.lon === end.lon && start.lat === end.lat && (
            <div className="sub" style={{ marginLeft: 0, marginTop: 4 }}>Start and destination are the same point: add a science stop to make it a round trip.</div>
          )}
          {([["Start", start], ["Destination", end]] as const).map(([name, pt]) => {
            const pr = pt ? probe(pt) : null;
            return pr && pr.cls === "unknown" ? (
              <div className="warn" style={{ margin: "6px 0 0" }} key={name}>{name} lies in terrain with {Number.isNaN(pr.e) ? "missing elevation" : "unknown slope"}. Routing there is possible but the endpoint is not characterised.</div>
            ) : null;
          })}
        </Panel>

        {plan && (
          <Panel title="Route comparison" className="workspace-panel planner-panel" info="All profiles are scored on a common Balanced reference cost so you can compare length versus terrain penalty. Select a row to show that route on the map and in the elevation profile.">
            {plan.failed.length > 0 && <div className="warn" style={{ margin: "0 0 6px" }}>No path found for: {plan.failed.map((p) => PROFILES[p].label).join(", ")}. Steep or excluded cells block it.</div>}
            {scenario && activeRoute && (activeRoute.metrics.distanceKm / speed + scenario.scienceHours > scenario.evaBudgetHours) && (
              <div className="warn" style={{ margin: "0 0 6px" }}>
                Active route is over the {scenario.evaBudgetHours} h EVA budget
                ({f(activeRoute.metrics.distanceKm / speed + scenario.scienceHours, 1)} h = walk + {scenario.scienceHours} h science at {speed} km/h).
                Shorten the route or raise the assumed speed only with justification.
              </div>
            )}
            {plan.routes.filter((r) => !r.duplicateOf).length === 1 && plan.routes.length > 1 && (
              <div className="sub" style={{ margin: "0 0 6px" }}>
                All profiles share one corridor on this DEM. Flat floor + ~590 m cells often produce identical paths; that is expected here.
              </div>
            )}
            <table>
              <thead><tr><th></th><th>Route</th><th className="num">km</th><th className="num">Cost</th><th className="num">Mean deg</th><th className="num">Unknown</th></tr></thead>
              <tbody>{plan.routes.map((r) => (
                <tr key={r.profile} className={`route-row${active === r.profile ? " sel" : ""}`} onClick={() => setActive(r.profile)}>
                  <td><input type="radio" name="route" aria-label={`Show the ${r.label} route`} checked={active === r.profile} onChange={() => setActive(r.profile)} /></td>
                  <td><span className="sw" style={{ display: "inline-block", background: ROUTE_COLORS[r.profile], marginRight: 4 }} />{r.label}{r.duplicateOf ? " (same path)" : ""}</td>
                  <td className="num">{f(r.metrics.distanceKm, 2)}</td>
                  <td className="num">{f(r.metrics.referenceCost, 2)}</td>
                  <td className="num">{f(r.metrics.meanSlopeDeg)}</td>
                  <td className="num">{(r.metrics.unknownShare * 100).toFixed(0)}%</td>
                </tr>))}</tbody>
            </table>
            <div className="sub" style={{ marginLeft: 0, marginTop: 4 }}>Cost = Balanced-model cost-km applied to every route. Lower is better; equal to km only on flat, fully known terrain.</div>
            <ul className="plain">{explain(plan.routes).map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Panel>
        )}

        {plan && activeRoute && start && end && (
          <Panel id="mission-summary" title={`Mission summary · ${activeRoute.label}`} className="workspace-panel planner-panel" info="Planning checks, metrics and exports for the active route. Ascent and descent are derived from the DEM along the grid path. Trace the elevation profile under the map to follow the route.">
            <EvaChecksList checks={checks} />
            <dl className="kv">
              <dt>From</dt><dd>{coord(snap(start))}</dd>
              <dt>To</dt><dd>{coord(snap(end))}</dd>
              <dt>Distance</dt><dd>{f(activeRoute.metrics.distanceKm, 2)} km along the grid path</dd>
              <dt>Duration</dt><dd>{f(walkHours + scienceHours, 1)} h total: {f(walkHours, 1)} h walking at an assumed {speed} km/h (slope not applied){scienceHours > 0 ? ` + ${f(scienceHours, 1)} h science` : ""}</dd>
              <dt>Radiation</dt><dd>about {evaDoseMsv.toFixed(2)} mSv from cosmic rays over this EVA at the quiet-sun rate measured at Gale (order of magnitude)</dd>
              <dt>Terrain (km)</dt><dd>low {f(activeRoute.metrics.distanceByClassKm.low, 2)}, moderate {f(activeRoute.metrics.distanceByClassKm.moderate, 2)}, high {f(activeRoute.metrics.distanceByClassKm.high, 2)}, unknown {f(activeRoute.metrics.distanceByClassKm.unknown, 2)}</dd>
              <dt>Slope</dt><dd>mean {f(activeRoute.metrics.meanSlopeDeg)} deg, max {f(activeRoute.metrics.maxSlopeDeg)} deg (known cells only)</dd>
              <dt>Ascent / descent</dt><dd>{f(activeRoute.metrics.ascentM, 0)} m / {f(activeRoute.metrics.descentM, 0)} m (derived)</dd>
              <dt>Cost per metre</dt><dd>{activeRoute.metrics.costPerMetre.toFixed(2)} (1.00 = flat, fully known)</dd>
              <dt>Waypoints</dt><dd>{wpIds.map((id) => poiById(id)?.name).join("; ") || "none"}</dd>
              <dt>Science within {POI_CORRIDOR_KM} km</dt><dd>{activeRoute.metrics.nearbyPois.length ? activeRoute.metrics.nearbyPois.map((p) => `${p.name} (${p.distKm.toFixed(1)} km)`).join("; ") : "none"}</dd>
              <dt>Data gaps</dt><dd>{activeRoute.metrics.unknownShare > 0 ? `${(activeRoute.metrics.unknownShare * 100).toFixed(0)}% of route length has unknown slope.` : "No unknown-slope cells on this route."}{synth ? " Terrain is synthetic." : ""}</dd>
            </dl>
            <div className="btns"><button onClick={geojson}>Export GeoJSON</button><button onClick={summaryText}>Download summary</button></div>
            <div className="sub" style={{ marginLeft: 0, marginTop: 6 }}>Cost model: step length × (1 + (slope / S0)²); unknown slope uses a penalty factor; steps above the profile max slope are excluded. Planning assumptions only — see METHODOLOGY.md.</div>
          </Panel>
        )}

        <Panel title="Mission scenario" className="mission workspace-panel overview-panel planner-panel" info="Loads a demonstration Marswalk with science goal, habitat proxy, waypoints, speed, and Cautious routing defaults. You can still edit stops after loading.">
          {!scenario && (
            <>
              <div className="sub" style={{ marginLeft: 0, marginBottom: 6 }}>
                Load a demonstration Marswalk with science goal, habitat proxy, waypoints, and Cautious routing defaults.
              </div>
              <div className="btns">
                <button className="primary" onClick={() => loadScenario(DELTA_MARGIN_EVA)}>Load Jezero Delta Margin EVA</button>
              </div>
              <div className="sub" style={{ marginLeft: 0, marginTop: 6 }}>Plans the round trip and opens the Mission planner.</div>
            </>
          )}
          {scenario && (
            <>
              <strong>{scenario.title}</strong>
              <p className="mission-obj">{scenario.objective}</p>
              <dl className="kv">
                <dt>EVA budget</dt>
                <dd>{scenario.evaBudgetHours} h concept ({scenario.scienceHours} h science + walking at {scenario.speedKmh} km/h)</dd>
                <dt>Safety posture</dt>
                <dd>{scenario.safetyPosture}</dd>
                <dt>Preferred profile</dt>
                <dd>{scenario.preferredProfile}</dd>
              </dl>
              <ul className="plain">
                {scenario.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
              <div className="btns" style={{ marginTop: 6 }}>
                <button onClick={() => loadScenario(scenario)}>Reload &amp; replan</button>
                <button onClick={() => setScenario(null)}>Dismiss brief</button>
                {workspace === "overview" && plan && <button className="primary" onClick={() => go("planner")}>Open planner</button>}
              </div>
            </>
          )}
        </Panel>

        <ConditionsPanel
          className="workspace-panel overview-panel explorer-panel planner-panel"
          nowMs={nowMs}
          siteLat={siteLat}
          lsDeg={sun.ls}
          season={sun.season}
          daylightMarsH={sun.marsH}
          daylightEarthH={sun.earthH}
          meda={meda}
          weather={weather}
          onRefresh={() => refreshWeather(true)}
        />

        <Panel title="Safety context" className="safety workspace-panel explorer-panel planner-panel" info="Crew-awareness notes only. Radiation figures are order-of-magnitude. Roughness, rocks, terrain shadowing and particle-event dose are not modelled. Prefer Cautious near high or unknown slope.">
          <div className="safety-lead">NASA priority is crew safety. This panel states what the tool models and what it does not.</div>

          {selected && sel && (
            <div className="safety-box">
              <strong>At selected point</strong>
              <div>
                Slope class: <strong>{CLASS_LABEL[sel.cls]}</strong>
                {sel.cls === "unknown" && <span className="err"> — treat as hazard until better data is available</span>}
                {sel.cls === "high" && <span className="err"> — prefer Cautious profile or avoid if possible</span>}
                {sel.cls === "moderate" && <span> — usable with care; check THEMIS night infrared for rocky versus dusty ground</span>}
                {sel.cls === "low" && <span> — lower slope penalty in the planner</span>}
              </div>
            </div>
          )}

          {activeRoute && (
            <div className="safety-box">
              <strong>On active route ({activeRoute.label})</strong>
              <div>
                Unknown-slope share: {(activeRoute.metrics.unknownShare * 100).toFixed(0)}%
                {activeRoute.metrics.unknownShare > 0.05
                  ? <span className="err"> — significant gaps; consider Cautious or a different corridor</span>
                  : <span> — low data gap on this path</span>}
              </div>
              <div>
                Max known slope: {f(activeRoute.metrics.maxSlopeDeg)} deg
                {activeRoute.profile === "shortest" && (activeRoute.metrics.maxSlopeDeg ?? 0) > 10 && (
                  <span className="err"> — Shortest profile ignores moderate slopes; review Balanced or Cautious</span>
                )}
              </div>
              {activeRoute.profile !== "cautious" && (activeRoute.metrics.unknownShare > 0.02 || (activeRoute.metrics.maxSlopeDeg ?? 0) > 12) && (
                <div className="safety-rec">Recommendation: switch to <strong>Cautious</strong> when science targets sit near high-slope or unknown cells.</div>
              )}
            </div>
          )}

          <div className="safety-box">
            <strong>Radiation (order of magnitude)</strong>
            <div>
              Typical GCR <strong>dose equivalent</strong> at the surface is about <strong>{SAFETY.gcrDoseMsvPerDay} mSv/day</strong>
              (~{SAFETY.gcrDoseMgyPerDay} mGy/day absorbed), from Curiosity RAD at Gale crater (Hassler et al. 2014) — not Jezero-specific.
              {activeRoute
                ? <> The planned {f(walkHours + scienceHours, 1)} h EVA is about <strong>{evaDoseMsv.toFixed(2)} mSv</strong> at that rate under quiet conditions.</>
                : <> A multi-hour EVA is a small fraction of that daily rate under quiet conditions.</>}
            </div>
            <div className="sub" style={{ marginLeft: 0, marginTop: 4 }}>{SAFETY.speNote}</div>
          </div>

          <div className="safety-cols">
            <div>
              <strong>Modelled here</strong>
              <ul className="plain">
                {SAFETY.modelled.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <strong>Not modelled</strong>
              <ul className="plain">
                {SAFETY.notModelled.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          </div>
          <div className="sub" style={{ marginLeft: 0, marginTop: 6 }}>
            Cost-profile parameters and slope bins are planning assumptions, not certified mobility or medical limits. See METHODOLOGY.md.
          </div>
        </Panel>

        <DataInventoryPanel
          className="workspace-panel overview-panel"
          trek={basemap}
          meda={meda}
          weather={weather}
          traverseSol={traverse?.lastSol ?? null}
        />
      </aside>

      <footer className="status">
        <span className="status-mode">{scenario ? scenario.title : "Free-form plan"}</span>
        <span>{hover ? `${hover.lat.toFixed(4)} N  ${hover.lon.toFixed(4)} E` : "cursor outside map"}</span>
        <span>{hov ? `elev ${Number.isNaN(hov.e) ? "missing" : hov.e.toFixed(0) + " m"}` : ""}</span>
        <span>{hov ? `slope ${Number.isNaN(hov.s) ? "unknown" : hov.s.toFixed(1) + "°"} · ${hov ? CLASS_LABEL[hov.cls].split(" (")[0] : ""}` : ""}</span>
        <span>{activeRoute ? `route ${activeRoute.label} · ${f(activeRoute.metrics.distanceKm, 1)} km` : "no route"}</span>
        <span>Mars planetocentric · R = {grid.meta.radiusM} m</span>
      </footer>
    </div>
  );
}

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
