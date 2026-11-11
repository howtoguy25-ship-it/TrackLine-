// "Share drive": a link to a destination that someone else can open to start driving there.
//
//   https://tracklinemaps.com/drive?lat=-33.86&lng=151.21&name=Opera+House&addr=...
//
// On a phone with TrackLine installed the web page at that address hands over to the app
// (trackline://drive?...), which opens straight onto the route preview for that place. Without
// the app, the same page offers the destination in the phone's own maps app instead -- so the
// link is useful to whoever receives it either way. (The live "follow my trip" link is a
// different thing: services/liveShare.ts.)
//
// Pure string handling with no imports, checked by scripts/test-drive-link.ts.

export const DRIVE_LINK_WEB_BASE = "https://tracklinemaps.com/drive";
export const DRIVE_LINK_APP_SCHEME = "trackline";

export interface DriveLinkTarget {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

const MAX_TEXT_LENGTH = 120;

function clean(text: string | undefined | null): string {
  // Collapses whitespace and drops control characters: this text arrives from a link anyone
  // can write, and ends up on screen.
  return (text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function query(target: DriveLinkTarget): string {
  const parts = [
    `lat=${target.latitude.toFixed(6)}`,
    `lng=${target.longitude.toFixed(6)}`,
    `name=${encodeURIComponent(clean(target.name))}`,
  ];
  const address = clean(target.address);
  if (address) parts.push(`addr=${encodeURIComponent(address)}`);
  return parts.join("&");
}

/** The link to send to someone. */
export function buildDriveLink(target: DriveLinkTarget): string {
  return `${DRIVE_LINK_WEB_BASE}?${query(target)}`;
}

/** The link the web page uses to hand over to the installed app. */
export function buildAppDriveLink(target: DriveLinkTarget): string {
  return `${DRIVE_LINK_APP_SCHEME}://drive?${query(target)}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return "";
  }
}

/**
 * Reads a drive link in either form. Returns null for anything else, or for a link whose
 * coordinates aren't a real place on Earth -- a malformed link must never turn into a route to
 * nowhere.
 */
export function parseDriveLink(url: string | null | undefined): DriveLinkTarget | null {
  if (!url) return null;
  const match = /^(?:trackline:\/\/drive|https:\/\/(?:www\.)?tracklinemaps\.com\/drive)\/?\?([^#]*)/i.exec(url.trim());
  if (!match) return null;

  const params: Record<string, string> = {};
  for (const pair of match[1].split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    params[pair.slice(0, eq)] = decode(pair.slice(eq + 1));
  }

  if (!/^-?\d+(\.\d+)?$/.test(params.lat ?? "") || !/^-?\d+(\.\d+)?$/.test(params.lng ?? "")) return null;
  const latitude = Number(params.lat);
  const longitude = Number(params.lng);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // 0,0 is the classic "missing coordinates" value, and open ocean.
  if (latitude === 0 && longitude === 0) return null;

  return {
    latitude,
    longitude,
    name: clean(params.name) || "Shared destination",
    address: clean(params.addr),
  };
}

/** The words that go with the link when it's shared. */
export function driveShareMessage(target: DriveLinkTarget): string {
  const name = clean(target.name) || "this place";
  return `Drive to ${name} with TrackLine: ${buildDriveLink(target)}`;
}
