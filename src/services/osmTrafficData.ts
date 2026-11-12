import { distanceKm } from "@/utils/geo";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Real traffic-signal and speed-camera locations from OpenStreetMap (via the public
// Overpass API) -- genuine community-mapped data, not a licensed government feed. Coverage
// is generally strong in mapped urban areas but can have gaps elsewhere, and speed camera
// tagging in particular varies by region/legal sensitivity -- treat this the same as the
// app's other crowd-sourced alerts: real, but not authoritative. Also mirrors the web app's
// services/osmTrafficData.ts fetchSpeedLimitNear (see below) -- the posted speed-limit
// readout for whichever road the driver is currently on.
//
// Multiple independent public mirrors, not just overpass-api.de -- confirmed by directly
// querying it that the single default instance genuinely times out under load ("The server is
// probably too busy to handle your request", a real HTTP 504 from Overpass itself, not a app
// bug), which is exactly why most areas were coming back empty ("none of the traffic lights
// load, only one area" -- that one area was just the lucky request that beat the timeout).
// All mirrors are queried in parallel and whichever answers first wins; the rest are aborted.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export interface OsmPoint {
  id: number;
  lat: number;
  lng: number;
}

export interface OsmTrafficData {
  trafficLights: OsmPoint[];
  speedCameras: OsmPoint[];
}

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export interface LatLngBoundsPlain {
  sw: { latitude: number; longitude: number };
  ne: { latitude: number; longitude: number };
}

export interface FetchOsmOptions {
  wantTrafficLights: boolean;
  wantSpeedCameras: boolean;
}

// Render-cost caps -- a fully zoomed-out view over a dense city could otherwise return
// thousands of nodes and stall the map's marker layer.
const MAX_TRAFFIC_LIGHTS = 4000;
const MAX_SPEED_CAMERAS = 2000;

// The public Overpass instance is a free, shared, unauthenticated service -- it can
// genuinely take several seconds under load, with no SLA. A hard client-side timeout means
// a slow/hung request fails visibly and lets the debounced fetch on the next pan/zoom retry,
// instead of leaving the layer looking permanently stuck with no feedback.
const FETCH_TIMEOUT_MS = 12000;

// In-memory only (cleared on app restart) -- panning back and forth over the same block
// shouldn't re-hit the network every time. Keyed by rounded bbox + which layers were asked
// for, so toggling a layer on doesn't serve a stale cache missing that data.
const cache = new Map<string, OsmTrafficData>();

function cacheKey(bounds: LatLngBoundsPlain, options: FetchOsmOptions): string {
  const round = (n: number) => n.toFixed(3);
  return `${round(bounds.sw.latitude)},${round(bounds.sw.longitude)},${round(bounds.ne.latitude)},${round(bounds.ne.longitude)}|${options.wantTrafficLights ? "t" : ""}${options.wantSpeedCameras ? "s" : ""}`;
}

