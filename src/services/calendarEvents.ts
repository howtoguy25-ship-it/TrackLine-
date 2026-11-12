import * as Calendar from "expo-calendar";

// Real, explicit request (Waze-style redesign Phase 4 -- main menu's upcoming-events row).
// Reads the device's own real calendars/events via expo-calendar -- never writes/modifies
// anything, and only ever surfaces events that actually have a location set (an event with no
// location has nothing a driving app could usefully do with it). Permission-gated: returns an
// empty list rather than throwing when denied/unavailable, so the caller can show an honest
// "not connected" state instead of crashing.

export interface UpcomingDriveEvent {
  id: string;
  title: string;
  location: string;
  startDate: Date;
}

export async function requestCalendarAccess(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissions();
  return status === "granted";
}

export async function getCalendarPermissionStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const { status } = await Calendar.getCalendarPermissions();
  return status as "granted" | "denied" | "undetermined";
}

const LOOKAHEAD_DAYS = 7;
const MAX_EVENTS = 5;

export async function getUpcomingEventsWithLocation(): Promise<UpcomingDriveEvent[]> {
  const { status } = await Calendar.getCalendarPermissions();
  if (status !== "granted") return [];

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (calendars.length === 0) return [];

  const now = new Date();
  const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const events = await Calendar.listEvents(calendars, now, until);

  return events
    .filter((e) => typeof e.location === "string" && e.location.trim().length > 0)
    .map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location!.trim(),
      startDate: typeof e.startDate === "string" ? new Date(e.startDate) : e.startDate,
    }))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .slice(0, MAX_EVENTS);
}
