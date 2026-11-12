// School zones and school calendars on the phone: read from Firestore (written weekly from the
// official data by the refreshSchoolZones Cloud Function), cached per 0.1-degree tile so they
// work offline. Cached data is re-checked after 7 days and never used once it's over 30 days old
// without a successful re-check (better no zone than a stale one).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import { toShape, type StoredZone, type ZoneShape } from "@/schoolZones/zoneMatch";
import { asSchoolCalendar, type SchoolCalendar } from "@/schoolZones/calendar";
import bundledNsw from "@/data/schoolCalendars/AU-NSW.json";

export const TILE_DEG = 0.1;
export const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const TILE_KEY = (k: string) => `@trackline/schoolZoneTile/${k}`;
const CAL_KEY = (r: string) => `@trackline/schoolCalendar/${r}`;

export function tileKey(lat: number, lng: number): string {
  return `${Math.floor(lat / TILE_DEG)}_${Math.floor(lng / TILE_DEG)}`;
}

/** The tile the point is in and its 8 neighbours (a zone at a tile edge is still found). */
export function tilesAround(lat: number, lng: number): string[] {
  const y = Math.floor(lat / TILE_DEG);
  const x = Math.floor(lng / TILE_DEG);
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(`${y + dy}_${x + dx}`);
  return out;
}

interface Cached<T> {
  fetchedAt: number;
  data: T;
}

/** Use the cache if fresh; re-check if old; drop it if over 30 days and the re-check fails. */
export async function cachedRead<T>(
  key: string,
  fetchFresh: () => Promise<T | null>,
  nowMs: number,
  storage: Pick<typeof AsyncStorage, "getItem" | "setItem"> = AsyncStorage
): Promise<T | null> {
  let cached: Cached<T> | null = null;
  try {
    const raw = await storage.getItem(key);
    cached = raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    cached = null;
  }
  if (cached && nowMs - cached.fetchedAt < REFRESH_AFTER_MS) return cached.data;
  try {
    const fresh = await fetchFresh();
    if (fresh !== null) {
      await storage.setItem(key, JSON.stringify({ fetchedAt: nowMs, data: fresh })).catch(() => {});
      return fresh;
    }
  } catch {
    // offline: fall through to the cache, if it isn't too old
  }
  return cached && nowMs - cached.fetchedAt < MAX_AGE_MS ? cached.data : null;
}

const memoryTiles = new Map<string, ZoneShape[]>();

async function loadTile(k: string, nowMs: number): Promise<ZoneShape[]> {
  const mem = memoryTiles.get(k);
  if (mem) return mem;
  const zones = await cachedRead<StoredZone[]>(
    TILE_KEY(k),
    async () => {
      const snap = await getDoc(doc(db, "schoolZoneTiles", k));
      // A tile with no document simply has no zones (most of the map).
      return snap.exists() ? ((snap.data().zones as StoredZone[]) ?? []) : [];
    },
    nowMs
  );
  const shapes = (zones ?? []).map(toShape);
  memoryTiles.set(k, shapes);
  return shapes;
}

/** All zones in the tiles around a point (deduplicated: a zone can span tiles). */
export async function zonesAround(lat: number, lng: number, nowMs = Date.now()): Promise<ZoneShape[]> {
  const lists = await Promise.all(tilesAround(lat, lng).map((k) => loadTile(k, nowMs).catch(() => [] as ZoneShape[])));
  const seen = new Set<string>();
  const out: ZoneShape[] = [];
  for (const s of lists.flat()) {
    if (seen.has(s.zone.id)) continue;
    seen.add(s.zone.id);
    out.push(s);
  }
  return out;
}

const BUNDLED: Record<string, unknown> = { "AU-NSW": bundledNsw };
const memoryCalendars = new Map<string, SchoolCalendar | null>();

/** The region's official school calendar: Firestore (refreshed yearly), else the bundled copy. */
export async function calendarFor(region: string, nowMs = Date.now()): Promise<SchoolCalendar | null> {
  if (memoryCalendars.has(region)) return memoryCalendars.get(region) ?? null;
  const remote = await cachedRead<unknown>(
    CAL_KEY(region),
    async () => {
      const snap = await getDoc(doc(db, "schoolCalendars", region));
      return snap.exists() ? snap.data() : null;
    },
    nowMs
  ).catch(() => null);
  const fromRemote = asSchoolCalendar(remote);
  const bundled = asSchoolCalendar(BUNDLED[region]);
  // Whichever reaches further into the future (a newer year), so a fresh calendar wins.
  const cal = [fromRemote, bundled].filter((c): c is SchoolCalendar => !!c).sort((a, b) => (a.validTo < b.validTo ? 1 : -1))[0] ?? null;
  memoryCalendars.set(region, cal);
  return cal;
}

/** For tests. */
export function clearSchoolZoneMemory(): void {
  memoryTiles.clear();
  memoryCalendars.clear();
}
