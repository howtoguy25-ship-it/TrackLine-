// Driver-reported fuel prices (gap item 18), the app side. Official prices (FuelCheck, then
// Google) always win; a driver price fills a gap only once the server has 3 drivers agreeing
// within 2 cents in 24 h (firebase/functions/fuelUserPricesCore.js). Reporting is for the
// station you're at (within 500 m). Tested in __tests__/gap/fuelEv.test.tsx.
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/services/firebase";
import { callFn } from "@/services/callable";
import { withTimeout } from "@/utils/withTimeout";
import type { FuelPrice, FuelTypeKey, NearbyResult } from "@/places/nearbyNew";
import type { LatLng } from "@/utils/polyline";

export const REPORT_WITHIN_M = 500;
export const DRIVER_PRICE_TIMEOUT_MS = 10_000;

export function driverPriceDocId(placeId: string, fuelType: FuelTypeKey): string {
  return `${placeId}__${fuelType}`;
}

interface Confirmed {
  cents: number;
  drivers: number;
  atMs: number;
}

/** Confirmed driver prices for these stations (missing / unconfirmed ones are left out). */
export async function fetchDriverPrices(placeIds: string[], fuelType: FuelTypeKey): Promise<Map<string, FuelPrice>> {
  const out = new Map<string, FuelPrice>();
  if (fuelType === "ev") return out;
  const snaps = await withTimeout(Promise.all(placeIds.slice(0, 30).map((id) => getDoc(doc(db, "fuelUserPrices", driverPriceDocId(id, fuelType))))), DRIVER_PRICE_TIMEOUT_MS, "Driver prices");
  snaps.forEach((s, i) => {
    const c = s.exists() ? (s.data() as { confirmed?: Confirmed | null }).confirmed : null;
    if (c && typeof c.cents === "number" && Date.now() - c.atMs <= 24 * 3600_000) out.set(placeIds[i], { centsPerLitre: c.cents, updatedMs: c.atMs, source: "Drivers", drivers: c.drivers });
  });
  return out;
}

/** Official prices first; driver prices only where there's no official one. */
export function withDriverPrices(official: Map<string, FuelPrice>, drivers: Map<string, FuelPrice>): Map<string, FuelPrice> {
  const out = new Map(official);
  for (const [id, p] of drivers) if (!out.has(id)) out.set(id, p);
  return out;
}

/** The station you're at (nearest, within 500 m), if any. */
export function stationHere(results: NearbyResult[]): NearbyResult | null {
  const near = [...results].sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  return near && near.distanceMeters <= REPORT_WITHIN_M ? near : null;
}

/** "189.9" / "189,9" / "1.899" (dollars) -> cents per litre, or null. */
export function parsePriceInput(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  const cents = v < 10 ? v * 100 : v;
  return cents >= 80 && cents <= 400 ? Math.round(cents * 10) / 10 : null;
}

export interface ReportAnswer {
  confirmed: Confirmed | null;
  reports: number;
  needed: number;
}

export function reportFuelPrice(station: NearbyResult, fuelType: FuelTypeKey, cents: number, me: LatLng): Promise<ReportAnswer> {
  return callFn<ReportAnswer>("reportFuelPrice", {
    placeId: station.placeId,
    name: station.name,
    fuelType,
    cents,
    lat: me.latitude,
    lng: me.longitude,
    stationLat: station.location.latitude,
    stationLng: station.location.longitude,
  });
}

export function reportAnswerText(a: ReportAnswer, fuelLabel: string): string {
  if (a.confirmed) return `Thanks — ${fuelLabel} here is now ${a.confirmed.cents.toFixed(1)}¢, confirmed by ${a.confirmed.drivers} drivers.`;
  return `Thanks — it shows once ${a.needed} drivers report the same price (${a.reports} so far today).`;
}
