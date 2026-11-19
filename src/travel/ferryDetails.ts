// Ferry details (FerryDetailsCard): the wharves, the departures the provider lists, how long the
// crossing takes, whether cars can go, and the operator's own link for tickets/booking. Built
// only from route data (Google transit FERRY legs; Mapbox/OSRM ferry steps on a drive).
import type { Route } from "@/services/directions";
import { ferryLegs } from "@/travel/modes";

export interface FerryDetails {
  name: string | null;
  fromWharf: string | null;
  toWharf: string | null;
  /** Departure times across the options, earliest first (provider's own text). */
  departures: string[];
  crossingMinutes: number | null;
  carsAllowed: boolean | null;
  bookingUrl: string | null;
}

export function ferryDetailsFor(routes: readonly Route[]): FerryDetails | null {
  const rides: { name: string | null; from: string | null; to: string | null; depText?: string; depMs?: number; arrMs?: number; cars: boolean | null; url: string | null; durationSeconds: number }[] = [];
  for (const r of routes) {
    for (const leg of r.transitSummary?.legs ?? []) {
      if (leg.vehicleType !== "FERRY") continue;
      rides.push({ name: leg.lineName || null, from: leg.departureStop || null, to: leg.arrivalStop || null, depText: leg.departureText, depMs: leg.departureTimeMs, arrMs: leg.arrivalTimeMs, cars: false, url: leg.agencyUrl ?? null, durationSeconds: 0 });
    }
    for (const f of ferryLegs(r)) {
      if (f.carsAllowed !== true) continue;
      rides.push({ name: f.name, from: null, to: null, cars: true, url: null, durationSeconds: f.durationSeconds });
    }
  }
  if (rides.length === 0) return null;
  const first = rides[0];
  const same = rides.filter((x) => x.from === first.from && x.to === first.to && x.cars === first.cars);
  const departures = [...new Map(same.filter((x) => x.depText).sort((a, b) => (a.depMs ?? 0) - (b.depMs ?? 0)).map((x) => [x.depText!, x.depText!])).values()];
  const timed = same.find((x) => x.depMs && x.arrMs);
  const crossingMinutes = timed ? Math.round((timed.arrMs! - timed.depMs!) / 60000) : first.durationSeconds ? Math.round(first.durationSeconds / 60) : null;
  return {
    name: first.name,
    fromWharf: first.from,
    toWharf: first.to,
    departures,
    crossingMinutes,
    carsAllowed: first.cars,
    bookingUrl: same.find((x) => x.url)?.url ?? null,
  };
}

/** Google gives agency links without a scheme sometimes; make it openable (https only). */
export function bookingLink(url: string | null): string | null {
  if (!url) return null;
  const u = url.startsWith("//") ? `https:${url}` : url.replace(/^http:\/\//, "https://");
  return /^https:\/\//.test(u) ? u : null;
}
