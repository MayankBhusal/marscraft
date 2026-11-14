import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Grid } from "./core/grid";
import { BASEMAP, CTX_JEZERO, HIRISE_JEZERO, THEMIS_DAY, THEMIS_NIGHT, CRISM_MINERALS, THERMAL_BLEND_OPACITY, TrekLayer } from "./config";
import { HiriseFootprint, LayerState, LonLat, PoiFull } from "./types";

export const ROUTE_COLORS: Record<string, string> = {
  shortest: "#3b6ea5",
  balanced: "#a8741a",
  cautious: "#2f7d5b",
};
export const TRAVERSE_COLOR = "#fff3d6";

export interface RouteLine { profile: string; latlngs: [number, number][] }
export interface MapBounds { west: number; east: number; south: number; north: number }

/** Bottom to top within the tile pane. Thermal sits above the optical imagery so it can be blended over it. */
const TILE_ORDER = ["basemap", "ctx", "hiriseMosaic", "themisDay", "themisNight"] as const;

interface Props {
  grid: Grid;
  images: { elevation: string; slope: string; terrainClass: string; reachability?: string | null };
  layers: LayerState;
  overlayOpacity: number;
  pois: PoiFull[];
  hirise: HiriseFootprint[];
  /** Rover traverse polylines as [lon, lat], or null until loaded. */
  traverse: [number, number][][] | null;
  traverseLabel: string;
  /** Rover stop highlighted as ground truth for the selected location. */
  roverStop: (LonLat & { sol: number }) | null;
  /** Position under the cursor on the elevation profile. */
  scrub: LonLat | null;
  selected: LonLat | null;
  selectedPoiId: string | null;
  start: LonLat | null;
  end: LonLat | null;
  waypointIds: string[];
  routes: RouteLine[];
  activeProfile: string | null;
  initialView: MapBounds;
  onMapClick: (p: LonLat) => void;
  onHover: (p: LonLat | null) => void;
  onPoiClick: (id: string) => void;
  onBasemapStatus: (s: "loading" | "ok" | "error") => void;
  /** Bumps when the parent wants the view moved to fitLatLngs (one point centres, several fit). */
  fitSeq: number;
  fitLatLngs?: [number, number][];
}

function makeTileLayer(cfg: TrekLayer, onStatus?: (s: "loading" | "ok" | "error") => void): L.TileLayer {
  const tiles = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    zoomOffset: cfg.zoomOffset,
    minZoom: cfg.minZoom,
    maxNativeZoom: cfg.maxNativeZoom,
    maxZoom: MAX_ZOOM,
    bounds: cfg.bounds ? L.latLngBounds([cfg.bounds.south, cfg.bounds.west], [cfg.bounds.north, cfg.bounds.east]) : undefined,
    tileSize: 256,
    noWrap: true,
    opacity: 1,
  });
  if (onStatus) {
    let ok = 0, bad = 0;
    tiles.on("loading", () => onStatus("loading"));
    tiles.on("tileload", () => { ok++; onStatus("ok"); });
    tiles.on("tileerror", () => { bad++; if (ok === 0 && bad >= 2) onStatus("error"); });
  }
  return tiles;
}

