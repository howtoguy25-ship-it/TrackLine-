import { useEffect, useRef } from "react";
import { AppState, Linking, Platform } from "react-native";
import { setWidgetSnapshot } from "live-activity";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "@/context/LocationContext";
import { getSavedPlaces } from "@/services/savedPlaces";
import { getDirections } from "@/services/directions";
import { watchPlannedDrives } from "@/services/plannedDrivesStore";
import { driveLinkTarget, widgetSnapshotNow } from "@/services/homeWidget";
import { navigationRef, openDeepLink } from "@/navigation/deepLinks";
import { Sentry } from "@/services/sentry";
import type { PlannedDrive } from "@/travel/plannedDrives";

// Keeps the home-screen widget's drive times fresh while the app is open (on opening, coming back,
// and every 15 minutes), and opens the route when a widget row (trackline://drive/home|work) or
// any other trackline:// link brings the app up.

export const WIDGET_REFRESH_MS = 15 * 60_000;

export function HomeWidgetSync() {
  const { user } = useAuth();
  const { location } = useLocation();
  const here = location ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null;
  const hereRef = useRef(here);
  const drivesRef = useRef<PlannedDrive[]>([]);
  useEffect(() => {
    hereRef.current = here;
  });

  useEffect(() => (user ? watchPlannedDrives(user.uid, (d) => (drivesRef.current = d), () => {}) : undefined), [user]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const saved = await getSavedPlaces();
        const snap = await widgetSnapshotNow(
          hereRef.current,
          saved,
          drivesRef.current,
          async (from, to) => {
            const r = await getDirections(from, to, { useTraffic: true });
            return { seconds: r.durationInTrafficSeconds ?? r.durationSeconds, freeFlowSeconds: r.durationSeconds };
          },
          Date.now()
        );
        await setWidgetSnapshot(JSON.stringify(snap));
      } catch (err) {
        Sentry.logger.warn("widget: refresh failed", { error: String(err) });
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(refresh, 5000);
    const every = setInterval(refresh, WIDGET_REFRESH_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => {
      clearTimeout(first);
      clearInterval(every);
      sub.remove();
    };
  }, []);

  // Links that open the app: a widget row, a notification, a shared link.
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const which = driveLinkTarget(url);
      if (!which) return openDeepLink(url);
      const place = (await getSavedPlaces())[which];
      if (!navigationRef.isReady()) return;
      navigationRef.navigate("Map", place ? { planADriveDestination: place } : undefined);
    };
    Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => void handle(url));
    return () => sub.remove();
  }, []);

  return null;
}
