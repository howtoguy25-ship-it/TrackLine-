// Live/late for transit rides (app: src/travel/transitTimeline.ts), from Transport for NSW's
// Trip Planner API (rapidJSON, realtime on: TfNSWTR=true) with the TFNSW_API_KEY secret. For each
// ride the app shows, we find TfNSW's leg on the same line leaving the same time (within
// MATCH_MS) and return how late it is and the stops it calls at. Without the key: not configured
// -- the app then says "Timetable", never an invented delay.
const BASE = "https://api.transport.nsw.gov.au/v1/tp/trip";
const MATCH_MS = 3 * 60_000;

function sydneyParts(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}${parts.month}${parts.day}`, time: `${parts.hour}${parts.minute}` };
}

/** Coordinates are given lng:lat:EPSG:4326 (TfNSW Trip Planner "coord" origin type). */
function tripUrl({ from, to, departMs }) {
  const { date, time } = sydneyParts(departMs);
  const q = new URLSearchParams({
    outputFormat: "rapidJSON",
    coordOutputFormat: "EPSG:4326",
    depArrMacro: "dep",
    itdDate: date,
    itdTime: time,
    type_origin: "coord",
    name_origin: `${from.lng.toFixed(6)}:${from.lat.toFixed(6)}:EPSG:4326`,
    type_destination: "coord",
    name_destination: `${to.lng.toFixed(6)}:${to.lat.toFixed(6)}:EPSG:4326`,
    calcNumberOfTrips: "6",
    TfNSWTR: "true",
  });
  return `${BASE}?${q.toString()}`;
}

const ms = (iso) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** rapidJSON journeys -> the public-transport legs we need. Stop coords come as [lat, lng]. */
function parseLegs(json) {
  const out = [];
  for (const j of (json && json.journeys) || []) {
    for (const l of j.legs || []) {
      const t = l.transportation;
      if (!t || !l.origin || !l.destination) continue;
      const planned = ms(l.origin.departureTimePlanned);
      if (planned == null) continue;
      out.push({
        line: String(t.disassembledName || t.number || t.name || ""),
        lineFull: String(t.name || ""),
        departurePlannedMs: planned,
        departureEstimatedMs: ms(l.origin.departureTimeEstimated),
        isRealtime: l.isRealtimeControlled === true,
        stops: (l.stopSequence || [])
          .slice(1)
          .filter((s) => Array.isArray(s.coord) && s.coord.length >= 2)
          .map((s) => ({ name: String(s.disassembledName || s.name || ""), latitude: s.coord[0], longitude: s.coord[1] })),
      });
    }
  }
  return out;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** For each of the app's rides: TfNSW's realtime for the same service, or null. */
function matchRealtime(tfnswLegs, rides) {
  return rides.map((r) => {
    if (!Number.isFinite(r.departureTimeMs)) return null;
    const want = norm(r.lineName);
    const hit = tfnswLegs
      .filter((l) => (norm(l.line) === want || norm(l.lineFull).includes(want) || want.includes(norm(l.line))) && Math.abs(l.departurePlannedMs - r.departureTimeMs) <= MATCH_MS)
      .sort((a, b) => Math.abs(a.departurePlannedMs - r.departureTimeMs) - Math.abs(b.departurePlannedMs - r.departureTimeMs))[0];
    if (!hit) return null;
    const live = hit.isRealtime && hit.departureEstimatedMs != null;
    return {
      live,
      delayMinutes: live ? Math.round((hit.departureEstimatedMs - hit.departurePlannedMs) / 60_000) : null,
      stopsAhead: hit.stops,
    };
  });
}

function cleanRides(rides) {
  return (Array.isArray(rides) ? rides : []).slice(0, 6).map((r) => ({
    lineName: typeof r?.lineName === "string" ? r.lineName.slice(0, 40) : "",
    departureTimeMs: Number(r?.departureTimeMs),
    from: { lat: Number(r?.from?.lat), lng: Number(r?.from?.lng) },
    to: { lat: Number(r?.to?.lat), lng: Number(r?.to?.lng) },
  }));
}

module.exports = { tripUrl, parseLegs, matchRealtime, cleanRides, sydneyParts, MATCH_MS };