export async function fetchOsmTrafficData(
  bounds: LatLngBoundsPlain,
  options: FetchOsmOptions
): Promise<OsmTrafficData> {
  const key = cacheKey(bounds, options);
  const cached = cache.get(key);
  if (cached) return cached;

  const bbox = `${bounds.sw.latitude},${bounds.sw.longitude},${bounds.ne.latitude},${bounds.ne.longitude}`;

  // Only query for the node types actually needed -- if only one layer is toggled on,
  // there's no reason to make Overpass search, transfer, and have us parse the other.
  const clauses: string[] = [];
  if (options.wantTrafficLights) {
    clauses.push(`node["highway"="traffic_signals"](${bbox});`);
  }
  if (options.wantSpeedCameras) {
    clauses.push(`node["highway"="speed_camera"](${bbox});`);
    clauses.push(`node["enforcement"="maxspeed"](${bbox});`);
  }
  if (clauses.length === 0) return { trafficLights: [], speedCameras: [] };

  const query = `[out:json][timeout:25];(${clauses.join("")});out body;`;
  const body = `data=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const requestFrom = async (endpoint: string): Promise<OverpassResponse> => {
    const response = await fetch(endpoint, {
      method: "POST",
      body,
      // Real, confirmed fix: verified directly against overpass-api.de that a request with no
      // real User-Agent is rejected outright (HTTP 406), not served degraded -- a likely real
      // contributor to "traffic lights only load sometimes" beyond just mirror load/timeouts.
      // A descriptive, contactable UA is standard practice for this free, shared,
      // unauthenticated public service.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "TrackLineApp/1.0 (contact: support@tracklinemaps.com)",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${endpoint} returned ${response.status}`);
    }
    return response.json();
  };

  let data: OverpassResponse;
  try {
    data = await Promise.any(OVERPASS_ENDPOINTS.map(requestFrom));
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("Traffic light/speed camera lookup timed out -- try panning the map again");
    }
    throw new Error("Traffic light/speed camera lookup failed -- all data sources unavailable");
  } finally {
    clearTimeout(timeoutHandle);
    // Whichever mirror answered first has already resolved `data` above -- abort the rest so
    // they don't keep doing work for a result nothing will use.
    controller.abort();
  }

  const trafficLights: OsmPoint[] = [];
  const speedCameras: OsmPoint[] = [];

  for (const el of data.elements) {
    if (el.type !== "node") continue;
    const point: OsmPoint = { id: el.id, lat: el.lat, lng: el.lon };
    if (el.tags?.highway === "traffic_signals") {
      if (trafficLights.length < MAX_TRAFFIC_LIGHTS) trafficLights.push(point);
    } else if (el.tags?.highway === "speed_camera" || el.tags?.enforcement === "maxspeed") {
      if (speedCameras.length < MAX_SPEED_CAMERAS) speedCameras.push(point);
    }
  }

  const result = { trafficLights, speedCameras };
  cache.set(key, result);
  return result;
}

export interface SpeedLimitResult {
  kmh: number;
  roadName: string | null;
  // The OSM way this result came from -- used both as the per-road cache key (see
  // speedLimitCache below) and to let a caller re-check "am I still on the same road" without
  // another network round trip.
  wayId: number;
  // True when kmh came from the Australian road-type default table (no real maxspeed tag on
  // the matched way) rather than an actual posted OSM maxspeed value -- callers show a small
  // grey "estimated" dot on the speed-limit sign rather than presenting a guess as a fact.
  estimated: boolean;
}

const MPH_TO_KMH = 1.60934;
// How close the driver's GPS fix needs to be to a tagged road's centerline to trust it as
// "the road they're on" rather than a different nearby street (parallel road, service lane,
// etc). 40m covers normal GPS drift plus lane width without picking up an adjacent street.
const MAX_ROAD_MATCH_KM = 0.04;
const SPEED_LIMIT_FETCH_TIMEOUT_MS = 8000;

// OSM's maxspeed tag is free text: plain numbers are km/h by convention almost everywhere
// this app is used (Australia, most of the world), "50 mph" for the few countries that tag
// speed in mph, and implicit values like "AU:urban" that carry no explicit number -- those
// are skipped rather than guessed at, since a wrong displayed limit is worse than none.
function parseMaxSpeedKmh(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith("mph")) {
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? Math.round(n * MPH_TO_KMH) : null;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Shortest distance from a point to a line segment, in km. Uses a local equirectangular
// projection (treats a small patch of the globe as flat) which is accurate to well under a
// meter at road-segment scale -- more than good enough for a 40m match threshold.
function pointToSegmentDistanceKm(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  const ax = (aLng - pLng) * cosLat;
  const ay = aLat - pLat;
  const bx = (bLng - pLng) * cosLat;
  const by = bLat - pLat;
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * abx + -ay * aby) / lenSq));
  const closestX = ax + t * abx;
  const closestY = ay + t * aby;
  return distanceKm(pLat, pLng, pLat + closestY, pLng + closestX / cosLat);
}

interface OverpassGeomElement extends OverpassElement {
  geometry?: { lat: number; lon: number }[];
}

interface OverpassGeomResponse {
  elements: OverpassGeomElement[];
}

