import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Grid, haversineM } from "./core/grid";
import { CLASS_COLOR, TerrainClass, classify } from "./core/terrain";

/** Card section with a small (i) tip and an optional status element in its header. */
export function Panel({
  title,
  info,
  children,
  className = "",
  status,
  id,
}: {
  title: string;
  info: string;
  children: ReactNode;
  className?: string;
  status?: ReactNode;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className={`panel ${className}`.trim()}>
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="panel-head-aside">
          {status}
          <button
            type="button"
            className={`info-btn${open ? " on" : ""}`}
            aria-label={`About ${title}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            i
          </button>
        </span>
      </div>
      {open && <div className="info-tip">{info}</div>}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export interface PathCell { r: number; c: number }
export interface ProfileMark { index: number; label: string }

const CHART_H = 184;
const PAD = { l: 58, r: 20, t: 20, b: 44 };
/** Worst-first, so a down-sampled segment reports the most limiting class it spans. */
const CLASS_RANK: Record<TerrainClass, number> = { low: 0, moderate: 1, high: 2, unknown: 3 };
const CLASS_SHORT: Record<TerrainClass, string> = { low: "Low", moderate: "Moderate", high: "High", unknown: "Unknown" };
const rgb = (c: TerrainClass) => `rgb(${CLASS_COLOR[c].join(",")})`;

/**
 * Distance-elevation profile for a planned route with a terrain-class strip,
 * science-stop markers and a pointer readout. Pure SVG, drawn at the
 * container's pixel width so labels are never stretched.
 */
export function ElevationProfile({
  grid,
  slope,
  path,
  marks = [],
  onScrub,
}: {
  grid: Grid;
  slope: Float32Array;
  path: PathCell[];
  marks?: ProfileMark[];
  /** Path index under the pointer, or null when it leaves the chart. */
  onScrub?: (pathIndex: number | null) => void;
}) {
  const profile = useMemo(() => buildProfile(grid, slope, path), [grid, slope, path]);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setHover(null), [path]);

  if (!profile) {
    return <div ref={box} className="elev-profile"><div className="sub" style={{ marginLeft: 0 }}>Not enough elevation samples on this path.</div></div>;
  }

  const innerW = width - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const { points, eMin, eMax, totalM } = profile;
  const spanE = eMax - eMin || 1;
  const x = (d: number) => PAD.l + (d / (totalM || 1)) * innerW;
  const y = (e: number) => PAD.t + (1 - (e - eMin) / spanE) * innerH;
  const base = PAD.t + innerH;

  const poly = points.map((p) => `${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join(" ");
  const yTicks = [...new Set([0, 1, 2, 3].map((i) => Math.round(eMin + (spanE * i) / 3)))];
  const xTicks = [0, totalM / 2, totalM];
  const first = points[0], last = points[points.length - 1];
  const at = hover == null ? null : points[hover];

  const scrub = (e: PointerEvent<SVGSVGElement>) => {
    const d = ((e.clientX - e.currentTarget.getBoundingClientRect().left - PAD.l) / innerW) * totalM;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].d - d) < Math.abs(points[best].d - d)) best = i;
    setHover(best);
    onScrub?.(points[best].index);
  };
  const leave = () => { setHover(null); onScrub?.(null); };

  return (
    <div ref={box} className="elev-profile">
      <svg
        className="elev-profile-chart"
        width={width}
        height={CHART_H}
        viewBox={`0 0 ${width} ${CHART_H}`}
        role="img"
        aria-label={`Route elevation profile, ${(totalM / 1000).toFixed(2)} kilometres, ${profile.minElevation.toFixed(0)} to ${profile.maxElevation.toFixed(0)} metres`}
        onPointerMove={scrub}
        onPointerDown={scrub}
        onPointerLeave={leave}
      >
        {yTicks.map((e) => (
          <g key={`y${e}`}>
            <line x1={PAD.l} x2={PAD.l + innerW} y1={y(e)} y2={y(e)} className="ep-grid" />
            <text x={PAD.l - 10} y={y(e) + 4} textAnchor="end" className="ep-label">{e}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={`x${i}`} x={x(d)} y={CHART_H - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="ep-label">
            {`${(d / 1000).toFixed(1)} km`}
          </text>
        ))}
        <text x={PAD.l} y={11} className="ep-axis-title">ELEVATION · M</text>
        <polygon points={`${PAD.l},${base} ${poly} ${PAD.l + innerW},${base}`} className="ep-area" />
        <polyline points={poly} className="ep-line" fill="none" />
        {points.slice(1).map((p, i) => (
          <rect key={i} x={x(points[i].d)} y={base + 5} width={Math.max(0.5, x(p.d) - x(points[i].d))} height={7} fill={rgb(p.cls)} />
        ))}
        {marks.map((m) => {
          const pt = points.find((p) => p.index >= m.index);
          if (!pt) return null;
          const mx = x(pt.d);
          return (
            <g key={`${m.index}-${m.label}`}>
              <line x1={mx} x2={mx} y1={PAD.t} y2={base} className="ep-mark" />
              <text x={Math.min(Math.max(mx, PAD.l + 40), PAD.l + innerW - 40)} y={PAD.t - 6} textAnchor="middle" className="ep-mark-label">{m.label}</text>
            </g>
          );
        })}
        <circle cx={x(first.d)} cy={y(first.e)} r={4} className="ep-start" />
        <circle cx={x(last.d)} cy={y(last.e)} r={4} className="ep-end" />
        {at && (
          <g pointerEvents="none">
            <line x1={x(at.d)} x2={x(at.d)} y1={PAD.t} y2={base + 12} className="ep-cursor" />
            <circle cx={x(at.d)} cy={y(at.e)} r={5} className="ep-cursor-dot" />
          </g>
        )}
      </svg>
      <div className="elev-profile-foot">
        {at ? (
          <span className="ep-readout">
            <strong>{(at.d / 1000).toFixed(2)} km</strong> · {at.e.toFixed(0)} m · slope {Number.isNaN(at.slope) ? "unknown" : `${at.slope.toFixed(1)}°`} · {CLASS_SHORT[classify(at.slope)]} class
          </span>
        ) : (
          <>
            <span><span className="ep-sw start" /> Start</span>
            <span><span className="ep-sw end" /> Destination</span>
            {(Object.keys(CLASS_SHORT) as TerrainClass[]).map((c) => (
              <span key={c}><span className="ep-sw sq" style={{ background: rgb(c) }} /> {CLASS_SHORT[c]}</span>
            ))}
            <span className="ep-hint">Move over the chart to trace the route on the map</span>
          </>
        )}
      </div>
    </div>
  );
}

interface ProfilePoint { d: number; e: number; index: number; slope: number; cls: TerrainClass }

function buildProfile(grid: Grid, slope: Float32Array, path: PathCell[]) {
  const raw: ProfilePoint[] = [];
  let dist = 0;
  let pending: TerrainClass = "low";
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const ci = grid.idx(cell.r, cell.c);
    if (i > 0) {
      const a = path[i - 1];
      dist += haversineM(grid.centerLon(a.c), grid.centerLat(a.r), grid.centerLon(cell.c), grid.centerLat(cell.r), grid.meta.radiusM);
      const s1 = slope[grid.idx(a.r, a.c)], s2 = slope[ci];
      const step = classify(Number.isNaN(s1) || Number.isNaN(s2) ? NaN : (s1 + s2) / 2);
      if (CLASS_RANK[step] > CLASS_RANK[pending]) pending = step;
    }
    const e = grid.elev[ci];
    if (!Number.isFinite(e)) continue;
    raw.push({ d: dist, e, index: i, slope: slope[ci], cls: pending });
    pending = "low";
  }
  if (raw.length < 2) return null;

  // Cap the sample count; each kept point carries the worst class of the steps it replaces.
  const maxPts = 400;
  let points = raw;
  if (raw.length > maxPts) {
    points = [];
    const step = (raw.length - 1) / (maxPts - 1);
    let from = 0;
    for (let k = 0; k < maxPts; k++) {
      const to = Math.round(k * step);
      let cls: TerrainClass = "low";
      for (let j = from + 1; j <= to; j++) if (CLASS_RANK[raw[j].cls] > CLASS_RANK[cls]) cls = raw[j].cls;
      points.push({ ...raw[to], cls });
      from = to;
    }
  }

  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    if (p.e < lo) lo = p.e;
    if (p.e > hi) hi = p.e;
  }
  const pad = Math.max(5, (hi - lo) * 0.06);
  return { points, eMin: lo - pad, eMax: hi + pad, minElevation: lo, maxElevation: hi, totalM: points[points.length - 1].d };
}
