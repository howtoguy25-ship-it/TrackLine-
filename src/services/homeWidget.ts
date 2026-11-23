// The home-screen widget's data (targets/liveActivity/TrackLineHomeWidget.swift): drive time to
// Home and Work with live traffic, and the next planned drive with its leave time. Worked out by
// the app (Google's traffic-aware drive time from where you are), written to the shared App Group,
// stamped with when -- the widget never shows a figure the app didn't get. Pure builder + one
// refresh; components/HomeWidgetSync.tsx decides when.
import type { SavedPlaces } from "@/services/savedPlaces";
import type { PlannedDrive } from "@/travel/plannedDrives";
import type { LatLng } from "@/utils/polyline";
import { formatArrivalClock } from "@/utils/navFormat";

export interface WidgetPlace {
  label: string;
  /** Live drive time in minutes; null when it couldn't be worked out (shown as "—"). */
  minutes: number | null;
  /** Traffic makes it at least 10% slower than usual. */
  slower: boolean;
  url: string;
}
export interface WidgetSnapshot {
  places: WidgetPlace[];
  nextDrive: { to: string; leaveAtText: string; url: string } | null;
  updatedText: string;
}

export type DriveTime = { seconds: number; freeFlowSeconds: number } | null;

export function buildWidgetSnapshot(input: {
  saved: Pick<SavedPlaces, "home" | "work">;
  times: { home?: DriveTime; work?: DriveTime };
  drives: readonly PlannedDrive[];
  nowMs: number;
}): WidgetSnapshot {
  const places: WidgetPlace[] = [];
  for (const key of ["home", "work"] as const) {
    if (!input.saved[key]) continue;
    const t = input.times[key] ?? null;
    places.push({
      label: key === "home" ? "Home" : "Work",
      minutes: t ? Math.max(1, Math.round(t.seconds / 60)) : null,
      slower: !!t && t.seconds >= t.freeFlowSeconds * 1.1,
      url: `trackline://drive/${key}`,
    });
  }
  const next = input.drives.filter((d) => d.leaveAtMs > input.nowMs).sort((a, b) => a.leaveAtMs - b.leaveAtMs)[0];
  return {
    places,
    nextDrive: next ? { to: next.to.name, leaveAtText: formatArrivalClock(next.leaveAtMs), url: "trackline://plan" } : null,
    updatedText: formatArrivalClock(input.nowMs),
  };
}

/** Works out the live drive times (one request per saved place) and builds the snapshot. */
export async function widgetSnapshotNow(
  here: LatLng | null,
  saved: Pick<SavedPlaces, "home" | "work">,
  drives: readonly PlannedDrive[],
  driveTime: (from: LatLng, to: LatLng) => Promise<{ seconds: number; freeFlowSeconds: number }>,
  nowMs: number
): Promise<WidgetSnapshot> {
  const times: { home?: DriveTime; work?: DriveTime } = {};
  for (const key of ["home", "work"] as const) {
    const place = saved[key];
    if (!place || !here) continue;
    times[key] = await driveTime(here, place.location).catch(() => null);
  }
  return buildWidgetSnapshot({ saved, times, drives, nowMs });
}

/** trackline://drive/home|work -> which saved place to drive to. */
export function driveLinkTarget(url: string): "home" | "work" | null {
  const m = /^trackline:\/\/drive\/(home|work)\/?$/.exec(url.trim());
  return m ? (m[1] as "home" | "work") : null;
}
