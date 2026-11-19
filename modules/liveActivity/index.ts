import { Platform } from "react-native";

// Real native ActivityKit bridge (see ios/LiveActivityModule.swift) -- Android has no equivalent
// OS-level concept (no Lock Screen Live Activity/Dynamic Island system), so every export here is
// a safe, real no-op on Android rather than a platform check every call site would otherwise
// need to repeat. requireNativeModule only resolves once this module has actually been compiled
// into a dev/prod build via `expo prebuild` + EAS Build (never in Expo Go).
interface NativeLiveActivityModule {
  isSupported(): Promise<boolean>;
  startActivity(
    destinationName: string,
    instruction: string,
    maneuverSymbol: string,
    distanceText: string,
    etaText: string,
    roadName: string,
    currentSpeedKmh: number | null,
    speedLimitKmh: number | null
  ): Promise<void>;
  updateActivity(
    instruction: string,
    maneuverSymbol: string,
    distanceText: string,
    etaText: string,
    roadName: string,
    currentSpeedKmh: number | null,
    speedLimitKmh: number | null
  ): Promise<void>;
  endActivity(): Promise<void>;
}

let native: NativeLiveActivityModule | null = null;
if (Platform.OS === "ios") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    native = require("expo-modules-core").requireNativeModule("LiveActivity");
  } catch {
    // Real, expected case in Expo Go / a build that predates this module -- never a crash, the
    // exported functions below just become no-ops (see the `native?.` guards).
    native = null;
  }
}

export interface LiveActivityUpdate {
  instruction: string;
  // One of MANEUVER_SF_SYMBOLS below -- see its own comment for the Ionicons->SF Symbol mapping.
  maneuverSymbol: string;
  distanceText: string;
  etaText: string;
  roadName: string;
  currentSpeedKmh: number | null;
  speedLimitKmh: number | null;
}

// Mirrors NavigationInstructionCard's own MANEUVER_ICONS (Ionicons names) with the closest real
// SF Symbol for each -- the widget extension is pure SwiftUI and can't render Ionicons/vector
// icon fonts at all, only SF Symbols (system-provided) or bundled image assets, so this is a
// real, separate icon set, not a missing asset.
const MANEUVER_SF_SYMBOLS: Record<string, string> = {
  "turn-left": "arrow.turn.up.left",
  "turn-right": "arrow.turn.up.right",
  "turn-slight-left": "arrow.up.left",
  "turn-slight-right": "arrow.up.right",
  "turn-sharp-left": "arrow.turn.down.left",
  "turn-sharp-right": "arrow.turn.down.right",
  "uturn-left": "arrow.uturn.left",
  "uturn-right": "arrow.uturn.right",
  merge: "arrow.triangle.merge",
  "roundabout-left": "arrow.triangle.2.circlepath",
  "roundabout-right": "arrow.triangle.2.circlepath",
  "fork-left": "arrow.triangle.branch",
  "fork-right": "arrow.triangle.branch",
  "ramp-left": "arrow.up.left",
  "ramp-right": "arrow.up.right",
  straight: "arrow.up",
};

export function maneuverToSfSymbol(maneuver: string | null | undefined): string {
  return (maneuver && MANEUVER_SF_SYMBOLS[maneuver]) || "arrow.up";
}

export async function isLiveActivitySupported(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isSupported();
  } catch {
    return false;
  }
}

export async function startLiveActivity(destinationName: string, update: LiveActivityUpdate): Promise<void> {
  if (!native) return;
  try {
    await native.startActivity(
      destinationName,
      update.instruction,
      update.maneuverSymbol,
      update.distanceText,
      update.etaText,
      update.roadName,
      update.currentSpeedKmh,
      update.speedLimitKmh
    );
  } catch {
    // Same "never blocks real in-app navigation" principle as the native module's own catch --
    // this overlay is a bonus, not a dependency of the actual turn-by-turn experience.
  }
}

export async function updateLiveActivity(update: LiveActivityUpdate): Promise<void> {
  if (!native) return;
  try {
    await native.updateActivity(
      update.instruction,
      update.maneuverSymbol,
      update.distanceText,
      update.etaText,
      update.roadName,
      update.currentSpeedKmh,
      update.speedLimitKmh
    );
  } catch {}
}

export async function endLiveActivity(): Promise<void> {
  if (!native) return;
  try {
    await native.endActivity();
  } catch {}
}