function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest angle (0-180) between two bearings, ignoring which end of the road segment is
// "forward" -- an OSM way isn't reliably digitized in the driver's direction of travel, so
// only how parallel- vs. perpendicular- the segment is to the direction the driver is actually
// heading matters here, not which of the two ends it points toward.
function bearingDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  const undirected = diff > 180 ? 360 - diff : diff;
  return undirected > 90 ? 180 - undirected : undirected;
}

// At an intersection, more than one tagged road can be within MAX_ROAD_MATCH_KM of the
// driver's GPS fix at the same instant -- the crossing street's own centerline can easily be a
// few meters closer than the road actually being driven on. This is real, confirmed-plausible
// wrong-road-at-an-intersection behaviour a pure nearest-segment match can't tell apart. Caps
// how much a heading mismatch can outweigh raw distance (30m worth) -- enough to flip a close
// call at an intersection without letting it override a genuinely much-closer road when heading
// isn't a reliable signal (e.g. stationary, or the very first fix after a cold start).
const HEADING_MISMATCH_PENALTY_KM = 0.03;

// Real Australian default speed limits by OSM highway= road classification -- used ONLY when a
// matched road has no explicit maxspeed tag at all (a genuine, common gap in crowd-sourced OSM
// data, not every real road is individually tagged). These are the actual default limits
// Australian road law applies in the absence of a posted sign for each road class, not an
// arbitrary guess -- but still real estimates rather than a confirmed posted sign, which is why
// SpeedLimitResult.estimated flags them for a visibly different "estimated" treatment in the UI
// rather than presenting them with the same confidence as a real maxspeed tag.
// _link variants (motorway_link, trunk_link, etc, the real OSM tagging for ramps/slip lanes)
// take their parent class's default. Anything not in this table (tracks, paths, service roads
// with no sensible default, cycleways a car wouldn't be matched to anyway) stays unestimated
// (null) rather than guessed.
const AU_DEFAULT_SPEED_BY_HIGHWAY: Record<string, number> = {
  residential: 50,
  living_street: 50,
  unclassified: 50,
  tertiary: 60,
  tertiary_link: 60,
  secondary: 60,
  secondary_link: 60,
  primary: 70,
  primary_link: 70,
  trunk: 80,
  trunk_link: 80,
  motorway: 100,
  motorway_link: 100,
};

// Real day-token set for maxspeed:conditional's common "Mo-Fr"/"Mo,We,Fr" opening_hours-style
// syntax -- see parseMaxspeedConditional's own header for exactly which real-world subset of the
// full OSM opening_hours grammar this supports.
const OSM_DAY_TOKENS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// Array, not a Set -- ConditionalSpeedRule needs to survive a plain JSON.stringify round-trip
// for AsyncStorage persistence (see speedLimitCache below), and Set serializes to "{}".
function expandDayTokens(raw: string): number[] {
  const days = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/);
    if (rangeMatch) {
      const start = OSM_DAY_TOKENS.indexOf(rangeMatch[1]);
      const end = OSM_DAY_TOKENS.indexOf(rangeMatch[2]);
      if (start === -1 || end === -1) continue;
      // Real OSM ranges never wrap (no "Fr-Mo") in the school-zone-style tagging this targets.
      for (let i = start; i <= end; i++) days.add(i);
    } else {
      const idx = OSM_DAY_TOKENS.indexOf(trimmed);
      if (idx !== -1) days.add(idx);
    }
  }
  return Array.from(days);
}

interface ConditionalSpeedRule {
  kmh: number;
  days: number[];
  // Each [startMinuteOfDay, endMinuteOfDay] window -- a day can have more than one (the user's
  // own real example: "08:00-09:30,14:30-16:00", morning AND afternoon school drop-off/pick-up).
  timeWindows: [number, number][];
}

/** Real parser for OSM's maxspeed:conditional tag -- e.g. the user's own real example,
 *  "40 @ (Mo-Fr 08:00-09:30,14:30-16:00)", a genuine, common Australian school-zone tagging
 *  pattern. Supports the real-world common subset actually used for this: one or more
 *  `VALUE @ (DAYS TIME,TIME,...)` clauses separated by `;`. Does NOT attempt the full OSM
 *  opening_hours grammar (which has many far more exotic features -- public holidays, "sunset",
 *  nested exceptions) -- a clause this can't confidently parse is simply skipped rather than
 *  guessed at, same "never guess" rule every other real value in this file follows. */
