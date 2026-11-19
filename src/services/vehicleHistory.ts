import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RevCheckVehicle } from "@/services/revCheck";
import type { PlateLookupVehicle } from "@/services/plateLookup";
import { deleteVehicleThumbnail } from "@/services/vehicleThumbnail";

// Persistent log of vehicles this device has actually seen -- either fully identified by the
// live AI detector (a confirmed, on-device plate read, same confirm logic
// VehicleDetectionScreen already used to decide when to SHOW a plate) or manually looked up via
// the REV check screen. Deliberately keyed by plate text, not detection track id: a track id is
// only ever valid for the single camera session that produced it (speedTracker.ts resets it on
// every screen open), while the plate is the one real, stable identity a vehicle actually has
// across separate sightings/sessions.
export type VehicleHistorySource = "detected" | "manual";

export interface VehicleHistoryEntry {
  plate: string; // normalized: trimmed, uppercased, matches what's shown on screen. May be a
  // synthetic "VIN:<vin>" key when a manual check was run with a VIN but no known plate -- see
  // recordManualCheck.
  state: string | null; // AU state/territory code (utils/auStates.ts) -- only known for a manual entry
  vin: string | null; // real PPSR/NEVDIS searches key on this, never the plate -- see revCheck.ts
  label: "Vehicle" | "Heavy Vehicle";
  lastSpeedKmh: number | null;
  lastSpeedKind: "absolute" | "closing" | null;
  firstSeenAt: number;
  lastSeenAt: number;
  timesSeen: number;
  source: VehicleHistorySource;
  // The last real, paid REV check result for this vehicle, if one has ever completed -- kept so
  // closing the REV check screen (or leaving and coming back later) never loses a result the
  // driver already paid for. Null until a check actually succeeds at least once.
  lastResult: {
    vehicle?: RevCheckVehicle;
    securedInterestCount?: number;
    certificateUrl?: string | null;
    checkedAt: number;
  } | null;
  // Same caching idea as lastResult above, for the separate plate+state lookup (make/model/
  // year/body/etc., see plateLookup.ts) -- kept as its own field since it's a genuinely
  // different data source/result shape that can succeed independently of the VIN-based check.
  lastPlateLookup: {
    vehicle?: PlateLookupVehicle;
    checkedAt: number;
  } | null;
  // A real, persistent local JPEG (see services/vehicleThumbnail.ts) cropped from the same
  // photo the on-device plate OCR already captured -- null whenever no thumbnail was available
  // to save (e.g. a manual entry with no live camera capture behind it at all) or the crop
  // itself failed; never a placeholder image.
  thumbnailUri: string | null;
}

const STORAGE_KEY = "@trackline/vehicleHistory";
// Caps total stored entries -- the oldest-by-lastSeenAt entries are dropped first once over the
// cap, same pattern as searchHistory.ts's MAX_HISTORY_ENTRIES.
const MAX_HISTORY_ENTRIES = 200;

function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/\s+/g, "");
}

export async function getVehicleHistory(): Promise<VehicleHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as VehicleHistoryEntry[]).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  } catch {
    // A corrupted/unparsable cache should never break the detection screen or REV check flow --
    // just behave as if there was no history yet.
    return [];
  }
}

async function writeHistory(entries: VehicleHistoryEntry[]): Promise<VehicleHistoryEntry[]> {
  const sorted = entries.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const kept = sorted.slice(0, MAX_HISTORY_ENTRIES);
  // Entries trimmed off the cap are gone from the stored list for good -- their thumbnail
  // files (if any) would otherwise leak on disk forever with nothing left referencing them.
  for (const dropped of sorted.slice(MAX_HISTORY_ENTRIES)) deleteVehicleThumbnail(dropped.thumbnailUri);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  return kept;
}

/** Called the instant a live detection's plate read is actually confirmed (see
 *  VehicleDetectionScreen's PLATE_CONFIRM_COUNT logic) -- automatically records/updates that
 *  vehicle's history entry with no user action needed, per the explicit "fully detected and
 *  automatically saved" request. Merges into the SAME entry on a repeat sighting (same plate,
 *  this session or a past one) rather than creating a duplicate row. */
export async function upsertDetectedVehicle(
  rawPlate: string,
  info: { label: "Vehicle" | "Heavy Vehicle"; speedKmh: number | null; speedKind: "absolute" | "closing" | null },
  // Optional -- a real, persistent JPEG already saved by services/vehicleThumbnail.ts before
  // this is called. Only replaces an existing entry's thumbnail when a NEW one is actually
  // provided (a re-sighting that, for whatever reason, didn't produce a fresh thumbnail keeps
  // whatever real image it already had rather than getting wiped back to nothing).
  thumbnailUri: string | null = null
): Promise<VehicleHistoryEntry[]> {
  const plate = normalizePlate(rawPlate);
  if (!plate) return getVehicleHistory();
  const current = await getVehicleHistory();
  const now = Date.now();
  const existingIndex = current.findIndex((e) => e.plate === plate);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    // A repeat sighting that DID produce a fresh thumbnail replaces the old one -- the old file
    // is now orphaned (nothing else references it), so it's deleted here rather than silently
    // leaked on disk forever.
    if (thumbnailUri && existing.thumbnailUri && thumbnailUri !== existing.thumbnailUri) {
      deleteVehicleThumbnail(existing.thumbnailUri);
    }
    current[existingIndex] = {
      ...existing,
      label: info.label,
      lastSpeedKmh: info.speedKmh,
      lastSpeedKind: info.speedKind,
      lastSeenAt: now,
      timesSeen: existing.timesSeen + 1,
      thumbnailUri: thumbnailUri ?? existing.thumbnailUri,
    };
  } else {
    current.push({
      plate,
      state: null,
      vin: null,
      label: info.label,
      lastSpeedKmh: info.speedKmh,
      lastSpeedKind: info.speedKind,
      firstSeenAt: now,
      lastSeenAt: now,
      timesSeen: 1,
      source: "detected",
      lastResult: null,
      lastPlateLookup: null,
      thumbnailUri,
    });
  }
  return writeHistory(current);
}

