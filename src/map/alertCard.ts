// The rules behind the dark alert card that opens when a report pin is tapped (components/
// AlertCard.tsx): what each line says, when it dismisses itself, and where the spotlight sits.
// Plain functions, unit-tested in __tests__/alertCard.test.ts.

import { formatDistance, type DistanceUnit } from "@/utils/navFormat";
import { ALERT_LABELS, type AlertDoc, type AlertType } from "@/types/alert";
import { incidentStyle, type TrafficIncident } from "@/services/trafficNswModel";
import { REPORT_ITEM_BY_ID, itemOfAlert } from "@/settings/reportCatalog";

/** The card closes itself after this long without a touch. */
export const ALERT_CARD_IDLE_MS = 8000;
/** Under this, the distance line says "Here". */
export const HERE_METERS = 20;
/** Spotlight: the size of the soft circle around the pin (pt), and the dim everywhere else. */
export const SPOTLIGHT_DIAMETER = 140;
export const SPOTLIGHT_DIM = 0.45;

export interface AlertCardModel {
  key: string;
  source: "report" | "official";
  /** "Police", "Crash", or the official category ("Breakdown"). */
  title: string;
  latitude: number;
  longitude: number;
  createdAt: number | null;
  /** "by anonymous", "by Sam", "by Live Traffic NSW". */
  by: string;
  /** The report's note or the official advice, shown in quotes; null = none. */
  note: string | null;
  alertType: AlertType | null;
  /** The official incident's own short location text, when it has one. */
  officialWhere: string | null;
  /** Real thanks count from the alert doc (0 for official alerts, which hide the pill). */
  thanks: number;
  /** The viewer's own report: thanks greyed out. */
  own: boolean;
  /** Where it comes from: "Source: Live Traffic NSW (official)", "Source: TrackLine drivers · confirmed by 3". */
  sourceLine: string;
}

/** The source line for a driver report. */
export function reportSourceLine(alert: Pick<AlertDoc, "confirmCount" | "permanent" | "awaitingApproval">): string {
  const n = alert.confirmCount ?? 0;
  if (alert.permanent) return "Source: TrackLine drivers · confirmed, stays on the map";
  if (alert.awaitingApproval) return `Source: TrackLine drivers · ${n === 0 ? "waiting for confirmation" : `confirmed by ${n} of 3`}`;
  return `Source: TrackLine drivers${n > 0 ? ` · confirmed by ${n}` : ""}`;
}

export function cardForReport(alert: AlertDoc & { thanksCount?: number; reporterName?: string }, viewerUid: string | null): AlertCardModel {
  return {
    key: `report:${alert.id}`,
    source: "report",
    // The exact item ("Stop sign camera", "Narrow bridge"); older reports: their type.
    title: alert.item ? REPORT_ITEM_BY_ID[itemOfAlert(alert)].title : ALERT_LABELS[alert.type],
    latitude: alert.lat,
    longitude: alert.lng,
    createdAt: alert.createdAt || null,
    by: alert.reporterName ? `by ${alert.reporterName}` : "by anonymous",
    note: alert.comment?.trim() || null,
    alertType: alert.type,
    officialWhere: null,
    thanks: alert.thanksCount ?? 0,
    own: !!viewerUid && alert.createdBy === viewerUid,
    sourceLine: reportSourceLine(alert),
  };
}

export function cardForOfficial(incident: TrafficIncident): AlertCardModel {
  // Transport for NSW's own advice, or its headline when the advice is empty.
  const note = (incident.advice || incident.headline || "").trim();
  return {
    key: `official:${incident.id}`,
    source: "official",
    title: incidentStyle(incident).label || "Traffic incident",
    latitude: incident.lat,
    longitude: incident.lng,
    createdAt: incident.updatedAt,
    by: "by Live Traffic NSW",
    note: note || null,
    alertType: null,
    officialWhere: incident.where?.trim() || null,
    // Official alerts carry no thanks: there's nobody in the app to thank.
    thanks: 0,
    own: false,
    sourceLine: "Source: Live Traffic NSW (official)",
  };
}

/** "1.0 km away", "350 m away", "Here" under 20 m. */
export function distanceLine(meters: number | null, unit: DistanceUnit = "km"): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  if (meters < HERE_METERS) return "Here";
  if (unit === "km" && meters >= 1000 && meters < 10_000) return `${(meters / 1000).toFixed(1)} km away`;
  return `${formatDistance(meters, unit)} away`;
}

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
export function timeAgo(createdAt: number | null, now: number): string | null {
  if (!createdAt) return null;
  const min = Math.max(0, Math.round((now - createdAt) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "2 min ago by anonymous". */
export function bylineText(card: Pick<AlertCardModel, "createdAt" | "by">, now: number): string {
  const ago = timeAgo(card.createdAt, now);
  return ago ? `${ago} ${card.by}` : card.by;
}

/**
 * Road + suburb from a Google formatted address: "123 Canterbury Rd, Punchbowl NSW 2196,
 * Australia" -> "Canterbury Rd, Punchbowl". A leading house number (and "Unit 4/") is dropped;
 * state, postcode and country are left off. Null when there isn't enough to say.
 */
export function roadAndSuburb(formatted: string | null | undefined): string | null {
  if (!formatted) return null;
  const parts = formatted.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const road = parts[0].replace(/^(unit|shop|level)?\s*[\d/\-a-z]*\d[\d/\-a-z]*\s+/i, "").trim();
  // "Punchbowl NSW 2196" -> "Punchbowl"
  const suburb = parts[1].replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b.*$/, "").replace(/\s+\d{4}$/, "").trim();
  if (!road && !suburb) return null;
  if (!road || /^\d+$/.test(road)) return suburb || null;
  return suburb && suburb !== road ? `${road}, ${suburb}` : road;
}

/** The spotlight's centre: where the camera puts the pin -- the middle of the padded map area. */
export function spotlightCentre(
  screenWidth: number,
  mapHeight: number,
  padding: { top: number; right: number; bottom: number; left: number }
): { x: number; y: number } {
  return {
    x: padding.left + (screenWidth - padding.left - padding.right) / 2,
    y: padding.top + (mapHeight - padding.top - padding.bottom) / 2,
  };
}
