import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Grid } from "./core/grid";
import { BASEMAP, THEMIS_DAY, THEMIS_NIGHT, CRISM_MINERALS, TrekLayer } from "./config";
import { HiriseFootprint, LayerState, LonLat, PoiFull } from "./types";

export const ROUTE_COLORS: Record<string, string> = {
  shortest: "#3b6ea5",
  balanced: "#a8741a",
  cautious: "#2f7d5b",
};

export interface RouteLine { profile: string; latlngs: [number, number][] }

interface Props {
  grid: Grid;
  images: { elevation: string; slope: string; terrainClass: string; reachability?: string | null };
  layers: LayerState;
  overlayOpacity: number;
  pois: PoiFull[];
  hirise: HiriseFootprint[];
  selected: LonLat | null;
  selectedPoiId: string | null;
  start: LonLat | null;
  end: LonLat | null;
  waypointIds: string[];
  routes: RouteLine[];
  activeProfile: string | null;
  onMapClick: (p: LonLat) => void;
  onHover: (p: LonLat | null) => void;
  onPoiClick: (id: string) => void;
  onBasemapStatus: (s: "loading" | "ok" | "error") => void;
  /** Bumps when the parent wants the map to fit the active route. */
  fitSeq?: number;
  fitLatLngs?: [number, number][];
}

function makeTileLayer(cfg: TrekLayer, onStatus?: (s: "loading" | "ok" | "error") => void): L.TileLayer {
  const tiles = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    zoomOffset: cfg.zoomOffset,
    minZoom: cfg.minZoom,
    maxNativeZoom: cfg.maxNativeZoom,
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

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tileLayers = useRef<Record<string, L.TileLayer>>({});
  const overlays = useRef<Record<string, L.ImageOverlay>>({});
  const mineralOverlay = useRef<L.ImageOverlay | null>(null);
  const reachOverlay = useRef<L.ImageOverlay | null>(null);
  const poiLayer = useRef(L.layerGroup());
  const hiriseLayer = useRef(L.layerGroup());
  const routeLayer = useRef(L.layerGroup());
  const markerLayer = useRef(L.layerGroup());
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
      maxZoom: 14,
      attributionControl: true,
      zoomControl: true,
    });
    map.current = m;
    m.fitBounds(bounds);
    L.control.scale({ metric: true, imperial: false }).addTo(m);

    // Optical basemap (always present as base; visibility toggled).
    const viking = makeTileLayer(BASEMAP, (s) => cb.current.onBasemapStatus(s));
    viking.addTo(m);
    tileLayers.current.basemap = viking;

    // Thermal layers (added on demand).
    tileLayers.current.themisDay = makeTileLayer(THEMIS_DAY);
    tileLayers.current.themisNight = makeTileLayer(THEMIS_NIGHT);

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

    // CRISM mineral image overlay (local PNG, approximate bounds).
    const mb = CRISM_MINERALS.bounds;
    const mineralBounds = L.latLngBounds([mb.south, mb.west], [mb.north, mb.east]);
    const mineralUrl = (import.meta.env.BASE_URL || "/") + CRISM_MINERALS.url;
    mineralOverlay.current = L.imageOverlay(mineralUrl, mineralBounds, {
      opacity: 0.7,
      interactive: false,
    });

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
    routeLayer.current.addTo(m);
    markerLayer.current.addTo(m);

    m.on("click", (e) => cb.current.onMapClick({ lon: e.latlng.lng, lat: e.latlng.lat }));
    m.on("mousemove", (e) => cb.current.onHover({ lon: e.latlng.lng, lat: e.latlng.lat }));
    m.on("mouseout", () => cb.current.onHover(null));

    return () => {
      m.remove();
      map.current = null;
    };
  }, [p.grid]);

  // Toggle optical / thermal tile layers.
  // Leaflet tile pane sits *under* image overlays (elevation/slope/class).
  // So THEMIS is only visible when those overlays are off or very transparent.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const show = (key: string, on: boolean) => {
      const layer = tileLayers.current[key];
      if (!layer) return;
      if (on) {
        if (!m.hasLayer(layer)) layer.addTo(m);
      } else if (m.hasLayer(layer)) {
        m.removeLayer(layer);
      }
    };
    show("basemap", p.layers.basemap);
    show("themisDay", p.layers.themisDay);
    show("themisNight", p.layers.themisNight);
    // Stacking within the tile pane: Viking under Day IR under Night IR.
    const order = ["basemap", "themisDay", "themisNight"] as const;
    for (const k of order) {
      const layer = tileLayers.current[k];
      if (layer && m.hasLayer(layer)) layer.bringToFront();
    }
  }, [p.layers.basemap, p.layers.themisDay, p.layers.themisNight]);

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
      o.setOpacity(0.65);
      o.setZIndex(5);
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
    const o = L.imageOverlay(url, bounds, { opacity: 0.55, interactive: false });
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

  // Fit map to route when the parent requests it (e.g. after loading a scenario).
  useEffect(() => {
    const m = map.current;
    if (!m || !p.fitLatLngs || p.fitLatLngs.length < 2) return;
    const b = L.latLngBounds(p.fitLatLngs);
    if (b.isValid()) m.fitBounds(b.pad(0.25));
  }, [p.fitSeq, p.fitLatLngs]);

  // Start / destination / selected markers.
  useEffect(() => {
    const lg = markerLayer.current;
    lg.clearLayers();
    const label = (ll: LonLat, text: string, color: string) =>
      L.marker([ll.lat, ll.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "pin",
          html: `<span style="background:${color}">${text}</span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(lg);
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
  }, [p.selected, p.start, p.end]);

  return <div ref={el} className="map" />;
}
