// What Settings > About > Diagnostics shows: the real state of the map and routing services in
// this app session, recorded where it happens (map style load, each Directions call). In memory
// only -- nothing here is stored or sent anywhere.

export type RouteProvider = "mapbox" | "google";

export interface DirectionsRecord {
  provider: RouteProvider;
  /** HTTP status, or null when no answer came back (offline / timeout / no key). */
  status: number | null;
  ok: boolean;
  /** The same words the driver saw, e.g. "Map service rejected the key". */
  message: string;
  atMs: number;
}

export interface MapStyleRecord {
  loaded: boolean;
  error: string | null;
  atMs: number;
}

interface State {
  mapStyle: MapStyleRecord | null;
  directions: Record<string, DirectionsRecord>;
}

let state: State = { mapStyle: null, directions: {} };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function recordMapStyle(loaded: boolean, error: string | null = null, nowMs = Date.now()): void {
  state = { ...state, mapStyle: { loaded, error, atMs: nowMs } };
  emit();
}

/** `key` is the mode ("drive", "bike", ...) or a purpose ("reroute", "navigation"). */
export function recordDirections(key: string, rec: Omit<DirectionsRecord, "atMs">, nowMs = Date.now()): void {
  state = { ...state, directions: { ...state.directions, [key]: { ...rec, atMs: nowMs } } };
  emit();
}

export function getDiagnostics(): State {
  return state;
}

export function subscribeDiagnostics(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only. */
export function resetDiagnostics(): void {
  state = { mapStyle: null, directions: {} };
  emit();
}
