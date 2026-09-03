export type AlertType = "police" | "emergency_vehicle" | "hazard" | "camera" | "crash" | "traffic_light";

export interface AlertDoc {
  id: string;
  type: AlertType;
  lat: number;
  lng: number;
  geohash: string;
  // Real Australian state/territory the alert was placed in (see utils/auStates.ts's
  // classifyAuRegion), used to filter alert visibility by region instead of a distance radius.
  // Optional only because alerts written before this field existed lack it -- they age out
  // naturally within their own TTL (45min-24h), no backfill needed.
  region?: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  confirmCount: number;
  // "Not here" vote count -- mirrors confirmCount, same shared schema as the mobile app's own
  // AlertDoc (types/alert.ts) and its automatic proximity "Still here? / Not here" prompt.
  denyCount: number;
  // Map of uid -> the ms timestamp they hid this alert -- self-only, time-boxed (1 hour, see
  // services/alerts.ts's HIDE_DURATION_MS). Shared schema with the mobile app (same Firestore
  // collection/rules) -- was a plain uid[] (permanent hide) before this.
  hiddenBy: Record<string, number>;
  // Optional, up to 7 words -- see utils/commentFilter.ts for the word cap and the profanity
  // check both this client and reportAlert itself enforce before it's ever written. Mirrors
  // mobile's same field on the same shared alerts collection.
  comment?: string;
}

// Speed cameras and traffic lights are community-reported like everything else here —
// there's no licensed real-time government feed for either wired in, so treat these the
// same as any other crowd-sourced alert (can be stale/wrong), not an authoritative source.
export const ALERT_TTL_MS: Record<AlertType, number> = {
  police: 45 * 60 * 1000,
  emergency_vehicle: 45 * 60 * 1000,
  hazard: 2 * 60 * 60 * 1000,
  crash: 2 * 60 * 60 * 1000,
  camera: 24 * 60 * 60 * 1000,
  traffic_light: 2 * 60 * 60 * 1000,
};

export const ALERT_LABELS: Record<AlertType, string> = {
  police: "Police",
  emergency_vehicle: "Emergency Vehicle",
  hazard: "Hazard",
  camera: "Speed Camera",
  crash: "Crash",
  traffic_light: "Traffic Light",
};

export const ALERT_COLORS: Record<AlertType, string> = {
  police: "#2563EB",
  emergency_vehicle: "#DC2626",
  hazard: "#F59E0B",
  camera: "#7C3AED",
  crash: "#EA580C",
  traffic_light: "#0D9488",
};

export const ALERT_EMOJI: Record<AlertType, string> = {
  police: "🚓",
  emergency_vehicle: "🚑",
  hazard: "⚠️",
  camera: "📷",
  // A car + impact, not just a bare "💥" burst -- shows an actual car with a crash in front of
  // it instead of an explosion with no vehicle in the picture at all.
  crash: "🚗💥",
  traffic_light: "🚦",
};
