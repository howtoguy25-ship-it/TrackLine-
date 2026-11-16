// The app's side of the vehicle full check: three callables (firebase/functions/index.js) and
// live reads of the user's own reports (users/{uid}/vehicleChecks, written only by the server).
import { collection, doc, limit, onSnapshot, orderBy, query, type Unsubscribe } from "firebase/firestore";
// See firebase.ts for why this isn't the plain "firebase/functions" wrapper.
import { httpsCallable } from "@firebase/functions";
import { db, functions } from "@/services/firebase";
import type { SectionKey, VehicleReport } from "@/vehicleCheck/model";

export interface VehicleCheckInfo {
  available: boolean;
  /** Owner accounts only: why it isn't on sale, and each section's provider status. */
  missing?: string[] | null;
  sections?: Record<string, { provider: string; status: string }> | null;
  /** config/vehicleCheck enabled. */
  enabled?: boolean;
  productId: string;
  priceAud: number;
  countries: string[];
  credits: number;
}

export type RunOutcome =
  | { outcome: "complete" | "partial" | "already_used"; reportId: string }
  | { outcome: "credited"; reportId: string; message: string }
  | { outcome: "invalid"; reason: string }
  | { outcome: "invalid_purchase" | "no_credit" | "not_available"; message: string };

export async function getVehicleCheckInfo(): Promise<VehicleCheckInfo> {
  const res = await httpsCallable(functions, "getVehicleCheckInfo")({});
  return res.data as VehicleCheckInfo;
}

export interface RunInput {
  country: string;
  plate?: string;
  state?: string;
  vin?: string;
  requestId: string;
}

/** Pays with a store purchase (verified on the server before anything is looked up). */
export async function runPaidCheck(input: RunInput, platform: "ios" | "android", purchaseToken: string, productId: string): Promise<RunOutcome> {
  const res = await httpsCallable(functions, "runVehicleCheck", { timeout: 200_000 })({ ...input, platform, purchaseToken, productId });
  return res.data as RunOutcome;
}

/** Pays with a free re-check credit. */
export async function runCreditCheck(input: RunInput): Promise<RunOutcome> {
  const res = await httpsCallable(functions, "runVehicleCheck", { timeout: 200_000 })({ ...input, useCredit: true });
  return res.data as RunOutcome;
}

export async function retrySection(reportId: string, section: SectionKey): Promise<{ outcome: string; message?: string }> {
  const res = await httpsCallable(functions, "retryVehicleCheckSection", { timeout: 150_000 })({ reportId, section });
  return res.data as { outcome: string; message?: string };
}

export function subscribeReport(uid: string, reportId: string, onChange: (r: VehicleReport | null) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "users", uid, "vehicleChecks", reportId),
    (snap) => onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as VehicleReport) : null),
    () => onChange(null)
  );
}

export function subscribeMyChecks(uid: string, onChange: (list: VehicleReport[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, "users", uid, "vehicleChecks"), orderBy("createdAt", "desc"), limit(50)),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VehicleReport)),
    () => onChange([])
  );
}

/** A report id the app picks, so it can watch the report fill in from the first section. */
export function newRequestId(): string {
  const bytes = new Uint8Array(12);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
