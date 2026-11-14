/**
 * Network access to NASA feeds. Each loader says where its data came from so
 * the UI can label it: a live response, a recent browser cache, or the
 * snapshot bundled in public/data (see scripts/fetch_nasa_context.mjs).
 */
import { EnlilSimulation } from "./core/conditions";
import { RoverTraverse } from "./core/rover";

const LOCAL = import.meta.env.BASE_URL + "data/";
/** NASA's shared public key is rate-limited per IP; set VITE_NASA_API_KEY for a personal one. */
const NASA_API_KEY: string = import.meta.env.VITE_NASA_API_KEY || "DEMO_KEY";

const MEDA_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json";
const DONKI_URL = "https://api.nasa.gov/DONKI/WSAEnlilSimulations";
const RAW_IMAGES_URL = "https://mars.nasa.gov/rss/api/";
export const RAW_IMAGES_GALLERY = "https://mars.nasa.gov/mars2020/multimedia/raw-images/";

export const DONKI_WINDOW_DAYS = 30;
const DONKI_CACHE_KEY = "marscraft.donki.v1";
const DONKI_CACHE_MS = 60 * 60 * 1000;

export type FeedOrigin = "live" | "cached" | "snapshot";

export interface Feed<T> {
  data: T;
  origin: FeedOrigin;
  retrievedMs: number;
  /** Why a live request was not used, when it was attempted. */
  fallbackReason?: string;
}

async function getJson(url: string, timeoutMs = 10000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status === 429 ? "rate limit reached" : `request failed (${res.status})`);
    return await res.json();
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? "request timed out" : e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadRoverTraverse(): Promise<RoverTraverse> {
  const data = (await getJson(LOCAL + "m20_traverse.json")) as RoverTraverse;
  if (!Array.isArray(data.paths) || !Array.isArray(data.stops)) throw new Error("the file has no traverse geometry");
  return data;
}

/** Raw MEDA feed (parse with parseMeda). */
export async function loadMeda(): Promise<Feed<unknown>> {
  try {
    return { data: await getJson(MEDA_URL), origin: "live", retrievedMs: Date.now() };
  } catch (e) {
    const snap = (await getJson(LOCAL + "meda_snapshot.json")) as { retrieved: string };
    return { data: snap, origin: "snapshot", retrievedMs: Date.parse(snap.retrieved), fallbackReason: reason(e) };
  }
}

export interface SpaceWeatherData {
  /** Simulations that list a Mars arrival. */
  simulations: EnlilSimulation[];
  /** All simulations DONKI returned for the window. */
  simulationCount: number;
  windowDays: number;
}

const hasMarsArrival = (s: EnlilSimulation) => (s.impactList ?? []).some((i) => i.location === "Mars");

export async function loadSpaceWeather(force = false): Promise<Feed<SpaceWeatherData>> {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(DONKI_CACHE_KEY) ?? "null") as { retrievedMs: number; data: SpaceWeatherData } | null;
      if (cached && Date.now() - cached.retrievedMs < DONKI_CACHE_MS) return { ...cached, origin: "cached" };
    } catch {
      // Storage may be unavailable; fall through to the network.
    }
  }
  try {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const now = Date.now();
    const all = await getJson(`${DONKI_URL}?startDate=${day(now - DONKI_WINDOW_DAYS * 86400000)}&endDate=${day(now)}&api_key=${NASA_API_KEY}`, 15000);
    if (!Array.isArray(all)) throw new Error("unexpected response");
    const data: SpaceWeatherData = {
      simulations: (all as EnlilSimulation[]).filter(hasMarsArrival),
      simulationCount: all.length,
      windowDays: DONKI_WINDOW_DAYS,
    };
    try {
      localStorage.setItem(DONKI_CACHE_KEY, JSON.stringify({ retrievedMs: now, data }));
    } catch {
      // Caching is an optimisation only.
    }
    return { data, origin: "live", retrievedMs: now };
  } catch (e) {
    const snap = (await getJson(LOCAL + "space_weather_snapshot.json")) as { retrieved: string; simulationCount: number; simulations: EnlilSimulation[] };
    return {
      data: { simulations: snap.simulations, simulationCount: snap.simulationCount, windowDays: DONKI_WINDOW_DAYS },
      origin: "snapshot",
      retrievedMs: Date.parse(snap.retrieved),
      fallbackReason: reason(e),
    };
  }
}

export interface RoverImage {
  id: string;
  title: string;
  thumbUrl: string;
  pageUrl: string;
  /** Local mean solar time the frame was taken, "HH:MM". */
  lmst: string | null;
  credit: string;
  /** True when the frame was taken at the same site index as the requested stop. */
  atStop: boolean;
}

interface RawRoverImage {
  imageid?: number | string;
  title?: string;
  image_files?: { small?: string };
  link?: string;
  date_taken_mars?: string;
  credit?: string;
  sol?: number;
  site?: number;
}

const imageCache = new Map<string, Promise<RoverImage[]>>();

/** Left Navcam frames published for a sol, frames from the given site first. Live only. */
export function loadRoverImages(sol: number, site: number, limit = 3): Promise<RoverImage[]> {
  const key = `${sol}:${site}`;
  let pending = imageCache.get(key);
  if (!pending) {
    pending = (async () => {
      const query = `feed=raw_images&category=mars2020&feedtype=json&ver=1.2&num=24&page=0&order=sol+desc&search=%7CNAVCAM_LEFT&condition_2=${sol}:sol:gte&condition_3=${sol}:sol:lte&extended=sample_type::full,`;
      const res = (await getJson(`${RAW_IMAGES_URL}?${query}`, 15000)) as { images?: RawRoverImage[] };
      const images = (res.images ?? [])
        .filter((im): im is RawRoverImage & { image_files: { small: string } } =>
          typeof im.image_files?.small === "string" && im.sol === sol)
        .map((im): RoverImage => ({
          id: String(im.imageid ?? ""),
          title: String(im.title ?? `Sol ${sol} Navcam`),
          thumbUrl: String(im.image_files.small),
          pageUrl: String(im.link ?? RAW_IMAGES_GALLERY),
          lmst: /M(\d{2}:\d{2})/.exec(String(im.date_taken_mars ?? ""))?.[1] ?? null,
          credit: String(im.credit ?? "NASA/JPL-Caltech"),
          atStop: Number(im.site) === site,
        }));
      return [...images.filter((i) => i.atStop), ...images.filter((i) => !i.atStop)].slice(0, limit);
    })();
    imageCache.set(key, pending);
    pending.catch(() => imageCache.delete(key));
  }
  return pending;
}
