import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/services/firebase";

// Owner-only management of the plate-lookup provider credential (RegCheck/
// carregistrationapi.com.au) -- exact same pattern as revCheckAdmin.ts (that file's own header
// explains why this stays separate from the screen every signed-in user's client uses).
// firestore.rules restricts both documents this touches to the admin email.

export interface PlateLookupProviderConfig {
  username: string;
}

export async function getPlateLookupProviderConfig(): Promise<PlateLookupProviderConfig> {
  const snap = await getDoc(doc(db, "config", "plateLookupProvider"));
  const data = snap.data();
  return { username: typeof data?.username === "string" ? data.username : "" };
}

// Writes the real username AND the public "is a provider actually connected" status flag every
// user's client reads (config/plateLookupStatus, see plateLookup.ts) in the same call, so the
// two documents can never drift out of sync -- this is the one and only place either is written.
export async function savePlateLookupProviderConfig(config: PlateLookupProviderConfig): Promise<void> {
  const username = config.username.trim();
  await Promise.all([
    setDoc(doc(db, "config", "plateLookupProvider"), { username, updatedAt: serverTimestamp() }),
    setDoc(doc(db, "config", "plateLookupStatus"), { enabled: !!username, updatedAt: serverTimestamp() }),
  ]);
}
