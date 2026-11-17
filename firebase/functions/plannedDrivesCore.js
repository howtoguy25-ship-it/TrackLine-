// Planned drives (Plan a drive in the app): 30 minutes before a drive is due, re-check the
// traffic with Google's Routes API and send one reminder with the up-to-date leave time.
// refreshPlannedDrives in index.js runs this every 5 minutes. Pure apart from the injected
// predict / send functions, unit-tested in firebase/tests/plannedDrivesCore.test.js.
//
// The "arrive by" rule matches the app's (src/travel/plannedDrives.ts): Google predicts by
// departure time, so ask once from a first guess and once more from that answer.

const RECHECK_LEAD_MS = 30 * 60_000;
// A drive whose leave time passed more than this long ago is too late to remind about.
const TOO_LATE_MS = 10 * 60_000;
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Drives to handle now: not yet reminded, due within 30 minutes, not long past. */
function isDue(drive, nowMs) {
  return drive.reminded !== true && drive.leaveAtMs - nowMs <= RECHECK_LEAD_MS && nowMs - drive.leaveAtMs <= TOO_LATE_MS;
}

async function leaveTimeFor(drive, predict) {
  if (drive.mode === "leave") return { leaveAtMs: drive.targetMs, durationSeconds: await predict(drive.targetMs) };
  const first = await predict(drive.targetMs - 30 * 60_000);
  const second = await predict(drive.targetMs - first * 1000);
  return { leaveAtMs: drive.targetMs - second * 1000, durationSeconds: second };
}

function clock(ms, tz) {
  try {
    return new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: tz || "Australia/Sydney" });
  } catch {
    return new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });
  }
}

function minutes(seconds) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/** The reminder's text and the fields to write back. `fresh` is null when the re-check failed. */
function reminderFor(drive, fresh, nowMs) {
  const to = drive.to && drive.to.name ? drive.to.name : "your destination";
  const leaveAtMs = fresh ? fresh.leaveAtMs : drive.leaveAtMs;
  const durationSeconds = fresh ? fresh.durationSeconds : drive.durationSeconds;
  const title = `Drive to ${to}`;
  let body;
  if (!fresh) {
    body = `Leave at ${clock(leaveAtMs, drive.tz)} (${minutes(durationSeconds)} as planned). Couldn't refresh the traffic just now.`;
  } else if (drive.mode === "arrive") {
    const moved = Math.round((leaveAtMs - drive.leaveAtMs) / 60_000);
    const change = moved <= -2 ? ` Traffic's heavier: ${-moved} min earlier than planned.` : moved >= 2 ? ` Traffic's lighter: ${moved} min later than planned.` : "";
    body = `Leave at ${clock(leaveAtMs, drive.tz)} to arrive by ${clock(drive.targetMs, drive.tz)}. ${minutes(durationSeconds)} with traffic.${change}`;
  } else {
    body = `Leaving at ${clock(leaveAtMs, drive.tz)}: ${minutes(durationSeconds)} with traffic, arriving about ${clock(leaveAtMs + durationSeconds * 1000, drive.tz)}.`;
  }
  return {
    message: { title, body },
    update: { leaveAtMs, durationSeconds, recheckedAt: fresh ? nowMs : null, reminded: true },
  };
}

/** Re-check one due drive; never throws (a failed prediction still sends the planned times). */
async function handleDrive(drive, nowMs, predict) {
  let fresh = null;
  try {
    fresh = await leaveTimeFor(drive, predict);
    if (!Number.isFinite(fresh.leaveAtMs) || !Number.isFinite(fresh.durationSeconds)) fresh = null;
  } catch (err) {
    console.warn("plannedDrives: traffic re-check failed", err && err.message);
  }
  return reminderFor(drive, fresh, nowMs);
}

/** Google Routes API: predicted drive time in seconds for leaving at departMs. */
function routesPredictor(apiKey, fetchImpl, nowMs, drive) {
  return async (departMs) => {
    const body = {
      origin: { location: { latLng: { latitude: drive.from.lat, longitude: drive.from.lng } } },
      destination: { location: { latLng: { latitude: drive.to.lat, longitude: drive.to.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    };
    // The API only takes a future departure time; anything else means "now".
    if (departMs > nowMs + 60_000) body.departureTime = new Date(departMs).toISOString();
    const res = await fetchImpl(ROUTES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.duration" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Routes HTTP ${res.status}`);
    const json = await res.json();
    const d = json && json.routes && json.routes[0] && json.routes[0].duration;
    const seconds = typeof d === "string" ? parseInt(d, 10) : NaN;
    if (!Number.isFinite(seconds)) throw new Error("Routes: no duration");
    return seconds;
  };
}

module.exports = { RECHECK_LEAD_MS, TOO_LATE_MS, isDue, leaveTimeFor, reminderFor, handleDrive, routesPredictor };
