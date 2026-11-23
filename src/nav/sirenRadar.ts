// Siren radar (the app side): when it may listen, which banner shows, when to ask "Did you see an
// emergency vehicle or incident?", and what a "Yes" report files. The hearing itself is
// services/sirenDetection.ts (YAMNet on the phone) + services/sirenTracker.ts (3 of 5 windows).
// Pure; tested in __tests__/siren/sirenRadar.test.ts.
import type { ClosureDetails } from "@/nav/closures";
import type { ReportItemId } from "@/settings/reportCatalog";
import { containsBlockedLanguage } from "@/utils/commentFilter";
import type { Closeness, SirenType } from "@/services/sirenTracker";

type LatLng = { latitude: number; longitude: number };

/** "While driving": over 10 km/h now, or within this long of it (a red light doesn't switch it off). */
export const DRIVE_GRACE_MS = 2 * 60_000;
/** The question waits this long after the siren ends for the car to slow down. */
export const ASK_WITHIN_MS = 10 * 60_000;
export const ASK_BELOW_KMH = 10;
/** Unanswered, the question goes away by itself. */
export const QUESTION_TIMEOUT_MS = 10_000;
/** "Passing through" reports leave the map after 15 minutes. */
export const PASSING_TTL_MS = 15 * 60_000;
export const TITLE_MAX = 40;
/** "Ahead of me" / "Behind me" put the pin this far along / against your heading. */
export const QUICK_PIN_M = 100;
/** How long the position trail is kept (to find where the siren was loudest). */
export const TRAIL_MS = ASK_WITHIN_MS + 60_000;

export const RADAR_SPOKEN = "Emergency vehicle nearby, make way when safe.";
export const RADAR_DISCLAIMER = "Driver assistance only — always watch and listen for emergency vehicles yourself.";

/** Last time the car was over 10 km/h (or null), updated from each fix. */
export function noteMoving(lastMovingAt: number | null, speedKmh: number | null, now: number): number | null {
  return speedKmh != null && speedKmh > ASK_BELOW_KMH ? now : lastMovingAt;
}

export function isDriving(lastMovingAt: number | null, now: number, navigating: boolean): boolean {
  return navigating || (lastMovingAt != null && now - lastMovingAt <= DRIVE_GRACE_MS);
}

export interface RadarBanner {
  type: SirenType;
  closeness: Closeness;
}

/** One banner at a time: the siren wins over an ahead alert; during a turn close-up only if it's getting closer. */
export function showRadarBanner(b: RadarBanner | null, manoeuvreZoom: boolean): boolean {
  return !!b && (!manoeuvreZoom || b.closeness === "closer");
}

export interface PendingQuestion {
  endedAt: number;
  type: SirenType;
  /** Where the car was when the siren was loudest (null if no fix then). */
  loudest: LatLng | null;
}

/** Ask only once you've (nearly) stopped, or a passenger is holding the phone; give up after 10 min. */
export function shouldAsk(q: PendingQuestion | null, now: number, speedKmh: number | null, passenger: boolean): boolean {
  if (!q || now - q.endedAt > ASK_WITHIN_MS) return false;
  return passenger || (speedKmh != null && speedKmh < ASK_BELOW_KMH);
}

export function questionExpired(q: PendingQuestion | null, now: number): boolean {
  return !!q && now - q.endedAt > ASK_WITHIN_MS;
}

/** "Yes" / "No" said out loud (same words the other voice questions take). */
export function yesNo(text: string): "yes" | "no" | null {
  const t = text.toLowerCase().replace(/[^a-z\s]/g, " ").trim();
  if (/\b(yes|yeah|yep|yup|correct|i did|sure)\b/.test(t)) return "yes";
  if (/\b(no|nope|nah|didn ?t|did not|not really)\b/.test(t)) return "no";
  return null;
}

