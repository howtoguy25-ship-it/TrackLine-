// Which school calendar and timezone apply at a point, for OpenStreetMap conditional limits (the
// official NSW zones carry their own). Australia by state; anywhere else: no school calendar (an
// SH/PH-dependent condition is then "unknown" and never shown as active), the phone's timezone.

import { classifyAuRegion, type AuRegionCode } from "@/utils/auStates";

const AU_TIMEZONE: Record<AuRegionCode, string> = {
  NSW: "Australia/Sydney",
  ACT: "Australia/Sydney",
  VIC: "Australia/Melbourne",
  QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide",
  WA: "Australia/Perth",
  TAS: "Australia/Hobart",
  NT: "Australia/Darwin",
};

/** Rough mainland + Tasmania box; offshore territories aren't covered. */
function inAustralia(lat: number, lng: number): boolean {
  return lat <= -10 && lat >= -44 && lng >= 112.5 && lng <= 154;
}

export function regionAt(lat: number, lng: number): { region: string | null; timezone: string } {
  if (inAustralia(lat, lng)) {
    const state = classifyAuRegion(lat, lng);
    // Broken Hill keeps Central time.
    const brokenHill = Math.hypot((lat + 31.955) * 111, (lng - 141.455) * 94) <= 25;
    return { region: `AU-${state}`, timezone: brokenHill ? "Australia/Broken_Hill" : AU_TIMEZONE[state] };
  }
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // keep UTC
  }
  return { region: null, timezone };
}

/** The phone's region ("AU", "US"...), from its locale -- only for the sign's shape. */
export function deviceRegion(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
    const m = /[-_]([A-Z]{2})\b/.exec(locale);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
