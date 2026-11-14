import { useMemo, useState, type ReactNode } from "react";
import { Grid, haversineM } from "./core/grid";

/** Collapsible section with a small (i) tip. */
export function Panel({
  title,
  info,
  children,
  className = "",
}: {
  title: string;
  info: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`panel ${className}`.trim()}>
      <div className="panel-head">
        <h2>{title}</h2>
        <button
          type="button"
          className={`info-btn${open ? " on" : ""}`}
          aria-label={`About ${title}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          i
        </button>
      </div>
      {open && <div className="info-tip">{info}</div>}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export interface PathCell { r: number; c: number }

/**
 * Distance–elevation profile for a planned route.
 * Pure SVG — no chart library. Samples are down-sampled for long paths.
 */
export function ElevationProfile({
  grid,
  path,
  label,
}: {
  grid: Grid;
  path: PathCell[];
  label?: string;
}) {
  const profile = useMemo(() => buildProfile(grid, path), [grid, path]);

  if (!profile || profile.points.length < 2) {
    return <div className="sub" style={{ marginLeft: 0 }}>Not enough elevation samples on this path.</div>;
  }

  const W = 720;
  const H = 190;
  const padL = 58;
  const padR = 20;
  const padT = 16;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const { points, dMin, dMax, eMin, eMax, totalKm } = profile;
  const spanE = eMax - eMin || 1;
  const spanD = dMax - dMin || 1;

  const xy = (d: number, e: number): [number, number] => [
    padL + ((d - dMin) / spanD) * innerW,
    padT + (1 - (e - eMin) / spanE) * innerH,
  ];

  const poly = points.map((p) => xy(p.d, p.e).join(",")).join(" ");
  const area = `${padL},${padT + innerH} ${poly} ${padL + innerW},${padT + innerH}`;

  const yTicks = [...new Set([0, 1, 2, 3].map((i) => Math.round(eMin + (spanE * i) / 3)))];
  const xTicks = [dMin, (dMin + dMax) / 2, dMax];
  return (
    <div className="elev-profile">
      <div className="elev-profile-title">
        Elevation profile{label ? ` · ${label}` : ""}
        <span className="sub" style={{ marginLeft: 6 }}>
          {totalKm.toFixed(2)} km · {profile.minElevation.toFixed(0)}–{profile.maxElevation.toFixed(0)} m
        </span>
      </div>
      <svg className="elev-profile-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Route elevation profile, ${totalKm.toFixed(2)} kilometres`}>
        {yTicks.map((e) => {
          const y = xy(dMin, e)[1];
          return (
            <g key={`y${e}`}>
              <line x1={padL} x2={padL + innerW} y1={y} y2={y} className="ep-grid" />
              <text x={padL - 10} y={y + 4} textAnchor="end" className="ep-label">{Math.round(e)}</text>
            </g>
          );
        })}
        {xTicks.map((d, i) => {
          const x = xy(d, eMin)[0];
          return (
            <text key={`x${i}`} x={x} y={H - 13} textAnchor="middle" className="ep-label">
              {`${(d / 1000).toFixed(1)} km`}
            </text>
          );
        })}
        <text x={padL} y={10} className="ep-axis-title">ELEVATION · M</text>
        <polygon points={area} className="ep-area" />
        <polyline points={poly} className="ep-line" fill="none" />
        {(() => {
          const [x0, y0] = xy(points[0].d, points[0].e);
          const [x1, y1] = xy(points[points.length - 1].d, points[points.length - 1].e);
          return (
            <>
              <circle cx={x0} cy={y0} r={4} className="ep-start" />
              <circle cx={x1} cy={y1} r={4} className="ep-end" />
            </>
          );
        })()}
      </svg>
      <div className="elev-profile-foot">
        <span><span className="ep-sw start" /> Start</span>
        <span><span className="ep-sw end" /> Destination</span>
        <span>Elevation relative to Mars datum</span>
      </div>
    </div>
  );
}

function buildProfile(grid: Grid, path: PathCell[]) {
  if (!path.length) return null;
  const raw: { d: number; e: number }[] = [];
  let dist = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    if (i > 0) {
      const a = path[i - 1];
      dist += haversineM(
        grid.centerLon(a.c),
        grid.centerLat(a.r),
        grid.centerLon(cell.c),
        grid.centerLat(cell.r),
        grid.meta.radiusM,
      );
    }
    const e = grid.elev[grid.idx(cell.r, cell.c)];
    if (Number.isFinite(e)) raw.push({ d: dist, e });
  }
  if (raw.length < 2) return null;

  // Down-sample to ≤ 160 points for a clean polyline
  const maxPts = 160;
  let points = raw;
  if (raw.length > maxPts) {
    const step = (raw.length - 1) / (maxPts - 1);
    points = [];
    for (let i = 0; i < maxPts; i++) {
      points.push(raw[Math.round(i * step)]);
    }
  }

  let eMin = Infinity, eMax = -Infinity;
  for (const p of points) {
    if (p.e < eMin) eMin = p.e;
    if (p.e > eMax) eMax = p.e;
  }
  const minElevation = eMin;
  const maxElevation = eMax;
  // Small pad so the line is not clipped
  const pad = Math.max(5, (eMax - eMin) * 0.06);
  eMin -= pad;
  eMax += pad;

  return {
    points,
    dMin: points[0].d,
    dMax: points[points.length - 1].d,
    eMin,
    eMax,
    minElevation,
    maxElevation,
    totalKm: points[points.length - 1].d / 1000,
  };
}
