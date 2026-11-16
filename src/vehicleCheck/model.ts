// The vehicle full check as the app sees it: what a report looks like (written only by the
// runVehicleCheck Cloud Function -- firebase/functions/vehicleCheck), input validation that
// mirrors the server's, and the wording. Plain logic, unit-tested in __tests__/vehicleCheck.test.ts.

import { AU_STATES } from "@/utils/auStates";

/** One consumable per price tier; the server says which is current (config/vehicleCheck priceTier). */
export const FULL_CHECK_PRODUCT_ID = "full_check";
export const FULL_CHECK_PRODUCT_IDS = ["full_check", "full_check_2499"] as const;
export const FULL_CHECK_BLURB = "Full history report: written-off, stolen, finance owing, odometer history, rego and VIN.";
export const FOOTER_ADVICE = "Always inspect the vehicle and get a mechanic's check.";

export type Grade = "green" | "amber" | "red";
export type SectionKey = "vehicle" | "registration" | "writtenOff" | "stolen" | "ppsr" | "odometer" | "recalls";

export const SECTION_ORDER: SectionKey[] = ["vehicle", "registration", "writtenOff", "stolen", "ppsr", "odometer", "recalls"];
export const SECTION_LABELS: Record<SectionKey, string> = {
  vehicle: "Vehicle",
  registration: "Registration",
  writtenOff: "Written off",
  stolen: "Stolen",
  ppsr: "Finance owing (PPSR)",
  odometer: "Odometer history",
  recalls: "Recalls",
};

export interface OdometerReading {
  date: string;
  km: number;
  source?: string | null;
}

export interface SectionData {
  vehicle: { make: string | null; model: string | null; year: string | null; body: string | null; colour: string | null; engine: string | null; fuel?: string | null; transmission?: string | null; vin: string | null };
  registration: { plate: string | null; state: string | null; status: string | null; expiry: string | null };
  writtenOff: { writtenOff: boolean; records: { category: "statutory" | "repairable" | "unknown"; incident: string | null; reason: string | null; date: string | null; jurisdiction: string | null }[] };
  stolen: { stolen: boolean; records: { type: string | null; jurisdiction: string | null; reportedDate: string | null }[] };
  ppsr: { securedInterests: number; certificateUrl: string | null };
  odometer: { readings: OdometerReading[] };
  recalls: { recalls: unknown[] };
}

export type Section<K extends SectionKey = SectionKey> =
  | { status: "loading" }
  | { status: "ok"; grade: Grade; summary: string; source: string; asAt: string; data: SectionData[K] }
  | { status: "failed"; error: string; notFound?: boolean; retries?: number }
  // BLOCKED: the provider for this section has no key yet, or its adapter isn't built.
  | { status: "blocked"; reason: string };

export interface VehicleReport {
  id: string;
  query: { kind: "plate" | "vin"; plate: string | null; state: string | null; vin: string | null };
  queryKey: string;
  status: "running" | "complete" | "partial" | "credited";
  notFound?: boolean;
  createdAt: number;
  providers?: string[];
  sections: Partial<{ [K in SectionKey]: Section<K> }>;
  sample?: boolean;
}

// ---- input -----------------------------------------------------------------------------------

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const PLATE_RE = /^[A-Z0-9]{1,9}$/;

export function normaliseVin(vin: string): string {
  return vin.replace(/[\s-]/g, "").toUpperCase();
}
export function normalisePlate(plate: string): string {
  return plate.replace(/[\s.-]/g, "").toUpperCase();
}

/** Why a VIN isn't valid yet, or null when it is. Same rule as the server (ISO 3779). */
export function vinProblem(raw: string): string | null {
  const vin = normaliseVin(raw);
  if (!vin) return "Enter the VIN";
  if (/[IOQ]/.test(vin)) return "VINs never use the letters I, O or Q";
  if (/[^A-Z0-9]/.test(vin)) return "Letters and numbers only";
  if (vin.length !== 17) return `A VIN has 17 characters (this has ${vin.length})`;
  return VIN_RE.test(vin) ? null : "That isn't a valid VIN";
}

