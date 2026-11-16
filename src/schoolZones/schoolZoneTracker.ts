// Per GPS fix (and at the exact minute a zone switches on or off): which school zone the car is
// in, whether it's in force, and whether the driver has just entered one that is (for the single
// "School zone, 40" call-out). Pure, so the drive tests run it exactly as MapScreen does.

import { zoneAt, type ZoneShape } from "@/schoolZones/zoneMatch";
import { zoneStatus, type ZoneStatus } from "@/schoolZones/zoneStatus";
import type { SchoolCalendar } from "@/schoolZones/calendar";
import type { LatLng } from "@/utils/polyline";

export interface SchoolZoneNow {
  shape: ZoneShape;
  status: ZoneStatus;
}

export interface SchoolZoneTrackerState {
  /** The zone the car was in, in force, at the last evaluation (null = none). */
  activeZoneId: string | null;
}

export const INITIAL_SCHOOL_ZONE_TRACKER: SchoolZoneTrackerState = { activeZoneId: null };

export function trackSchoolZone(
  prev: SchoolZoneTrackerState,
  input: { position: LatLng; heading: number | null; shapes: ZoneShape[]; calendars: Record<string, SchoolCalendar | null>; nowMs: number }
): { state: SchoolZoneTrackerState; now: SchoolZoneNow | null; entered: boolean; nextChangeMs: number | null } {
  const shape = zoneAt(input.position, input.heading, input.shapes);
  if (!shape) return { state: { activeZoneId: null }, now: null, entered: false, nextChangeMs: null };
  const status = zoneStatus(shape.zone, input.calendars[shape.zone.region] ?? null, input.nowMs);
  const activeZoneId = status.active ? shape.zone.id : null;
  return {
    state: { activeZoneId },
    now: { shape, status },
    // Entering (or the zone switching on while you're in it) counts once, not every second.
    entered: status.active && prev.activeZoneId !== shape.zone.id,
    nextChangeMs: status.nextChangeMs,
  };
}