function parseMaxspeedConditional(raw: string): ConditionalSpeedRule[] {
  const rules: ConditionalSpeedRule[] = [];
  for (const clause of raw.split(";")) {
    const m = clause.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mph)?\s*@\s*\(([^)]*)\)\s*$/i);
    if (!m) continue;
    const isMph = /mph/i.test(clause);
    const rawKmh = parseFloat(m[1]);
    if (!Number.isFinite(rawKmh)) continue;
    const kmh = Math.round(isMph ? rawKmh * MPH_TO_KMH : rawKmh);

    const condition = m[2].trim();
    const dayMatch = condition.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.+)$/);
    if (!dayMatch) continue;
    const days = expandDayTokens(dayMatch[1]);
    if (days.length === 0) continue;

    const timeWindows: [number, number][] = [];
    for (const windowRaw of dayMatch[2].split(",")) {
      const tm = windowRaw.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!tm) continue;
      const startMin = Number(tm[1]) * 60 + Number(tm[2]);
      const endMin = Number(tm[3]) * 60 + Number(tm[4]);
      if (endMin > startMin) timeWindows.push([startMin, endMin]);
    }
    if (timeWindows.length > 0) rules.push({ kmh, days, timeWindows });
  }
  return rules;
}

/** Whichever conditional rule applies to the device's current real local time right now, or null
 *  if none do (outside school hours, wrong day, or the tag couldn't be confidently parsed). Uses
 *  the device's own clock -- the same real "now" every other time-gated feature in this app
 *  (night mode, alert expiry) already relies on. */
function activeConditionalSpeedKmh(rules: ConditionalSpeedRule[], now: Date): number | null {
  // JS getDay(): 0=Sunday..6=Saturday -- remapped to this file's own Mo-first (0=Mo..6=Su)
  // index so it lines up with OSM_DAY_TOKENS/expandDayTokens above.
  const day = (now.getDay() + 6) % 7;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  for (const rule of rules) {
    if (!rule.days.includes(day)) continue;
    if (rule.timeWindows.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end)) {
      return rule.kmh;
    }
  }
  return null;
}

// Real per-road-segment cache (by OSM way id) so the exact same road's speed limit isn't
// re-fetched from Overpass every time MapScreen's own movement-based refetch effect fires while
// still driving down that same road -- only once the matched way actually changes. In-memory for
// the running session, backed by AsyncStorage so it survives an app restart too (a driver's own
// regular commute roads get genuinely free, instant lookups after the very first real fetch).
// Geometry is kept alongside each entry (not just the limit) so fetchSpeedLimitNear can check
// "is the new position still near THIS cached way" without a network call at all -- see its own
// use below.
interface SpeedLimitCacheEntry {
  // The road's own non-conditional limit -- a real posted maxspeed tag, or the Australian
  // road-type default when there's no tag at all (see baseEstimated).
  baseKmh: number;
  baseEstimated: boolean;
  // Real maxspeed:conditional rules for this way (e.g. a school zone), re-evaluated against the
  // CURRENT time on every cache hit -- unlike baseKmh, a cached entry can't just remember
  // whether a conditional limit was active, since that genuinely changes as the clock moves past
  // 09:30 while the driver's still sitting on the same cached road.
  conditionalRules: ConditionalSpeedRule[];
  roadName: string | null;
  geometry: { lat: number; lon: number }[];
}

function resolveCachedSpeed(entry: SpeedLimitCacheEntry, now: Date): { kmh: number; estimated: boolean } {
  const active = entry.conditionalRules.length > 0 ? activeConditionalSpeedKmh(entry.conditionalRules, now) : null;
  return active != null ? { kmh: active, estimated: false } : { kmh: entry.baseKmh, estimated: entry.baseEstimated };
}
const speedLimitCache = new Map<number, SpeedLimitCacheEntry>();
const SPEED_LIMIT_CACHE_STORAGE_KEY = "@trackline/speedLimitCache";
// Real cap on how many roads' worth of geometry sit in memory/AsyncStorage at once -- unbounded
// growth over a long road trip touching hundreds of different roads is a real, avoidable memory/
// storage leak, not a hypothetical one.
const SPEED_LIMIT_CACHE_MAX_ENTRIES = 300;
let speedLimitCacheLoaded = false;

