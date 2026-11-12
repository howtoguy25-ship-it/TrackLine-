import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "@firebase/functions";
import { db, functions } from "@/services/firebase";

// Real vehicle-SPECS lookup by plate + state, via RegCheck's CheckAustralia (the service
// carregistrationapi.com.au resells) -- see runPlateLookup in firebase/functions/index.js for
// the actual HTTP call and why this is a genuinely different, additive data source from
// revCheck.ts's VIN-only PPSR check (stolen/written-off/finance/odometer stay PPSR-only; this
// only ever returns make/model/year/body/engine/etc., confirmed from the provider's own WSDL).

export interface PlateLookupVehicle {
  make: string | null;
  model: string | null;
  year: string | null;
  bodyType: string | null;
  engineSize: string | null;
  transmission: string | null;
  fuelType: string | null;
  numberOfDoors: string | null;
  numberOfSeats: string | null;
  driverSide: string | null;
}

export interface PlateLookupResult {
  outcome: "not_connected" | "error" | "success";
  message: string;
  vehicle?: PlateLookupVehicle;
}

// Live, same reasoning as revCheck.ts's subscribeRevCheckProviderStatus -- a driver already on
// this screen sees the moment the owner connects (or disconnects) a real provider.
export function subscribePlateLookupProviderStatus(onChange: (enabled: boolean) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "config", "plateLookupStatus"),
    (snap) => onChange(snap.exists() && snap.data()?.enabled === true),
    () => onChange(false)
  );
}

const runPlateLookupCallable = httpsCallable<{ plate: string; state: string }, PlateLookupResult>(
  functions,
  "runPlateLookup"
);

export async function runPlateLookup(plate: string, state: string): Promise<PlateLookupResult> {
  const trimmedPlate = plate.trim().toUpperCase();
  const trimmedState = state.trim().toUpperCase();
  try {
    const res = await runPlateLookupCallable({ plate: trimmedPlate, state: trimmedState });
    return res.data;
  } catch (err) {
    return {
      outcome: "error",
      message: err instanceof Error ? err.message : "Couldn't reach the plate lookup service -- check your connection.",
    };
  }
}
