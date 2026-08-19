import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "@firebase/functions";
import { db, functions } from "@/services/firebase";
import type { LatLng } from "@/utils/polyline";
import { withTimeout } from "@/utils/withTimeout";

// Real, confirmed bug fix -- see withTimeout.ts's own comment. getFuelPrices' own server side
// already does two sequential real network calls of its own (an OAuth exchange, then the real
// FuelCheck prices request) before this client-side callable even resolves, so this needs more
// headroom than a single plain fetch -- long enough to let that legitimately complete, short
// enough that a genuinely hung request still turns into a clear, retryable error.
const FUEL_PRICES_TIMEOUT_MS = 18000;

// Real, live fuel prices via the NSW Government's own FuelCheck API -- see getFuelPrices in
// firebase/functions/index.js for the real endpoint/auth this calls. NSW-only today (no
// equivalent official live-price API found for any other state) -- see FuelStationsSheet's own
// honest "not available in your state" handling for everywhere else.

export interface FuelStation {
  stationId: string;
  name: string | null;
  brand: string | null;
  address: string | null;
  location: { latitude: number | null; longitude: number | null };
  fuelType: string;
  priceCents: number | null;
  lastUpdated: string | null;
}

export interface FuelPriceResult {
  outcome: "not_connected" | "error" | "success";
  message: string;
  fuelType?: string;
  stations?: FuelStation[];
}

export function subscribeFuelCheckProviderStatus(onChange: (enabled: boolean) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "config", "fuelCheckStatus"),
    (snap) => onChange(snap.exists() && snap.data()?.enabled === true),
    () => onChange(false)
  );
}

const getFuelPricesCallable = httpsCallable<{ latitude: number; longitude: number; radiusKm: number }, FuelPriceResult>(
  functions,
  "getFuelPrices"
);

export async function getFuelPrices(location: LatLng, radiusKm = 5): Promise<FuelPriceResult> {
  try {
    const res = await withTimeout(
      getFuelPricesCallable({
        latitude: location.latitude,
        longitude: location.longitude,
        radiusKm,
      }),
      FUEL_PRICES_TIMEOUT_MS,
      "getFuelPrices"
    );
    return res.data;
  } catch (err) {
    return {
      outcome: "error",
      message: err instanceof Error ? err.message : "Couldn't reach the fuel price service -- check your connection.",
    };
  }
}
