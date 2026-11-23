// The banner's words for one ahead alert. Only what the data really says: a line is left out
// rather than guessed (no road name -> no "On ..."; no delay -> no "+N min"). Pure.
import { closureLine } from "@/nav/closures";
import type { AheadAlert } from "@/nav/ahead/aheadFeed";
import { formatDistance, type DistanceUnit } from "@/utils/navFormat";

function ago(createdAt: number | null | undefined, nowMs: number): string | null {
  if (!createdAt || !Number.isFinite(createdAt)) return null;
  const min = Math.max(0, Math.round((nowMs - createdAt) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return `${h} h ago`;
}

/** "On Stacey St · 2 lanes closed", "Slow for 1.2 km · +4 min", "Reported 6 min ago · 3 drivers". */
export function aheadSubtitle(a: AheadAlert, road: string | null, unit: DistanceUnit, nowMs: number): string | null {
  const parts: string[] = [];
  if (a.kind === "heavyTraffic" || a.kind === "standstill" || a.mergedTraffic) {
    if (a.lengthM && a.lengthM > 0) parts.push(`${a.kind === "standstill" || a.mergedTraffic === "standstill" ? "Stopped" : "Slow"} for ${formatDistance(a.lengthM, unit)}`);
    if (a.delaySeconds && a.delaySeconds >= 60) parts.push(`+${Math.round(a.delaySeconds / 60)} min`);
  }
  const closed = closureLine(a.closure);
  if (closed) parts.push(closed);
  if (a.source === "community") {
    const when = ago(a.createdAt, nowMs);
    const drivers = (a.confirmCount ?? 0) + 1;
    if (when) parts.push(`Reported ${when} · ${drivers} driver${drivers === 1 ? "" : "s"}`);
  } else if (a.source === "siren") {
    // Where it is isn't known, so no road: what to do instead.
    return "Siren heard · move aside when it's safe";
  } else if (a.source === "official" && a.officialText) {
    parts.push(a.officialText.trim());
  }
  if (road && !(a.source === "official" && a.officialText)) parts.unshift(`On ${road}`);
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

/** "Live Traffic NSW", "by a Tracky" / "by Sam", "Live traffic", "Mapped road feature". */
export function aheadSourceLine(a: AheadAlert): string {
  switch (a.source) {
    case "official":
      return "Live Traffic NSW";
    case "community":
      return a.reporterName ? `by ${a.reporterName}` : "by a Tracky";
    case "traffic":
      return "Live traffic";
    case "siren":
      return "Heard by your phone";
    default:
      return "Mapped road feature";
  }
}

/** The driver's recording to use for this alert's spoken line, if they recorded one. */
export function aheadClipKey(a: AheadAlert): string | undefined {
  switch (a.kind) {
    case "police":
      return "report_police";
    case "crash":
      return "report_crash";
    case "hazard":
    case "object":
    case "carOnShoulder":
      return "report_hazard";
    case "camera":
      return "report_speed_camera";
    case "heavyTraffic":
    case "standstill":
      return "report_heavy_traffic";
    default:
      return undefined;
  }
}

/** The road at a distance along the route: the name of the step it falls in (null if unknown). */
export function roadAtAlong(steps: readonly { distanceMeters: number; targetStreetName?: string }[], alongM: number): string | null {
  let acc = 0;
  for (const step of steps) {
    acc += step.distanceMeters;
    if (acc >= alongM) return step.targetStreetName?.trim() || null;
  }
  return null;
}