/** Points kept with time, to look up where the car was when the siren was loudest. */
export class PositionTrail {
  private pts: { at: number; p: LatLng }[] = [];
  push(at: number, p: LatLng): void {
    this.pts.push({ at, p });
    const cut = at - TRAIL_MS;
    while (this.pts.length && this.pts[0].at < cut) this.pts.shift();
  }
  /** The fix nearest in time (within 30 s), or null. */
  at(t: number): LatLng | null {
    let best: { at: number; p: LatLng } | null = null;
    for (const x of this.pts) if (!best || Math.abs(x.at - t) < Math.abs(best.at - t)) best = x;
    return best && Math.abs(best.at - t) <= 30_000 ? best.p : null;
  }
}

export type SirenVehicle = "ambulance" | "police" | "unmarkedPolice" | "fire" | "rescue" | "other";
export type SirenWhat = "passing" | "crash" | "blocked" | "policeStop" | "unknown";

export const VEHICLE_LABEL: Record<SirenVehicle, string> = {
  ambulance: "Ambulance",
  police: "Police",
  unmarkedPolice: "Unmarked police",
  fire: "Fire truck",
  rescue: "SES / Rescue",
  other: "Other",
};
export const WHAT_LABEL: Record<SirenWhat, string> = {
  passing: "Passing through",
  crash: "Crash",
  blocked: "Road blocked",
  policeStop: "Police stop",
  unknown: "Unknown",
};

/** The chip the sheet starts on, from what the radar heard. */
export function vehicleFromType(t: SirenType): SirenVehicle {
  return t === "police" ? "police" : t === "ambulance" ? "ambulance" : t === "fire" ? "fire" : "other";
}

export interface SirenDraft {
  vehicle: SirenVehicle;
  what: SirenWhat;
  title: string;
}

export function titleProblem(title: string): string | null {
  if (title.length > TITLE_MAX) return `Up to ${TITLE_MAX} characters`;
  if (containsBlockedLanguage(title)) return "Please keep it clean";
  return null;
}

export interface SirenReportPlan {
  item: ReportItemId;
  /** Overrides the driver's usual expiry (passing through only); otherwise the normal rules. */
  ttlMs: number | null;
  comment: string;
  closure: ClosureDetails | null;
}

/** What a "Yes" files, through the normal report pipeline. */
export function sirenReport(d: SirenDraft): SirenReportPlan {
  const title = d.title.trim().slice(0, TITLE_MAX);
  const comment = title && !containsBlockedLanguage(title) ? `${VEHICLE_LABEL[d.vehicle]}: ${title}` : VEHICLE_LABEL[d.vehicle];
  switch (d.what) {
    case "passing":
      return { item: "emergencyVehicles", ttlMs: PASSING_TTL_MS, comment, closure: null };
    case "crash":
      return { item: "crash", ttlMs: null, comment, closure: null };
    case "blocked":
      // Blocked where you were, your way (closures.ts adds your heading; no heading = both).
      return { item: "closures", ttlMs: null, comment, closure: { direction: "mine", lanes: "all", until: "1h" } };
    case "policeStop":
      return { item: "police", ttlMs: null, comment, closure: null };
    default:
      return { item: "emergencyVehicles", ttlMs: null, comment, closure: null };
  }
}

/** A point `m` metres from `p` on bearing `deg`. */
export function offsetPoint(p: LatLng, deg: number, m: number): LatLng {
  const R = 6371000;
  const b = (deg * Math.PI) / 180;
  const lat1 = (p.latitude * Math.PI) / 180;
  const lng1 = (p.longitude * Math.PI) / 180;
  const d = m / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI };
}

/** The three quick pin spots. */
export function quickPin(where: "ahead" | "behind" | "heard", car: LatLng, headingDeg: number | null, loudest: LatLng | null): LatLng {
  if (where === "heard") return loudest ?? car;
  if (headingDeg == null) return car;
  return offsetPoint(car, where === "ahead" ? headingDeg : headingDeg + 180, QUICK_PIN_M);
}
