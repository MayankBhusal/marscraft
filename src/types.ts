export interface PoiPov {
  title: string;
  caption: string;
  credit: string;
  /** Path under public/, or absolute URL */
  url: string;
  sourceUrl?: string;
}

export interface PoiFull {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  status: string;
  summary: string;
  observations: string;
  mission: string;
  source: string;
  uncertainty: string;
  pov?: PoiPov;
}

export interface LonLat { lon: number; lat: number }

export interface HiriseFootprint {
  id: string;
  name: string;
  obsId: string;
  url: string;
  centreLat: number;
  centreLon: number;
  west: number;
  east: number;
  south: number;
  north: number;
  note: string;
}

export interface LayerState {
  basemap: boolean;
  ctx: boolean;
  hiriseMosaic: boolean;
  themisDay: boolean;
  themisNight: boolean;
  minerals: boolean;
  hirise: boolean;
  traverse: boolean;
  elevation: boolean;
  slope: boolean;
  terrainClass: boolean;
  reachability: boolean;
  poi: boolean;
  routes: boolean;
}
