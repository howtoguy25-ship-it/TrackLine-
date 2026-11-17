import { Linking } from "react-native";
import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "@/navigation/RootNavigator";

// trackline:// links the owner dashboard can put on a message button (DEEP_LINKS in
// firebase/functions/admin/messages.js). Unknown links do nothing.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

type Target = { screen: keyof RootStackParamList; params?: object } | { external: "store" };

/** Where a trackline:// link goes. Pure. */
export function deepLinkTarget(link: string): Target | null {
  switch (link) {
    case "trackline://settings":
      return { screen: "Settings" };
    case "trackline://settings/notifications":
      return { screen: "Settings", params: { category: "alertsCommunity" } };
    case "trackline://account":
      return { screen: "Settings", params: { category: "account" } };
    case "trackline://inbox":
      return { screen: "Inbox" };
    case "trackline://vehicle-check":
      return { screen: "VehicleCheck" };
    case "trackline://trackys":
      return { screen: "TrackyProfile" };
    case "trackline://help":
      return { screen: "Help" };
    case "trackline://travel":
      return { screen: "Map" as keyof RootStackParamList };
    case "trackline://update":
      return { external: "store" };
    default:
      return null;
  }
}

export function openDeepLink(link: string): void {
  const t = deepLinkTarget(link);
  if (!t) return;
  if ("external" in t) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { storeUrl } = require("@/components/AppGates") as typeof import("@/components/AppGates");
    Linking.openURL(storeUrl()).catch(() => {});
    return;
  }
  if (navigationRef.isReady()) (navigationRef.navigate as unknown as (s: string, p?: object) => void)(t.screen, t.params);
}
