// Every screen outside the map, rendered, then EVERY pressable on it pressed: nothing may throw,
// and no button may have an empty handler (a button that does nothing). The map screen, menu,
// settings, search, place page, route screen (mode row, Avoid, Leave later, Go now), alert cards
// and report pins have their own detailed press tests in this folder.
import React from "react";
import { afterAll, afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("./mockNavigation").mockNavigation,
  useRoute: () => ({ key: "X", name: "X", params: {} }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));
jest.mock("expo-haptics", () => ({ impactAsync: () => Promise.resolve(), notificationAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: "light" }, NotificationFeedbackType: {} }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("@/context/SettingsContext", () => ({
  // The app's real defaults (a fresh install), not a hand-made subset.
  useSettings: () => ({ settings: require("@/services/settings").DEFAULT_SETTINGS, loaded: true, updateSettings: () => {} }),
}));
// One signed-in user for the whole run (the real context hands out the same object each render).
const mockAuth = { user: { uid: "u1", isAnonymous: false, email: "a@b.c" }, authTick: 0 };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@/context/LocationContext", () => ({
  useLocation: () => ({
    location: { coords: { latitude: -33.8688, longitude: 151.2093, accuracy: 8, heading: 0, speed: 0 }, timestamp: 0 },
    permissionDenied: false,
    canAskAgain: true,
    requestPermission: () => Promise.resolve(),
  }),
}));
jest.mock("@/services/firebase", () => require("../support/stubs").stubService());
jest.mock("firebase/firestore", () => require("../support/stubs").stubService());
jest.mock("firebase/auth", () => require("../support/stubs").stubService());
jest.mock("firebase/functions", () => require("../support/stubs").stubService());
jest.mock("@firebase/functions", () => require("../support/stubs").stubService());
jest.mock("firebase/storage", () => require("../support/stubs").stubService());
jest.mock("react-native-iap", () => ({
  useIAP: () => ({ connected: false, products: [], availablePurchases: [], getAvailablePurchases: () => Promise.resolve(), fetchProducts: () => Promise.resolve(), requestPurchase: () => Promise.resolve(), finishTransaction: () => Promise.resolve() }),
  ErrorCode: { UserCancelled: "user-cancelled", SkuNotFound: "sku-not-found", ItemUnavailable: "item-unavailable" },
}));
jest.mock("expo-print", () => require("../support/stubs").stubService());
jest.mock("expo-sharing", () => require("../support/stubs").stubService());
jest.mock("expo-contacts", () => require("../support/stubs").stubService());
jest.mock("expo-calendar", () => require("../support/stubs").stubService());
jest.mock("@/services/sentry", () => ({ Sentry: { logger: { error: () => {}, warn: () => {}, info: () => {} }, captureException: () => {} } }));

import { mockNavigation, resetMockNavigation } from "./mockNavigation";

type Screen = [name: string, load: () => React.ComponentType];
const SCREENS: Screen[] = [
  ["Diagnostics", () => require("@/screens/DiagnosticsScreen").DiagnosticsScreen],
  ["Licences", () => require("@/screens/LicensesScreen").LicensesScreen],
  ["Inbox", () => require("@/screens/InboxScreen").InboxScreen],
  ["Plan a drive", () => require("@/screens/PlanADriveScreen").PlanADriveScreen],
  ["Help", () => require("@/screens/HelpScreen").HelpScreen],
  ["Contact support", () => require("@/screens/SupportRequestsScreen").SupportRequestsScreen],
  ["Tracky profile", () => require("@/screens/TrackyProfileScreen").TrackyProfileScreen],
  ["Vehicle check", () => require("@/screens/VehicleCheckScreen").VehicleCheckScreen],
];

/** The press handler the app wrote for a touchable host element (on its Pressable/Button). */
function handlerOf(n: { unstable_fiber: unknown }): ((...a: unknown[]) => unknown) | null {
  let f = n.unstable_fiber as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
  for (let i = 0; f && i < 8; i++, f = f.return as typeof f) {
    const onPress = f.memoizedProps?.onPress;
    if (typeof onPress === "function") return onPress as (...a: unknown[]) => unknown;
  }
  return null;
}

/** Every touchable element on screen, once per handler. */
function pressables() {
  const root = screen.root;
  if (!root) return [];
  const seen = new Set<unknown>();
  return root
    .queryAll((n) => typeof n.props.onResponderRelease === "function" || typeof n.props.onClick === "function")
    .map((n) => ({ node: n, onPress: handlerOf(n) }))
    .filter((p): p is { node: typeof p.node; onPress: (...a: unknown[]) => unknown } => !!p.onPress && !seen.has(p.onPress) && !!seen.add(p.onPress));
}

/** A handler whose body is empty does nothing when pressed. */
function isEmptyHandler(fn: (...a: unknown[]) => unknown): boolean {
  const src = Function.prototype.toString.call(fn).replace(/\s+/g, "");
  return /^(\(\)|function\w*\(\))=>?\{\}$/.test(src) || src === "()=>{}" || src === "()=>undefined" || src === "()=>null";
}

let pressedCount = 0;
afterEach(() => resetMockNavigation());
afterAll(() => console.log(`[press-through] pressed ${pressedCount} buttons across ${SCREENS.length} screens`));

describe("every screen: renders, and every button does something", () => {
  it.each(SCREENS)("%s", async (_name, load) => {
    const Component = load();
    await render(<Component />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const all = pressables();
    expect(all.length).toBeGreaterThan(0);
    const empty = all.filter((p) => isEmptyHandler(p.onPress)).map((p) => p.node.props.testID ?? p.node.props.accessibilityLabel ?? "?");
    expect(empty).toEqual([]);
    for (const p of all) {
      if (p.node.props.accessibilityState?.disabled || p.node.props["aria-disabled"]) continue;
      // Pressing must never throw (an async failure is the handler's own business to show).
      await act(async () => {
        fireEvent.press(p.node);
      });
    }
    pressedCount += all.length;
    void mockNavigation;
  });
});
