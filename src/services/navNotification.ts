// Android's ongoing navigation notification: the same next-turn / ETA / road the iOS Live Activity
// shows (modules/liveActivity), as a silent, sticky notification while a drive is on, updated with
// it and removed when the drive ends. Tapping it opens the app. iOS does nothing here (it has the
// Live Activity); without notification permission nothing is shown (never an error).
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export const NAV_NOTIFICATION_ID = "trackline-navigation";
export const NAV_CHANNEL_ID = "navigation";

export interface NavNotificationUpdate {
  instruction: string;
  distanceText: string;
  etaText: string;
  roadName: string;
}

/** Title: the next instruction. Body: "12 min · 8.4 km left · on Stacey St" (road only when known). */
export function navNotificationContent(destinationName: string, u: NavNotificationUpdate): { title: string; body: string } {
  const parts = [u.etaText, u.distanceText ? `${u.distanceText} left` : "", u.roadName ? `on ${u.roadName}` : ""].filter(Boolean);
  return { title: u.instruction || `Driving to ${destinationName}`, body: parts.join(" · ") || `Driving to ${destinationName}` };
}

let destination: string | null = null;
let ready: Promise<boolean> | null = null;

async function prepare(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    await Notifications.setNotificationChannelAsync(NAV_CHANNEL_ID, {
      name: "Navigation",
      description: "Your next turn and arrival time while you drive",
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      vibrationPattern: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    const perm = await Notifications.getPermissionsAsync();
    if (perm.granted) return true;
    if (!perm.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function show(u: NavNotificationUpdate): Promise<void> {
  if (!destination || !(await (ready ?? Promise.resolve(false)))) return;
  const { title, body } = navNotificationContent(destination, u);
  await Notifications.scheduleNotificationAsync({
    identifier: NAV_NOTIFICATION_ID,
    content: { title, body, sticky: true, autoDismiss: false, sound: false, data: { url: "trackline://navigation" } },
    trigger: { channelId: NAV_CHANNEL_ID },
  }).catch(() => {});
}

export function startNavNotification(destinationName: string, first: NavNotificationUpdate): void {
  if (Platform.OS !== "android") return;
  destination = destinationName;
  ready = ready ?? prepare();
  void show(first);
}

export function updateNavNotification(u: NavNotificationUpdate): void {
  if (Platform.OS !== "android" || !destination) return;
  void show(u);
}

export function endNavNotification(): void {
  if (Platform.OS !== "android") return;
  destination = null;
  Notifications.dismissNotificationAsync(NAV_NOTIFICATION_ID).catch(() => {});
}