export function plateProblem(raw: string, state: string | null): string | null {
  const plate = normalisePlate(raw);
  if (!plate) return "Enter the number plate";
  if (!PLATE_RE.test(plate)) return "Letters and numbers only, up to 9";
  if (!state || !AU_STATES.some((s) => s.code === state)) return "Choose the state";
  return null;
}

/** The same key the server uses, so "you checked this today" matches exactly. */
export function queryKeyFor(input: { kind: "plate"; plate: string; state: string } | { kind: "vin"; vin: string }): string {
  return input.kind === "vin" ? `AU:vin:${normaliseVin(input.vin)}` : `AU:plate:${input.state}:${normalisePlate(input.plate)}`;
}

/**
 * Is this point in Australia? A box around the mainland and Tasmania that leaves out Timor and
 * Rote (north of the Kimberley, whose northern tip is ~13.7°S) and Papua New Guinea (north of
 * Cape York's tip, 10.69°S). Used before classifyAuRegion, which assumes the point is in Australia.
 */
export function isInAustralia(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -44 || lat > -10.5 || lng < 112.5 || lng > 154) return false;
  if (lng < 129 && lat > -13.5) return false;
  return true;
}

/**
 * Where the driver is: their live position when it's inside Australia (with the state), else the
 * phone's region setting. Australia only for now -- anything else is "not available yet".
 */
export function detectCountry(auState: string | null, localeTag: string | null | undefined): { country: string | null; state: string | null } {
  if (auState) return { country: "AU", state: auState };
  const region = (localeTag || "").split(/[-_]/)[1]?.toUpperCase() ?? null;
  return { country: region && /^[A-Z]{2}$/.test(region) ? region : null, state: null };
}

export const SUPPORTED_COUNTRIES = ["AU"];

/** A report for this vehicle from the last 24 hours, so nobody pays twice for the same car. */
export function recentReportFor(reports: VehicleReport[], queryKey: string, now: number, hours = 24): VehicleReport | null {
  return reports.find((r) => r.queryKey === queryKey && r.status !== "credited" && now - r.createdAt < hours * 3600_000) ?? null;
}

export function priceLabel(storePrice: string | null | undefined, priceAud: number | null | undefined): string {
  if (storePrice) return storePrice;
  return `$${(priceAud ?? 19.99).toFixed(2)}`;
}

export function footerText(providers: string[] | undefined): string {
  const list = (providers ?? []).filter(Boolean);
  return list.length ? `Information supplied by ${list.join(", ")}. ${FOOTER_ADVICE}` : FOOTER_ADVICE;
}

export function reportTitle(r: Pick<VehicleReport, "query" | "sections">): string {
  const v = r.sections.vehicle;
  const name = v?.status === "ok" ? [v.data.year, v.data.make, v.data.model].filter(Boolean).join(" ") : "";
  const id = r.query.kind === "vin" ? r.query.vin : `${r.query.plate} ${r.query.state}`;
  return name ? `${name} · ${id}` : id ?? "Vehicle";
}

/** "2 of 7 sections loaded" while running. */
export function progress(r: Pick<VehicleReport, "sections">): { done: number; total: number } {
  const keys = SECTION_ORDER.filter((k) => k !== "recalls" || r.sections.recalls);
  return { done: keys.filter((k) => r.sections[k] && r.sections[k]!.status !== "loading").length, total: keys.length };
}

export function overallGrade(r: Pick<VehicleReport, "sections">): Grade | null {
  const grades = SECTION_ORDER.map((k) => r.sections[k]).flatMap((s) => (s && s.status === "ok" ? [s.grade] : []));
  if (grades.includes("red")) return "red";
  if (grades.includes("amber")) return "amber";
  return grades.length ? "green" : null;
}
