import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/services/firebase";

// Owner-only management of the NSW FuelCheck credential (apiKey + apiSecret, from a real
// registered account at api.nsw.gov.au) -- same pattern as revCheckAdmin.ts/plateLookupAdmin.ts.

export interface FuelCheckProviderConfig {
  apiKey: string;
  apiSecret: string;
}

export async function getFuelCheckProviderConfig(): Promise<FuelCheckProviderConfig> {
  const snap = await getDoc(doc(db, "config", "fuelCheckProvider"));
  const data = snap.data();
  return {
    apiKey: typeof data?.apiKey === "string" ? data.apiKey : "",
    apiSecret: typeof data?.apiSecret === "string" ? data.apiSecret : "",
  };
}

export async function saveFuelCheckProviderConfig(config: FuelCheckProviderConfig): Promise<void> {
  const apiKey = config.apiKey.trim();
  const apiSecret = config.apiSecret.trim();
  await Promise.all([
    setDoc(doc(db, "config", "fuelCheckProvider"), { apiKey, apiSecret, updatedAt: serverTimestamp() }),
    setDoc(doc(db, "config", "fuelCheckStatus"), { enabled: !!(apiKey && apiSecret), updatedAt: serverTimestamp() }),
  ]);
}
