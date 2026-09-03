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
  createdAt: number; // ms epoch
  expiresAt: number; // ms epoch
  confirmCount: number;
  // "Not here" vote count -- mirrors confirmCount exactly (see services/alerts.ts's denyAlert),
  // for the automatic proximity "Still here? / Not here" prompt (MapScreen's AlertStillHereCard).
  // Purely a counter, same as confirmCount -- nothing currently reads it to auto-expire an alert.
  denyCount: number;
  // Map of uid -> the ms timestamp they hid this alert -- self-only (never affects any other
  // user's own view) and time-boxed, per explicit request: services/alerts.ts's
  // isHiddenForUser treats an entry older than its own HIDE_DURATION_MS (1 hour) as expired, so
  // the alert reappears for that one user again unless they hide it again. Was a plain uid[]
  // (permanent hide) before this.
  hiddenBy: Record<string, number>;
  // Optional, up to 7 words -- see commentFilter.ts for the word cap and the profanity check
  // both the client and reportAlert itself enforce before this is ever written. undefined when
  // the reporter didn't add one (the overwhelming majority of alerts, same as before this
  // existed) -- never an empty string.
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

// MaterialCommunityIcons names (used by AlertMarker / AlertReportSheet via AlertTypeGlyph). Same
// colored-circle pin style as Waze's own "Report an Incident" sheet (a recognizable, at-a-glance
// convention for this kind of alert), but drawn from a completely different icon set/art style,
// not Waze's actual icon assets -- similar in spirit, not a copy.
//
// camera: "cctv" -- matches osmMarkerStyle.ts's SPEED_CAMERA_MARKER exactly, so this alert type
// and the mapped OSM speed-camera layer read as the same real-world thing (a camera), not two
// different symbols (this used to be "radar", an abstract set of rings that didn't actually look
// like a camera at all).
//
// crash: unused for rendering -- AlertTypeGlyph special-cases "crash" to MaterialIcons'
// "car-crash" (a different glyph set from this one, with a real dedicated crash icon
// MaterialCommunityIcons doesn't have). Kept here only because AlertType requires every key.
export const ALERT_ICONS: Record<AlertType, string> = {
  police: "police-badge",
  emergency_vehicle: "ambulance",
  hazard: "alert",
  camera: "cctv",
  crash: "car-brake-alert",
  traffic_light: "traffic-light",
};

export const ALERT_COLORS: Record<AlertType, string> = {
  police: "#2563EB",
  emergency_vehicle: "#DC2626",
  hazard: "#F59E0B",
  camera: "#7C3AED",
  crash: "#EA580C",
  traffic_light: "#0D9488",
};
