// "Listening on": where the phone is playing audio right now, and a way to change it.
//
// Both halves are the operating system's own. The route is read from iOS's audio session /
// Android's audio manager, and "change it" opens the system's own output picker -- this app
// never draws a device list of its own or guesses a name.
//
// The native side only exists in a build made after this module was added (never in Expo Go),
// so it's loaded inside a try: on an older build the functions below report "not available"
// and the Sound sheet simply leaves the row out.

export type AudioRouteType =
  | "speaker" // the phone's own loudspeaker
  | "phone" // the earpiece
  | "headphones" // wired
  | "bluetooth"
  | "car" // CarPlay / a car's wired audio
  | "airplay"
  | "usb"
  | "hdmi"
  | "other";

export interface AudioRoute {
  /** The device's own name where it has one ("Sam's AirPods"); empty for the built-in speaker. */
  name: string;
  type: AudioRouteType;
}

interface NativeAudioRouteModule {
  getCurrentRoute(): Promise<{ name: string; type: string }>;
  showRoutePicker(): Promise<boolean>;
}

let native: NativeAudioRouteModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require("expo-modules-core").requireNativeModule("AudioRoute");
} catch {
  native = null;
}

const KNOWN_TYPES: AudioRouteType[] = ["speaker", "phone", "headphones", "bluetooth", "car", "airplay", "usb", "hdmi"];

export const isAudioRouteAvailable = native !== null;

/** The current output, or null when it can't be read (older build, or the system wouldn't say). */
export async function getAudioRoute(): Promise<AudioRoute | null> {
  if (!native) return null;
  try {
    const route = await native.getCurrentRoute();
    const type = (KNOWN_TYPES as string[]).includes(route.type) ? (route.type as AudioRouteType) : "other";
    return { name: typeof route.name === "string" ? route.name.trim() : "", type };
  } catch {
    return null;
  }
}

/**
 * Opens the system's audio output picker. Resolves false if nothing could be opened.
 *
 * iOS shows its standard route picker. Android 14+ shows the system output switcher; earlier
 * Android versions have no public picker to open, so Bluetooth settings is opened instead --
 * the place a driver would go to connect the car or a headset.
 */
export async function showAudioRoutePicker(): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.showRoutePicker()) === true;
  } catch {
    return false;
  }
}

/** How a route reads in the Sound sheet. */
export function describeAudioRoute(route: AudioRoute, platformOS: string): string {
  const fallback: Record<AudioRouteType, string> = {
    speaker: platformOS === "ios" ? "iPhone speaker" : "Phone speaker",
    phone: "Phone earpiece",
    headphones: "Headphones",
    bluetooth: "Bluetooth",
    car: "Car",
    airplay: "AirPlay",
    usb: "USB audio",
    hdmi: "HDMI",
    other: "Another device",
  };
  // The built-in outputs report a generic or model name ("Speaker", "Pixel 8"); the plain label
  // is clearer. Anything external is known by its own name when it gives one.
  if (route.type === "speaker" || route.type === "phone" || !route.name) return fallback[route.type];
  return route.name;
}