/** Deep enough to use the 25 cm HiRISE mosaic at its native resolution. */
const MAX_ZOOM = 17;
/** Zoom used when centring on a single point. */
const POINT_ZOOM = 12;
const MINERAL_OPACITY = 0.9;

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tileLayers = useRef<Record<string, L.TileLayer>>({});
  const overlays = useRef<Record<string, L.ImageOverlay>>({});
  const mineralOverlay = useRef<L.ImageOverlay | null>(null);
  const reachOverlay = useRef<L.ImageOverlay | null>(null);
  const poiLayer = useRef(L.layerGroup());
  const hiriseLayer = useRef(L.layerGroup());
  const traverseLayer = useRef(L.layerGroup());
  const routeLayer = useRef(L.layerGroup());
  const markerLayer = useRef(L.layerGroup());
  const scrubMarker = useRef<L.CircleMarker | null>(null);
  const cb = useRef(p);
  cb.current = p;

  // One-time map construction.
  useEffect(() => {
    const g = p.grid;
    const bounds = L.latLngBounds([g.south, g.meta.west], [g.meta.north, g.east]);
    const m = L.map(el.current!, {
      crs: L.CRS.EPSG4326,
      zoomSnap: 0.25,
      minZoom: 1,
      maxZoom: MAX_ZOOM,
      attributionControl: true,
      zoomControl: true,
    });
    map.current = m;
    const v = cb.current.initialView;
    m.fitBounds(L.latLngBounds([v.south, v.west], [v.north, v.east]));
    L.control.scale({ metric: true, imperial: false }).addTo(m);

    // Optical basemap (always present as base; visibility toggled).
    const viking = makeTileLayer(BASEMAP, (s) => cb.current.onBasemapStatus(s));
    viking.addTo(m);
    tileLayers.current.basemap = viking;

    // High-resolution optical and thermal layers (added on demand).
    tileLayers.current.ctx = makeTileLayer(CTX_JEZERO);
    tileLayers.current.hiriseMosaic = makeTileLayer(HIRISE_JEZERO);
    tileLayers.current.themisDay = makeTileLayer(THEMIS_DAY);
    tileLayers.current.themisNight = makeTileLayer(THEMIS_NIGHT);
    TILE_ORDER.forEach((k, i) => tileLayers.current[k].setZIndex(i + 1));

    // Derived terrain image overlays.
    const mk = (key: "elevation" | "slope" | "terrainClass") => {
      const o = L.imageOverlay(cb.current.images[key], bounds, {
        opacity: cb.current.overlayOpacity,
        interactive: false,
      });
      overlays.current[key] = o;
    };
    mk("elevation");
    mk("slope");
    mk("terrainClass");

    // CRISM mineral figure (local PNG, approximate bounds). It gets its own pane
    // between the imagery and the topography overlays, blended as colour only:
    // the figure contributes its mineral hues while the imagery beneath keeps
    // its detail, instead of the figure's own low-resolution base covering it.
    const mb = CRISM_MINERALS.bounds;
    const mineralBounds = L.latLngBounds([mb.south, mb.west], [mb.north, mb.east]);
    const mineralUrl = (import.meta.env.BASE_URL || "/") + CRISM_MINERALS.url;
    const mineralPane = m.createPane("minerals");
    mineralPane.style.zIndex = "350";
    mineralPane.style.mixBlendMode = "color";
    mineralPane.style.pointerEvents = "none";
    mineralOverlay.current = L.imageOverlay(mineralUrl, mineralBounds, {
      opacity: MINERAL_OPACITY,
      interactive: false,
      pane: "minerals",
      attribution: CRISM_MINERALS.attribution,
    });
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a> · tiles via NASA Mars Trek');

    // Outline of the analysed grid so its extent is always visible.
    L.rectangle(bounds, {
      color: "#555",
      weight: 1,
      fill: false,
      dashArray: "4 3",
      interactive: false,
    }).addTo(m);

    poiLayer.current.addTo(m);
    hiriseLayer.current.addTo(m);
    traverseLayer.current.addTo(m);
    routeLayer.current.addTo(m);
    markerLayer.current.addTo(m);

    m.on("click", (e) => cb.current.onMapClick({ lon: e.latlng.lng, lat: e.latlng.lat }));
    m.on("mousemove", (e) => cb.current.onHover({ lon: e.latlng.lng, lat: e.latlng.lat }));
    m.on("mouseout", () => cb.current.onHover(null));

    // Leaflet only tracks window resizes; the map area also changes size when
    // the elevation profile opens or the layout switches.
    const resize = new ResizeObserver(() => m.invalidateSize({ animate: false }));
    resize.observe(el.current!);

    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      scrubMarker.current = null;
    };
  }, [p.grid]);

  // Toggle optical / thermal tile layers.
  // The tile pane sits *under* the image overlays (elevation/slope/class), so
  // imagery is only clear when those overlays are off or fairly transparent.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const key of TILE_ORDER) {
      const layer = tileLayers.current[key];
      if (!layer) continue;
      if (p.layers[key]) {
        if (!m.hasLayer(layer)) layer.addTo(m);
      } else if (m.hasLayer(layer)) {
        m.removeLayer(layer);
      }
    }
    const thermalOpacity = p.layers.ctx || p.layers.hiriseMosaic ? THERMAL_BLEND_OPACITY : 1;
    tileLayers.current.themisDay?.setOpacity(thermalOpacity);
    tileLayers.current.themisNight?.setOpacity(thermalOpacity);
  }, [p.layers.basemap, p.layers.ctx, p.layers.hiriseMosaic, p.layers.themisDay, p.layers.themisNight]);

  // Derived terrain overlays + opacity.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (["elevation", "slope", "terrainClass"] as const).forEach((k) => {
      const o = overlays.current[k];
      if (!o) return;
      o.setOpacity(p.overlayOpacity);
      if (p.layers[k]) {
        if (!m.hasLayer(o)) o.addTo(m);
      } else if (m.hasLayer(o)) {
        m.removeLayer(o);
      }
    });
    // Keep stacking order stable: elevation under slope under class.
    (["elevation", "slope", "terrainClass"] as const).forEach((k, i) =>
      overlays.current[k]?.setZIndex(i + 1)
    );
  }, [p.layers.elevation, p.layers.slope, p.layers.terrainClass, p.overlayOpacity]);

  // CRISM mineral overlay.
  useEffect(() => {
    const m = map.current;
    const o = mineralOverlay.current;
    if (!m || !o) return;
    if (p.layers.minerals) {
      if (!m.hasLayer(o)) o.addTo(m);
    } else if (m.hasLayer(o)) {
      m.removeLayer(o);
    }
  }, [p.layers.minerals]);

  // Walk-back reachability shade.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const url = p.images.reachability;
    if (reachOverlay.current) {
      m.removeLayer(reachOverlay.current);
      reachOverlay.current = null;
    }
    if (!p.layers.reachability || !url) return;
    const g = p.grid;
    const bounds = L.latLngBounds([g.south, g.meta.west], [g.meta.north, g.east]);
    const o = L.imageOverlay(url, bounds, { opacity: 0.7, interactive: false });
    o.setZIndex(4);
    o.addTo(m);
    reachOverlay.current = o;
  }, [p.layers.reachability, p.images.reachability, p.grid]);

  // HiRISE footprints (approximate boxes).
  useEffect(() => {
    const lg = hiriseLayer.current;
    lg.clearLayers();
    if (!p.layers.hirise) return;
    p.hirise.forEach((fp) => {
      const bounds = L.latLngBounds([fp.south, fp.west], [fp.north, fp.east]);
      const rect = L.rectangle(bounds, {
        color: "#c45c26",
        weight: 1.5,
        dashArray: "4 3",
        fillColor: "#c45c26",
        fillOpacity: 0.08,
        interactive: true,
      });
      rect.bindTooltip(`${fp.name}\n${fp.obsId}`, { direction: "top", sticky: true });
      rect.addTo(lg);
    });
  }, [p.layers.hirise, p.hirise]);

  // POIs.
  useEffect(() => {
    const lg = poiLayer.current;
    lg.clearLayers();
    if (!p.layers.poi) return;
    p.pois.forEach((poi) => {
      const isSel = poi.id === p.selectedPoiId;
      const isWp = p.waypointIds.includes(poi.id);
      const mkr = L.circleMarker([poi.lat, poi.lon], {
        radius: isSel ? 8 : 6,
        color: "#1d1d1d",
        weight: isSel ? 3 : 1.5,
        fillColor: isWp ? "#8b3a8b" : "#f2f2f2",
        fillOpacity: 1,
      });
      mkr.bindTooltip(poi.name, { direction: "top" });
      mkr.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        cb.current.onPoiClick(poi.id);
      });
      mkr.addTo(lg);
    });
  }, [p.layers.poi, p.pois, p.selectedPoiId, p.waypointIds]);

  // Perseverance traverse: dark casing under a light line so it reads on any layer.
  useEffect(() => {
    const lg = traverseLayer.current;
    lg.clearLayers();
    if (!p.layers.traverse || !p.traverse) return;
    for (const line of p.traverse) {
      const latlngs = line.map(([lon, lat]) => [lat, lon] as [number, number]);
      L.polyline(latlngs, { color: "#2b2118", weight: 4.5, opacity: 0.85, lineJoin: "round", interactive: false }).addTo(lg);
      L.polyline(latlngs, { color: TRAVERSE_COLOR, weight: 2, opacity: 1, lineJoin: "round" })
        .bindTooltip(p.traverseLabel, { sticky: true, direction: "top" })
        .addTo(lg);
    }
  }, [p.layers.traverse, p.traverse, p.traverseLabel]);

  // Routes.
  useEffect(() => {
    const lg = routeLayer.current;
    lg.clearLayers();
    if (!p.layers.routes) return;
    [...p.routes]
      .sort((a, b) => Number(a.profile === p.activeProfile) - Number(b.profile === p.activeProfile))
      .forEach((r) => {
        const active = r.profile === p.activeProfile;
        L.polyline(r.latlngs, {
          color: ROUTE_COLORS[r.profile] ?? "#000",
          weight: active ? 5 : 3,
          opacity: active ? 1 : 0.65,
          dashArray: r.profile === "shortest" ? "6 4" : r.profile === "cautious" ? "1 5" : undefined,
          lineCap: "round",
          interactive: false,
        }).addTo(lg);
      });
  }, [p.routes, p.activeProfile, p.layers.routes]);

  // Move the view only when the parent asks. Reading the target through the ref
  // keeps unrelated re-renders (cursor movement) from re-fitting the map.
  useEffect(() => {
    const m = map.current;
    const target = cb.current.fitLatLngs;
    if (!m || p.fitSeq === 0 || !target?.length) return;
    m.invalidateSize({ animate: false });
    if (target.length === 1) {
      m.setView(target[0], Math.max(m.getZoom(), POINT_ZOOM));
      return;
    }
    const b = L.latLngBounds(target);
    if (b.isValid()) m.fitBounds(b.pad(0.2));
  }, [p.fitSeq]);

  // Start / destination / selected / rover-stop markers.
  useEffect(() => {
    const lg = markerLayer.current;
    lg.clearLayers();
    const label = (ll: LonLat, text: string, color: string, extraClass = "") =>
      L.marker([ll.lat, ll.lon], {
        interactive: false,
        icon: L.divIcon({
          className: `pin ${extraClass}`.trim(),
          html: `<span style="background:${color}">${text}</span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(lg);
    if (p.roverStop) {
      if (p.selected)
        L.polyline([[p.selected.lat, p.selected.lon], [p.roverStop.lat, p.roverStop.lon]], {
          color: TRAVERSE_COLOR, weight: 1.5, dashArray: "3 4", interactive: false,
        }).addTo(lg);
      label(p.roverStop, "R", "#5b4636", "pin-rover");
    }
    if (p.selected)
      L.circleMarker([p.selected.lat, p.selected.lon], {
        radius: 5,
        color: "#000",
        weight: 2,
        fill: false,
        interactive: false,
      }).addTo(lg);
    if (p.start) label(p.start, "S", "#1f5f8b");
    if (p.end) label(p.end, "D", "#8b2f1f");
  }, [p.selected, p.start, p.end, p.roverStop]);

  // Profile scrub marker: moved in place, since it updates on every pointer move.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!p.scrub) {
      scrubMarker.current?.remove();
      scrubMarker.current = null;
      return;
    }
    const ll: [number, number] = [p.scrub.lat, p.scrub.lon];
    if (scrubMarker.current) scrubMarker.current.setLatLng(ll);
    else
      scrubMarker.current = L.circleMarker(ll, {
        radius: 7, color: "#1d1d1d", weight: 2, fillColor: "#ffffff", fillOpacity: 1, interactive: false,
      }).addTo(m);
  }, [p.scrub]);

  return <div ref={el} className="map" />;
}
