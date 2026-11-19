import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/services/firebase";

// Owner-only management of the Plate Recognizer credential (a real, paid apiKey from a
// registered account at platerecognizer.com) -- same pattern as revCheckAdmin.ts/
// plateLookupAdmin.ts/fuelPricesAdmin.ts.

export interface PlateRecognizerProviderConfig {
  apiKey: string;
}

export async function getPlateRecognizerProviderConfig(): Promise<PlateRecognizerProviderConfig> {
  const snap = await getDoc(doc(db, "config", "plateRecognizerProvider"));
  const data = snap.data();
  return { apiKey: typeof data?.apiKey === "string" ? data.apiKey : "" };
}

export async function savePlateRecognizerProviderConfig(config: PlateRecognizerProviderConfig): Promise<void> {
  const apiKey = config.apiKey.trim();
  await Promise.all([
    setDoc(doc(db, "config", "plateRecognizerProvider"), { apiKey, updatedAt: serverTimestamp() }),
    setDoc(doc(db, "config", "plateRecognizerStatus"), { enabled: !!apiKey, updatedAt: serverTimestamp() }),
  ]);
}
