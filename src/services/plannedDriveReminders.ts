// Plan a drive's "time to leave" alerts on the phone itself: one local notification per planned
// drive at its current leave time. Re-synced whenever the drive list changes (including after
// the server's 30-minute traffic re-check moves a leave time), so the alert follows the latest
// prediction. The server sends the 30-minute heads-up push; this is the at-the-time alert.
import * as Notifications from "expo-notifications";
import type { PlannedDrive } from "@/travel/plannedDrives";
import { formatArrivalClock } from "@/utils/navFormat";

const PREFIX = "planned-drive-";

export function leaveReminderContent(d: PlannedDrive): { title: string; body: string } {
  return {
    title: `Time to leave for ${d.to.name}`,
    body: `Leave now to arrive about ${formatArrivalClock(d.leaveAtMs + d.durationSeconds * 1000)}.`,
  };
}

export async function syncLeaveReminders(drives: PlannedDrive[], enabled: boolean, nowMs = Date.now()): Promise<void> {
  const perm = await Notifications.getPermissionsAsync();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ours = scheduled.filter((n) => n.identifier.startsWith(PREFIX));
  const wanted = enabled && perm.granted ? drives.filter((d) => d.leaveAtMs > nowMs + 60_000) : [];
  const wantedIds = new Set(wanted.map((d) => PREFIX + d.id));
  for (const n of ours) if (!wantedIds.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  for (const d of wanted) {
    // Re-schedule each time so a moved leave time replaces the old alert.
    await Notifications.scheduleNotificationAsync({
      identifier: PREFIX + d.id,
      content: { ...leaveReminderContent(d), sound: "default", data: { kind: "plannedDrive", driveId: d.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(d.leaveAtMs) },
    });
  }
}