/** Called when a REV check is actually started from the manual plate-entry screen -- records the
 *  plate (and its selected state, since a manual entry knows one and a live detection doesn't)
 *  so it shows up in history the same as an auto-detected vehicle would. Never overwrites an
 *  existing "detected" entry's richer state (label/speed) with blanks, just refreshes state and
 *  bumps the seen count/timestamp. A real PPSR/NEVDIS search (see revCheck.ts) always keys on
 *  VIN, not plate -- so when the driver only typed a VIN and no known plate, this falls back to
 *  a synthetic "VIN:<vin>" key just so the check still shows up in history at all. */
export async function recordManualCheck(
  rawPlate: string,
  state: string | null,
  vin: string | null = null
): Promise<VehicleHistoryEntry[]> {
  const normalizedVin = vin ? vin.trim().toUpperCase() : null;
  const plate = normalizePlate(rawPlate) || (normalizedVin ? `VIN:${normalizedVin}` : "");
  if (!plate) return getVehicleHistory();
  const current = await getVehicleHistory();
  const now = Date.now();
  const existingIndex = current.findIndex((e) => e.plate === plate);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    current[existingIndex] = {
      ...existing,
      state: state ?? existing.state,
      vin: normalizedVin ?? existing.vin,
      lastSeenAt: now,
      timesSeen: existing.timesSeen + 1,
    };
  } else {
    current.push({
      plate,
      state,
      vin: normalizedVin,
      label: "Vehicle",
      lastSpeedKmh: null,
      lastSpeedKind: null,
      firstSeenAt: now,
      lastSeenAt: now,
      timesSeen: 1,
      source: "manual",
      lastResult: null,
      lastPlateLookup: null,
      // A manual check has no live camera capture behind it to crop a thumbnail from.
      thumbnailUri: null,
    });
  }
  return writeHistory(current);
}

/** Called the instant a real REV check actually completes successfully -- attaches the result to
 *  the SAME entry recordManualCheck just created/refreshed moments earlier (same plate/VIN key
 *  derivation), so re-opening this vehicle later (from history, or from a fresh AI detection of
 *  the same plate) shows the last real result immediately instead of nothing. Never invents an
 *  entry to attach to -- if one somehow isn't there, this is a silent no-op rather than writing
 *  a partial/inconsistent record. */
export async function recordRevCheckResult(
  rawPlate: string,
  vin: string | null,
  result: { vehicle?: RevCheckVehicle; securedInterestCount?: number; certificateUrl?: string | null }
): Promise<VehicleHistoryEntry[]> {
  const normalizedVin = vin ? vin.trim().toUpperCase() : null;
  const plate = normalizePlate(rawPlate) || (normalizedVin ? `VIN:${normalizedVin}` : "");
  if (!plate) return getVehicleHistory();
  const current = await getVehicleHistory();
  const existingIndex = current.findIndex((e) => e.plate === plate);
  if (existingIndex < 0) return current;
  current[existingIndex] = {
    ...current[existingIndex],
    lastResult: { ...result, checkedAt: Date.now() },
  };
  return writeHistory(current);
}

/** Same idea/timing as recordRevCheckResult above, for the separate plate+state lookup. Called
 *  the instant that real lookup succeeds so re-opening this vehicle later shows the last real
 *  model/spec data immediately -- this one isn't gated behind the paid IAP purchase the way the
 *  VIN check is, but caching it anyway means one less real network call on every re-open. */
export async function recordPlateLookupResult(
  rawPlate: string,
  result: { vehicle?: PlateLookupVehicle }
): Promise<VehicleHistoryEntry[]> {
  const plate = normalizePlate(rawPlate);
  if (!plate) return getVehicleHistory();
  const current = await getVehicleHistory();
  const existingIndex = current.findIndex((e) => e.plate === plate);
  if (existingIndex < 0) return current;
  current[existingIndex] = {
    ...current[existingIndex],
    lastPlateLookup: { ...result, checkedAt: Date.now() },
  };
  return writeHistory(current);
}

export async function removeVehicleHistoryEntry(rawPlate: string): Promise<VehicleHistoryEntry[]> {
  const plate = normalizePlate(rawPlate);
  const current = await getVehicleHistory();
  const removed = current.find((e) => e.plate === plate);
  if (removed) deleteVehicleThumbnail(removed.thumbnailUri);
  return writeHistory(current.filter((e) => e.plate !== plate));
}

export async function clearVehicleHistory(): Promise<void> {
  const current = await getVehicleHistory();
  for (const entry of current) deleteVehicleThumbnail(entry.thumbnailUri);
  await AsyncStorage.removeItem(STORAGE_KEY);
}
