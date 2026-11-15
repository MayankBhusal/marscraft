import { useEffect, useState } from "react";
import { Panel } from "./ui";
import { CheckStatus, EvaCheck, MarsArrival, MedaSummary, SpaceWeatherAssessment, SW_ALERT_HOURS } from "./core/conditions";
import { RoverStop } from "./core/rover";
import { DONKI_WINDOW_DAYS, Feed, FeedOrigin, RAW_IMAGES_GALLERY, RoverImage, SpaceWeatherData, loadRoverImages } from "./nasa";

export type Loadable<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; value: T };

export interface MedaState { feed: Feed<unknown>; summary: MedaSummary | null }
export interface WeatherState {
  feed: Feed<SpaceWeatherData>;
  assessment: SpaceWeatherAssessment;
  ageHours: number;
  /** "quiet" from data too old to trust is shown as unknown. */
  level: SpaceWeatherAssessment["level"] | "unknown";
}

const ORIGIN_LABEL: Record<FeedOrigin, string> = { live: "live", cached: "live · cached", snapshot: "offline snapshot" };
export const LEVEL_LABEL: Record<WeatherState["level"], string> = { quiet: "Quiet", watch: "Watch", alert: "Alert", unknown: "Unknown" };

const utc = (ms: number) =>
  `${new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

function relative(ms: number, nowMs: number): string {
  const h = Math.abs(ms - nowMs) / 3600000;
  const span = h < 1 ? "under 1 h" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
  return ms >= nowMs ? `in ${span}` : `${span} ago`;
}

function Origin({ feed, nowMs }: { feed: Feed<unknown>; nowMs: number }) {
  const ageMin = (nowMs - feed.retrievedMs) / 60000;
  return (
    <span className={`origin ${feed.origin}`} title={feed.fallbackReason ? `Live request not used: ${feed.fallbackReason}` : undefined}>
      {ORIGIN_LABEL[feed.origin]} · {ageMin < 5 ? "just now" : relative(feed.retrievedMs, nowMs)}
    </span>
  );
}

function ArrivalRow({ a, nowMs }: { a: MarsArrival; nowMs: number }) {
  return (
    <li>
      <strong>{utc(a.arrivalMs)}</strong> ({relative(a.arrivalMs, nowMs)}) · {a.glancing ? "glancing blow" : "impact"}{a.minor ? ", minor" : ""}
      {a.cmeSpeedKms != null && <> · CME {Math.round(a.cmeSpeedKms)} km/s</>}
      {a.link && <> · <a href={a.link} target="_blank" rel="noreferrer">model run</a></>}
    </li>
  );
}

export function ConditionsPanel(p: {
  className: string;
  nowMs: number;
  siteLat: number;
  lsDeg: number;
  season: string;
  daylightMarsH: number;
  daylightEarthH: number;
  meda: Loadable<MedaState>;
  weather: Loadable<WeatherState>;
  onRefresh: () => void;
}) {
  const w = p.weather.state === "ready" ? p.weather.value : null;
  const m = p.meda.state === "ready" ? p.meda.value : null;
  const listed = w ? [...w.assessment.current, ...w.assessment.upcoming, ...w.assessment.recent] : [];
  return (
    <Panel
      title="Current conditions"
      className={p.className}
      status={w && <span className={`level ${w.level}`}>Space weather: {LEVEL_LABEL[w.level]}</span>}
      info="Sun and season are computed for today. Surface weather is the latest public report from Perseverance's MEDA station. Space weather lists CME arrivals at Mars predicted by the WSA-ENLIL model in NASA's DONKI database. These are awareness aids, not forecasts of radiation dose."
    >
      <div className="cond-block">
        <div className="cond-title">Sun and season <span className="tag derived">computed</span></div>
        <dl className="kv">
          <dt>Season</dt><dd>{p.season} (L<sub>s</sub> {p.lsDeg.toFixed(1)}°)</dd>
          <dt>Daylight</dt><dd><strong>{p.daylightEarthH.toFixed(1)} h</strong> sunrise to sunset at {p.siteLat.toFixed(2)}° N ({p.daylightMarsH.toFixed(1)} Mars hours)</dd>
        </dl>
        <div className="sub flush">Flat-horizon geometry for today's date; crater walls and dust shorten usable light.</div>
      </div>

      <div className="cond-block">
        <div className="cond-title">Surface weather · MEDA {m && <Origin feed={m.feed} nowMs={p.nowMs} />}</div>
        {p.meda.state === "loading" && <div className="sub flush">Loading the Mars 2020 weather feed…</div>}
        {p.meda.state === "error" && <div className="sub flush err">Weather unavailable: {p.meda.message}.</div>}
        {m && !m.summary && <div className="sub flush err">The feed returned no sols.</div>}
        {m?.summary && (
          <>
            <dl className="kv">
              <dt>Report</dt><dd>Sol {m.summary.latest.sol} · {m.summary.latest.terrestrialDate}{m.summary.latest.season ? ` · ${m.summary.latest.season}` : ""}</dd>
              <dt>Air temp</dt>
              <dd>{m.summary.temp ? <><strong>{m.summary.temp.minC.toFixed(0)} to {m.summary.temp.maxC.toFixed(0)} °C</strong>{m.summary.temp.sol !== m.summary.latest.sol ? ` (sol ${m.summary.temp.sol})` : ""}</> : "not reported"}</dd>
              <dt>Pressure</dt>
              <dd>{m.summary.pressure ? <>{m.summary.pressure.pa.toFixed(0)} Pa{m.summary.pressure.sol !== m.summary.latest.sol ? ` (sol ${m.summary.pressure.sol})` : ""}</> : "not reported"}</dd>
              <dt>Sun (LMST)</dt>
              <dd>{m.summary.latest.sunrise && m.summary.latest.sunset ? `${m.summary.latest.sunrise.slice(0, 5)} to ${m.summary.latest.sunset.slice(0, 5)}` : "not reported"}</dd>
            </dl>
            {m.summary.stale && (
              <div className="note-warn">
                Archived report: the public feed last updated {Math.round(m.summary.ageDays)} days ago. Use it as a seasonal reference for {m.summary.latest.season ?? "that season"}, not as today's weather.
              </div>
            )}
          </>
        )}
      </div>

      <div className="cond-block">
        <div className="cond-title">Space weather · DONKI {w && <Origin feed={w.feed} nowMs={p.nowMs} />}</div>
        {p.weather.state === "loading" && <div className="sub flush">Checking NASA DONKI for CME arrivals at Mars…</div>}
        {p.weather.state === "error" && <div className="sub flush err">Space weather unavailable: {p.weather.message}. Radiation conditions are unknown to this tool.</div>}
        {w && (
          <>
            <div>
              {w.level === "alert" && <><strong className="err">A CME is predicted to reach Mars within {SW_ALERT_HOURS} h of now.</strong> Confirm conditions before egress.</>}
              {w.level === "watch" && <><strong>A predicted CME arrival at Mars is close to this period.</strong> Review before committing to a long EVA.</>}
              {w.level === "quiet" && <>No CME arrival at Mars is predicted in the next 7 days.</>}
              {w.level === "unknown" && <span className="err">No arrival is listed, but this data is {Math.round(w.ageHours / 24)} days old, so current conditions are unknown.</span>}
            </div>
            {listed.length > 0 && <ul className="plain arrivals">{listed.map((a) => <ArrivalRow key={a.simulationID} a={a} nowMs={p.nowMs} />)}</ul>}
            <div className="sub flush">
              {w.assessment.total} predicted Mars arrival{w.assessment.total === 1 ? "" : "s"} in the last {DONKI_WINDOW_DAYS} days, from {w.feed.data.simulationCount} WSA-ENLIL runs. Model arrival times are commonly off by about half a day, and an arrival is not a dose estimate.
            </div>
            <div className="btns"><button type="button" onClick={p.onRefresh}>Refresh from NASA</button></div>
          </>
        )}
      </div>
    </Panel>
  );
}

const CHECK_MARK: Record<CheckStatus, string> = { ok: "✓", caution: "!", flag: "✕", unknown: "?" };
const CHECK_WORD: Record<CheckStatus, string> = { ok: "Pass", caution: "Caution", flag: "Flagged", unknown: "Unknown" };

export function EvaChecksList({ checks }: { checks: EvaCheck[] }) {
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  return (
    <div className="checks-wrap">
      <div className="checks-head">
        <strong>Pre-EVA planning checks</strong>
        <span>{count("ok")} pass · {count("caution")} caution · {count("flag")} flagged · {count("unknown")} unknown</span>
      </div>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.id} className={`check ${c.status}`}>
            <span className="check-mark" role="img" aria-label={CHECK_WORD[c.status]}>{CHECK_MARK[c.status]}</span>
            <div><strong>{c.label}</strong><div>{c.detail}</div></div>
          </li>
        ))}
      </ul>
      <div className="sub flush">Planning aids built on stated assumptions; not flight rules. Unknown inputs are never counted as passing.</div>
    </div>
  );
}

export function RoverGroundTruth({ stop, distM, gridElevM, gridSlopeDeg, cellKm }: {
  stop: RoverStop;
  distM: number;
  gridElevM: number;
  gridSlopeDeg: number;
  cellKm: number;
}) {
  const [images, setImages] = useState<Loadable<RoverImage[]> | null>(null);
  useEffect(() => setImages(null), [stop.sol, stop.site]);

  const load = () => {
    setImages({ state: "loading" });
    loadRoverImages(stop.sol, stop.site).then(
      (value) => setImages({ state: "ready", value }),
      (e) => setImages({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  };
  const steeper = stop.tiltDeg != null && Number.isFinite(gridSlopeDeg) && stop.tiltDeg > gridSlopeDeg + 2;

  return (
    <div className="rover">
      <div className="pov-title">Perseverance ground truth nearby <span className="tag">in situ</span></div>
      <dl className="kv">
        <dt>Nearest stop</dt><dd>Sol {stop.sol} end of drive, {distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`} from this cell centre</dd>
        <dt>Elevation</dt>
        <dd>rover {stop.elevM == null ? "n/a" : `${stop.elevM.toFixed(0)} m`} · grid {Number.isFinite(gridElevM) ? `${gridElevM.toFixed(0)} m` : "missing"}</dd>
        <dt>Tilt / slope</dt>
        <dd>rover tilt {stop.tiltDeg == null ? "n/a" : `${stop.tiltDeg.toFixed(1)}°`} · grid slope {Number.isFinite(gridSlopeDeg) ? `${gridSlopeDeg.toFixed(1)}°` : "unknown"}</dd>
      </dl>
      {steeper && (
        <div className="note-warn">
          The rover sat steeper than the grid slope here. Metre-scale relief is averaged out inside a {cellKm.toFixed(1)} km cell, so expect rougher ground than the slope class suggests.
        </div>
      )}
      {!images && <div className="btns"><button type="button" onClick={load}>Show rover camera views (sol {stop.sol})</button></div>}
      {images?.state === "loading" && <div className="sub flush">Asking the Mars 2020 raw-image archive for sol {stop.sol}…</div>}
      {images?.state === "error" && (
        <div className="sub flush err">
          Images unavailable ({images.message}). <a href={RAW_IMAGES_GALLERY} target="_blank" rel="noreferrer">Open the raw-image gallery</a>
        </div>
      )}
      {images?.state === "ready" && images.value.length === 0 && (
        <div className="sub flush">No Left Navcam frames are published for sol {stop.sol}. <a href={RAW_IMAGES_GALLERY} target="_blank" rel="noreferrer">Open the raw-image gallery</a></div>
      )}
      {images?.state === "ready" && images.value.length > 0 && (
        <>
          <div className="rover-shots">
            {images.value.map((im) => (
              <a key={im.id} href={im.pageUrl} target="_blank" rel="noreferrer" title={im.title}>
                <img src={im.thumbUrl} alt={im.title} loading="lazy" />
                <span>{im.lmst ? `${im.lmst} LMST` : "Navcam"}{im.atStop ? "" : " · elsewhere this sol"}</span>
              </a>
            ))}
          </div>
          <div className="sub flush">Left Navigation Camera, sol {stop.sol}. {images.value[0].credit}. Each frame opens its NASA archive page.</div>
        </>
      )}
    </div>
  );
}

