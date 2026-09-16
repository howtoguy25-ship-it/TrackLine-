import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { saveExpoPushToken } from "@/services/deviceSession";

// Real push registration backing the Owner Dashboard's broadcast-notification feature (see
// deviceSession.ts/OwnerDashboardScreen.tsx) -- every device that grants permission gets a real
// Expo push token saved against its own deviceSessions doc, which is the entire recipient list
// broadcastNotification (firebase/functions/index.js) sends to. A device that declines, or that
// hasn't opened this build yet, is simply absent from that list -- never a fabricated recipient.
//
// Foreground presentation: shows a real banner/sound even while the app is already open, same
// as the platform's own default apps -- a driver getting an owner alert shouldn't need the app
// backgrounded to see it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Requests OS notification permission (a real, standard system prompt -- never auto-granted)
 *  and, once granted, fetches this device's real Expo push token and saves it. Silently does
 *  nothing on denial or failure -- a driver who says no to notifications keeps using the app
 *  exactly as before, this is never a hard requirement. */
export async function registerForPushNotifications(uid: string): Promise<void> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;
    if (finalStatus !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }
    if (finalStatus !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await saveExpoPushToken(uid, token);
  } catch (err) {
    console.warn("[pushNotifications] registration failed", err);
  }
}
