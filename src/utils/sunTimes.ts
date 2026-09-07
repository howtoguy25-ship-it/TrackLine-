// Real astronomical sunrise/sunset calculation -- the same "sunrise equation" algorithm
// (https://en.wikipedia.org/wiki/Sunrise_equation) the widely-used, MIT-licensed SunCalc.js
// library implements, computed directly from the driver's own real GPS coordinates and the
// current date/time. Never a hardcoded or guessed clock time -- real sunset genuinely varies by
// both location and time of year, which a fixed "6pm" assumption would get wrong for most of the
// year at most latitudes. Verified against real published sunrise/sunset times for Sydney,
// Australia and London before being wired into anything (an earlier hand-derived version of this
// had a longitude sign-convention bug -- caught exactly that way, by checking real numbers
// before trusting the formula). Pure math, no network call, works fully offline.

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const PERIHELION = RAD * 102.9372;
// Real, standard correction for atmospheric refraction at the horizon -- the sun's own geometric
// center is still slightly below the horizon at the moment it visually appears to touch it.
const SUNSET_ANGLE = -0.833 * RAD;
const J0 = 0.0009;

function toJulian(date: Date): number {
  return date.getTime() / DAY_MS - 0.5 + J1970;
}

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}

function toDays(date: Date): number {
  return toJulian(date) - J2000;
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + PERIHELION + Math.PI;
}

function declination(l: number): number {
  return Math.asin(Math.sin(l) * Math.sin(OBLIQUITY));
}

function julianCycle(d: number, lw: number): number {
  return Math.round(d - J0 - lw / (2 * Math.PI));
}

function approxTransit(Ht: number, lw: number, n: number): number {
  return J0 + (Ht + lw) / (2 * Math.PI) + n;
}

function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

/** Real sunrise/sunset for the calendar day/time `date` falls on, at the given latitude/
 *  longitude (both degrees, longitude east-positive -- matching expo-location's own convention).
 *  At extreme latitudes during polar day/night, the hour-angle math can go undefined (no real
 *  sunrise/sunset that day) -- returns midday as both times in that case, an honest "this
 *  calculation doesn't apply here" rather than NaN/a crash. */
export function getSunTimes(date: Date, latitude: number, longitude: number): SunTimes {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  const cosH = (Math.sin(SUNSET_ANGLE) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1 || cosH > 1 || Number.isNaN(cosH)) {
    const noon = fromJulian(Jnoon);
    return { sunrise: noon, sunset: noon };
  }
  const w = Math.acos(cosH);
  const a = approxTransit(w, lw, n);
  const Jset = solarTransitJ(a, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);

  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

// Real, explicit request: night mode kicks in this long after the real computed sunset at the
// driver's own current location, not the instant the sun touches the horizon (real dusk still
// has enough ambient light that "night" processing kicking in immediately would be premature).
const NIGHT_MODE_START_AFTER_SUNSET_MS = 10 * 60 * 1000;

/** True from NIGHT_MODE_START_AFTER_SUNSET_MS after today's real sunset until tomorrow's real
 *  sunrise, at the given location -- computed fresh from `now`, never cached across calendar
 *  days (a call right after midnight correctly falls back to comparing against YESTERDAY's
 *  sunset, since today's own sunset is still hours in the future at that point). */
export function isNightTime(now: Date, latitude: number, longitude: number): boolean {
  const today = getSunTimes(now, latitude, longitude);
  const todayNightStartMs = today.sunset.getTime() + NIGHT_MODE_START_AFTER_SUNSET_MS;
  if (now.getTime() >= todayNightStartMs) return true;
  if (now < today.sunrise) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const y = getSunTimes(yesterday, latitude, longitude);
    return now.getTime() >= y.sunset.getTime() + NIGHT_MODE_START_AFTER_SUNSET_MS;
  }
  return false;
}
