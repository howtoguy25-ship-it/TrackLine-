// Live/late for the transit rides on a trip (firebase/functions/index.js transitRealtime, which
// asks Transport for NSW with the server's key). Never invents a delay: no answer = "Timetable".
import type { Route } from "@/services/directions";
import type { Realtime } from "@/travel/transitTimeline";

export async function fetchTransitRealtime(route: Route): Promise<{ configured: boolean; realtime: (Realtime | null)[] }> {
  const legs = route.transitSummary?.legs ?? [];
  if (legs.length === 0) return { configured: true, realtime: [] };
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { httpsCallable } = require("@firebase/functions") as typeof import("@firebase/functions");
  const { functions } = require("@/services/firebase") as typeof import("@/services/firebase");
  /* eslint-enable @typescript-eslint/no-require-imports */
  try {
    const rides = legs.map((l) => ({
      lineName: l.lineName,
      departureTimeMs: l.departureTimeMs,
      from: { lat: l.departureLocation.latitude, lng: l.departureLocation.longitude },
      to: { lat: l.arrivalLocation.latitude, lng: l.arrivalLocation.longitude },
    }));
    const r = (await httpsCallable(functions, "transitRealtime")({ rides })).data as { configured: boolean; realtime: ({ live: boolean; delayMinutes: number | null; stopsAhead?: { name: string }[] } | null)[] };
    return { configured: r.configured, realtime: (r.realtime ?? []).map((x) => (x ? { live: x.live, delayMinutes: x.delayMinutes, stopNames: x.stopsAhead?.map((s) => s.name) } : null)) };
  } catch {
    return { configured: false, realtime: [] };
  }
}
