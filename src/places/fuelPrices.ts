// Live petrol prices for the stations in the list. NSW uses FuelCheck through our Cloud Function
// (the key never leaves the server); anywhere Google returns prices with the station
// (fuelOptions), those are used. A station with no reported price shows no price, never a guess.
import { callFn } from "@/services/callable";
import { recordService } from "@/diagnostics/diagnostics";
import { distanceKm } from "@/utils/geo";
import type { LatLng } from "@/utils/polyline";
import { FUEL_TYPES, type FuelPrice, type FuelTypeKey, type NearbyResult } from "@/places/nearbyNew";

export interface FuelCheckStation {
  code: string;
  name: string;
  brand: string;
  address: string;
  lat: number;
  lng: number;
  centsPerLitre: number;
  updatedMs: number | null;
}

export interface FuelCheckAnswer {
  configured: boolean;
  stations: FuelCheckStation[];
  error?: string;
}

/** A FuelCheck station counts as the same place as a Google result when within this distance. */
export const MATCH_METERS = 120;

export async function fetchFuelCheck(center: LatLng, fuelType: FuelTypeKey, radiusKm: number): Promise<FuelCheckAnswer> {
  const code = FUEL_TYPES.find((f) => f.key === fuelType)?.fuelCheck;
  if (!code) return { configured: true, stations: [] };
  const started = Date.now();
  try {
    const answer = await callFn<FuelCheckAnswer>("fuelPricesNearby", { lat: center.latitude, lng: center.longitude, fuelType: code, radiusKm });
    recordService("fuel", {
      host: "FuelCheck (via TrackLine server)",
      status: null,
      ok: answer.configured && !answer.error,
      message: answer.error ?? (answer.configured ? `${answer.stations.length} prices in ${Date.now() - started} ms` : "Not set up (no FuelCheck key on the server)"),
    });
    return answer;
  } catch (err) {
    recordService("fuel", { host: "FuelCheck (via TrackLine server)", status: null, ok: false, message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** The price to show per Google result: FuelCheck when a station matches, else Google's own. */
export function pricesFor(results: NearbyResult[], fuelType: FuelTypeKey, fuelCheck: FuelCheckStation[]): Map<string, FuelPrice> {
  const out = new Map<string, FuelPrice>();
  for (const r of results) {
    let best: FuelCheckStation | null = null;
    let bestD = Infinity;
    for (const s of fuelCheck) {
      const d = distanceKm(r.location.latitude, r.location.longitude, s.lat, s.lng) * 1000;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best && bestD <= MATCH_METERS) out.set(r.placeId, { centsPerLitre: best.centsPerLitre, updatedMs: best.updatedMs, source: "FuelCheck" });
    else if (r.googleFuel[fuelType]) out.set(r.placeId, r.googleFuel[fuelType] as FuelPrice);
  }
  return out;
}