type Mode = "local" | "live" | "offline" | "loading" | "static";
const MODE_LABEL: Record<Mode, string> = { local: "bundled", live: "live", offline: "unreachable", loading: "loading", static: "published figure" };

export function DataInventoryPanel(p: {
  className: string;
  trek: "loading" | "ok" | "error";
  meda: Loadable<MedaState>;
  weather: Loadable<WeatherState>;
  traverseSol: number | null;
}) {
  const trek: Mode = p.trek === "ok" ? "live" : p.trek === "error" ? "offline" : "loading";
  const feed = (l: Loadable<{ feed: Feed<unknown> }>): Mode =>
    l.state === "loading" ? "loading" : l.state === "error" ? "offline" : l.value.feed.origin === "snapshot" ? "local" : "live";
  const rows: { kind: string; product: string; mission: string; mode: Mode }[] = [
    { kind: "Topographic", product: "HRSC+MOLA DEM, slope, slope class", mission: "MGS · Mars Express", mode: "local" },
    { kind: "Optical", product: "Viking colour mosaic (232 m)", mission: "Viking Orbiters", mode: trek },
    { kind: "Optical, high-res", product: "CTX 6 m and HiRISE 25 cm mosaics", mission: "MRO", mode: trek },
    { kind: "Thermal", product: "THEMIS day and night infrared", mission: "Mars Odyssey", mode: trek },
    { kind: "Spectral", product: "CRISM mineral map (PIA23380)", mission: "MRO", mode: "local" },
    { kind: "In situ", product: p.traverseSol ? `Rover traverse to sol ${p.traverseSol}, Navcam views` : "Rover traverse, Navcam views", mission: "Mars 2020", mode: p.traverseSol ? "local" : "loading" },
    { kind: "Atmospheric", product: "MEDA air temperature, pressure", mission: "Mars 2020", mode: feed(p.meda) },
    { kind: "Space weather", product: "WSA-ENLIL CME arrivals at Mars", mission: "DONKI · SOHO / STEREO", mode: feed(p.weather) },
    { kind: "Radiation", product: "RAD surface dose rate (Gale)", mission: "MSL Curiosity", mode: "static" },
  ];
  return (
    <Panel
      title="NASA data in this view"
      className={p.className}
      info="Every data kind layered into the map or the EVA checks, with the mission behind it and whether it is live now. Bundled means a copy ships with the app and works offline. See DATA_SOURCES.md for provenance."
    >
      <table className="inventory">
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <td><strong>{r.kind}</strong><div className="sub flush">{r.mission}</div></td>
              <td>{r.product}</td>
              <td><span className={`mode ${r.mode}`}>{MODE_LABEL[r.mode]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
