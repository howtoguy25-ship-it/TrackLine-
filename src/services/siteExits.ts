// Fix pass 7 §1: the data side of smart exit gates. OSM sites / gates / private roads around a
// point (our Overpass pipeline, services/osmPlaces.ts: three mirrors, retries, timeout), each
// exit's answers (Firestore siteExits/{exitId}), answering (Cloud Function answerSiteExit:
// anonymous, it builds the pattern), and this phone's own last answer per exit (for "don't ask
// again within 7 days at a similar time"). Real data only: no site found -> no question.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LatLng } from "@/utils/polyline";
import { runOverpassQuery } from "@/services/osmPlaces";
import { callFn } from "@/services/callable";
import { overpassQuery, parseOverpass, type ExitAnswer, type ExitDoc, type SiteData } from "@/nav/exitGates";

const cache = new Map<string, { at: number; data: SiteData }>();
const CACHE_MS = 60 * 60 * 1000;
const MY_ANSWERS_KEY = "@trackline/exitAnswers";

/** Sites, gates and private service roads within ~500 m (cached an hour per ~100 m cell). */
export async function fetchSiteData(p: LatLng): Promise<SiteData> {
  const key = `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const res = await runOverpassQuery(overpassQuery(p));
  const data = parseOverpass(res.elements as unknown as Parameters<typeof parseOverpass>[0]);
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** The answers drivers have given for these exits (missing doc -> null). */
export async function loadExitDocs(ids: string[]): Promise<Record<string, ExitDoc | null>> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { doc, getDoc } = require("firebase/firestore") as typeof import("firebase/firestore");
  const { db } = require("@/services/firebase") as typeof import("@/services/firebase");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const out: Record<string, ExitDoc | null> = {};
  await Promise.all(
    ids.slice(0, 12).map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "siteExits", id));
        out[id] = snap.exists() ? (snap.data() as ExitDoc) : null;
      } catch {
        out[id] = null; // not readable (signed out, or the server isn't deployed yet): no pattern
      }
    })
  );
  return out;
}

export async function myLastAnswer(exitId: string): Promise<ExitAnswer | null> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(MY_ANSWERS_KEY)) ?? "{}") as Record<string, ExitAnswer>;
    return all[exitId] ?? null;
  } catch {
    return null;
  }
}

/** Saves the answer on the phone and sends it (anonymously) to build the exit's pattern. */
export async function answerExit(a: { exitId: string; siteId: string | null; open: boolean; bucket: string; point: LatLng; label: string | null }): Promise<{ sent: boolean }> {
  try {
    const all = JSON.parse((await AsyncStorage.getItem(MY_ANSWERS_KEY)) ?? "{}") as Record<string, ExitAnswer>;
    all[a.exitId] = { open: a.open, bucket: a.bucket, atMs: Date.now() };
    await AsyncStorage.setItem(MY_ANSWERS_KEY, JSON.stringify(all));
  } catch {
    // The phone's copy is a convenience; the answer still goes to the server below.
  }
  try {
    await callFn("answerSiteExit", { gateId: a.exitId, siteId: a.siteId, open: a.open, bucket: a.bucket, lat: a.point.latitude, lng: a.point.longitude, label: a.label });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