async function loadSpeedLimitCacheOnce(): Promise<void> {
  if (speedLimitCacheLoaded) return;
  speedLimitCacheLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(SPEED_LIMIT_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed: [number, SpeedLimitCacheEntry][] = JSON.parse(raw);
    for (const [wayId, entry] of parsed) speedLimitCache.set(wayId, entry);
  } catch {
    // A corrupt/unreadable cache just means a cold start re-fetches from Overpass -- never a
    // reason to crash or block real speed-limit lookups.
  }
}

function persistSpeedLimitCache(): void {
  const entries = Array.from(speedLimitCache.entries()).slice(-SPEED_LIMIT_CACHE_MAX_ENTRIES);
  AsyncStorage.setItem(SPEED_LIMIT_CACHE_STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

function cacheEntryMatchesPosition(entry: SpeedLimitCacheEntry, lat: number, lng: number): boolean {
  for (let i = 0; i < entry.geometry.length - 1; i++) {
    const a = entry.geometry[i];
    const b = entry.geometry[i + 1];
    if (pointToSegmentDistanceKm(lat, lng, a.lat, a.lon, b.lat, b.lon) < MAX_ROAD_MATCH_KM) return true;
  }
  return false;
}

/** Finds the real, OSM-tagged posted speed limit for whichever road the driver is actually on,
 *  or null if no tagged road is close enough / no nearby road has an explicit maxspeed. Prefers
 *  a candidate road whose own direction roughly matches `headingDeg` (the driver's live
 *  direction of travel, when known) over a merely-closer one, so a crossing street at an
 *  intersection doesn't win just because its centerline happens to be a few meters nearer at
 *  that exact instant -- see bearingDiffDeg/HEADING_MISMATCH_PENALTY_KM above. Same "real,
 *  community-mapped, not an official feed" caveat as the traffic-light/speed-camera layer above
 *  -- and the same multi-mirror fetch pattern (see OVERPASS_ENDPOINTS) so one slow/overloaded
 *  Overpass instance doesn't block the reading from updating as the driver moves onto a new
 *  road. */
// The most recently matched way id, module-scoped (this service is already a de facto app-wide
// singleton, same as speedLimitCache above) -- checked first on every call so a straight drive
// down one long road costs exactly one real Overpass fetch, not one per GPS-movement tick.
let lastMatchedWayId: number | null = null;

export async function fetchSpeedLimitNear(
  lat: number,
  lng: number,
  headingDeg?: number | null
): Promise<SpeedLimitResult | null> {
  await loadSpeedLimitCacheOnce();

  // Real cache hit: still within match range of the same road fetchSpeedLimitNear last matched
  // -- return it with zero network calls. Only a school-zone conditional limit needs
  // re-evaluating against the CURRENT time even on a cache hit (the device's clock moved, the
  // tag didn't), so that check still runs fresh every call.
  if (lastMatchedWayId != null) {
    const cached = speedLimitCache.get(lastMatchedWayId);
    if (cached && cacheEntryMatchesPosition(cached, lat, lng)) {
      const resolved = resolveCachedSpeed(cached, new Date());
      return { kmh: resolved.kmh, roadName: cached.roadName, wayId: lastMatchedWayId, estimated: resolved.estimated };
    }
  }

  // No `["maxspeed"]` filter here (unlike the old query) -- a road with only maxspeed:conditional,
  // or no maxspeed tag at all (needing the Australian road-type default below), must still come
  // back, not just roads with a plain maxspeed tag.
  const query = `[out:json][timeout:15];way["highway"](around:120,${lat},${lng});out geom tags 60;`;
  const body = `data=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SPEED_LIMIT_FETCH_TIMEOUT_MS);

  const requestFrom = async (endpoint: string): Promise<OverpassGeomResponse> => {
    const response = await fetch(endpoint, {
      method: "POST",
      body,
      // See fetchOsmTrafficData's own comment above -- same real, confirmed requirement.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "TrackLineApp/1.0 (contact: support@tracklinemaps.com)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    return response.json();
  };

  let data: OverpassGeomResponse;
  try {
    data = await Promise.any(OVERPASS_ENDPOINTS.map(requestFrom));
  } catch {
    // Best-effort -- a missed lookup just means the badge doesn't update this tick, retried
    // automatically on the next GPS move (see MapScreen.tsx's throttled refetch effect).
    return null;
  } finally {
    clearTimeout(timeoutHandle);
    controller.abort();
  }

  const now = new Date();
  let best:
    | {
        score: number;
        wayId: number;
        kmh: number;
        estimated: boolean;
        baseKmh: number;
        baseEstimated: boolean;
        conditionalRules: ConditionalSpeedRule[];
        roadName: string | null;
        geometry: { lat: number; lon: number }[];
      }
    | null = null;

  for (const way of data.elements) {
    if (way.type !== "way" || !way.geometry || way.geometry.length < 2 || !way.tags?.highway) continue;

    // Real priority order, highest confidence first: an active school-zone/time-conditional
    // limit (it's genuinely in force right now) > a plain posted maxspeed tag > the Australian
    // road-type default (an honest estimate, never presented as a confirmed sign -- see
    // `estimated` below). baseKmh/baseEstimated/conditionalRules are what actually get cached
    // (see below) -- `kmh`/`estimated` here are just this moment's resolved display value.
    const conditionalRaw = way.tags["maxspeed:conditional"];
    const conditionalRules = conditionalRaw ? parseMaxspeedConditional(conditionalRaw) : [];
    const activeConditional = conditionalRules.length > 0 ? activeConditionalSpeedKmh(conditionalRules, now) : null;

    let baseKmh: number | null = way.tags.maxspeed ? parseMaxSpeedKmh(way.tags.maxspeed) : null;
    let baseEstimated = false;
    if (baseKmh === null) {
      const fallback = AU_DEFAULT_SPEED_BY_HIGHWAY[way.tags.highway];
      if (fallback === undefined && activeConditional == null) continue;
      if (fallback !== undefined) {
        baseKmh = fallback;
        baseEstimated = true;
      }
    }
    const kmh = activeConditional ?? baseKmh;
    if (kmh === null) continue;
    const estimated = activeConditional == null && baseEstimated;

    let minDist = Infinity;
    let closestSegmentBearing = 0;
    for (let i = 0; i < way.geometry.length - 1; i++) {
      const a = way.geometry[i];
      const b = way.geometry[i + 1];
      const d = pointToSegmentDistanceKm(lat, lng, a.lat, a.lon, b.lat, b.lon);
      if (d < minDist) {
        minDist = d;
        closestSegmentBearing = bearingDeg(a.lat, a.lon, b.lat, b.lon);
      }
    }
    if (minDist >= MAX_ROAD_MATCH_KM) continue;

    const headingPenaltyKm =
      headingDeg != null
        ? (bearingDiffDeg(closestSegmentBearing, headingDeg) / 90) * HEADING_MISMATCH_PENALTY_KM
        : 0;
    const score = minDist + headingPenaltyKm;

    if (!best || score < best.score) {
      best = {
        score,
        wayId: way.id,
        kmh,
        estimated,
        baseKmh: baseKmh as number,
        baseEstimated,
        conditionalRules,
        roadName: way.tags.name ?? null,
        geometry: way.geometry,
      };
    }
  }

  if (!best) return null;

  lastMatchedWayId = best.wayId;
  speedLimitCache.set(best.wayId, {
    baseKmh: best.baseKmh,
    baseEstimated: best.baseEstimated,
    conditionalRules: best.conditionalRules,
    roadName: best.roadName,
    geometry: best.geometry,
  });
  persistSpeedLimitCache();

  return { kmh: best.kmh, roadName: best.roadName, wayId: best.wayId, estimated: best.estimated };
}
