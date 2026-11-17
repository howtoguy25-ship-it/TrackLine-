// The transit trip as a timeline (TransitTimelineCard): walks and rides in order, each ride with
// its line, stops, times and -- when Transport for NSW's realtime is available -- whether it's
// running late. Times and fares only ever come from the provider: no fare is shown when Google
// gives none (common in Australia); in NSW the Opal note says how to pay instead.
import type { Route, TransitLeg } from "@/services/directions";
import { shortDuration } from "@/travel/modes";

export interface Realtime {
  /** Minutes late (negative = early); null = the provider says it's on time. */
  delayMinutes: number | null;
  /** The provider is tracking this service live. */
  live: boolean;
  /** Stops left before the one to get off at, from the provider's stop sequence. */
  stopNames?: string[];
}

export type TimelineEntry =
  | { kind: "walk"; text: string; durationSeconds: number }
  | {
      kind: "ride";
      leg: TransitLeg;
      title: string;
      from: string;
      to: string;
      times: string;
      stops: string | null;
      status: string;
      late: boolean;
    };

export function vehicleWord(type: string): string {
  if (type === "BUS" || type === "INTERCITY_BUS" || type === "TROLLEYBUS") return "Bus";
  if (type === "FERRY") return "Ferry";
  if (type === "TRAM") return "Light rail";
  if (type === "SUBWAY" || type === "METRO_RAIL") return "Metro";
  if (type.includes("RAIL")) return "Train";
  return "Transit";
}

export function liveStatusText(rt: Realtime | null | undefined): { text: string; late: boolean } {
  if (!rt) return { text: "Timetable", late: false };
  if (!rt.live) return { text: "Timetable", late: false };
  if (rt.delayMinutes === null || rt.delayMinutes === 0) return { text: "Live · on time", late: false };
  if (rt.delayMinutes > 0) return { text: `Live · ${rt.delayMinutes} min late`, late: rt.delayMinutes >= 2 };
  return { text: `Live · ${-rt.delayMinutes} min early`, late: false };
}

export function timelineFor(route: Route, realtime: readonly (Realtime | null)[] = []): TimelineEntry[] {
  const summary = route.transitSummary;
  if (!summary) return [];
  const segments = summary.segments ?? summary.legs.map((_, i) => ({ kind: "ride" as const, leg: i }));
  const out: TimelineEntry[] = [];
  for (const seg of segments) {
    if (seg.kind === "walk") {
      if (seg.durationSeconds < 30) continue;
      out.push({ kind: "walk", text: `Walk ${shortDuration(seg.durationSeconds)}`, durationSeconds: seg.durationSeconds });
      continue;
    }
    const leg = summary.legs[seg.leg];
    if (!leg) continue;
    const st = liveStatusText(realtime[seg.leg]);
    out.push({
      kind: "ride",
      leg,
      title: `${vehicleWord(leg.vehicleType)} ${leg.lineName}${leg.headsign ? ` towards ${leg.headsign}` : ""}`,
      from: leg.departureStop,
      to: leg.arrivalStop,
      times: [leg.departureText, leg.arrivalText].filter(Boolean).join(" – "),
      stops: typeof leg.numStops === "number" ? `${leg.numStops} stop${leg.numStops === 1 ? "" : "s"}` : null,
      status: st.text,
      late: st.late,
    });
  }
  return out;
}

/** The fare line: the provider's fare when it gives one, otherwise how to pay (NSW: Opal). */
export function fareLine(route: Route, inNsw: boolean): string {
  const fare = route.transitSummary?.fare;
  if (fare && fare.text) return `Fare: ${fare.text}`;
  return inNsw
    ? "Pay with an Opal card or a contactless card or phone. Google gives no fare for this trip, so none is shown."
    : "No fare information for this trip.";
}
