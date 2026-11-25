// Remote config from the owner dashboard (App control): appConfig/current, readable by anyone.
// Pure helpers here; the hook is in useAppConfig.ts.

export type FeatureKey = "vehicleCheck" | "trackys" | "travelModes" | "laneGuidance" | "schoolZones" | "brandBadges" | "ads" | "voiceSearch" | "characterVoices" | "liveTraffic";

export interface FeatureFlag {
  enabled: boolean;
  percent: number;
  countries: string[];
}

export interface RemoteConfig {
  version: number;
  flags: Partial<Record<FeatureKey, FeatureFlag>>;
  minVersion: { ios?: { soft: string | null; force: string | null }; android?: { soft: string | null; force: string | null } };
  maintenance: { mode: "off" | "banner" | "block"; message: string };
  tunables?: Record<string, unknown>;
  whatsNew: { version: string | null; title: string; items: string[] };
}

export const EMPTY_CONFIG: RemoteConfig = {
  version: 0,
  flags: {},
  minVersion: {},
  maintenance: { mode: "off", message: "" },
  whatsNew: { version: null, title: "", items: [] },
};

export function compareVersions(a: string, b: string): number {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Stable 0-99 bucket for a user and feature, so a 20% rollout is the same 20% every launch. */
export function bucket(uid: string, key: string): number {
  let h = 2166136261;
  const s = `${key}:${uid}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/** Is a feature on for this user? A feature the dashboard never mentioned is on. */
export function isFeatureOn(cfg: RemoteConfig | null, key: FeatureKey, who: { uid?: string | null; country?: string | null }): boolean {
  const f = cfg?.flags?.[key];
  if (!f) return true;
  if (f.enabled === false) return false;
  if (f.countries && f.countries.length && !(who.country && f.countries.includes(who.country))) return false;
  const pct = typeof f.percent === "number" ? f.percent : 100;
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  return bucket(who.uid || "anon", key) < pct;
}

/** "force" below the forced version, "soft" below the soft one, else "none". */
export function updateState(cfg: RemoteConfig | null, platform: string, version: string | null): "none" | "soft" | "force" {
  if (!version) return "none";
  const mv = (cfg?.minVersion as Record<string, { soft: string | null; force: string | null } | undefined> | undefined)?.[platform];
  if (!mv) return "none";
  if (mv.force && compareVersions(version, mv.force) < 0) return "force";
  if (mv.soft && compareVersions(version, mv.soft) < 0) return "soft";
  return "none";
}

/** What's New shows once, for this version only, after updating. */
export function shouldShowWhatsNew(cfg: RemoteConfig | null, appVersion: string | null, lastSeen: string | null): boolean {
  const v = cfg?.whatsNew?.version;
  if (!v || !appVersion || !cfg?.whatsNew.items?.length) return false;
  return compareVersions(appVersion, v) === 0 && lastSeen !== v;
}

export function normalise(raw: unknown): RemoteConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RemoteConfig>;
  return {
    version: typeof r.version === "number" ? r.version : 0,
    flags: r.flags && typeof r.flags === "object" ? r.flags : {},
    minVersion: r.minVersion && typeof r.minVersion === "object" ? r.minVersion : {},
    maintenance: r.maintenance && ["off", "banner", "block"].includes(r.maintenance.mode) ? r.maintenance : { mode: "off", message: "" },
    tunables: r.tunables,
    whatsNew: r.whatsNew && Array.isArray(r.whatsNew.items) ? r.whatsNew : { version: null, title: "", items: [] },
  };
}

/** Settings with the dashboard's kill switches applied (what the map should act on). Pure. */
export function remoteGated<S extends { showTrackysOnMap: boolean; schoolZonesShowOnMap: boolean; schoolZonesAlert: boolean; showLiveTraffic: boolean }>(
  s: S,
  on: { trackys: boolean; schoolZones: boolean; liveTraffic: boolean }
): S {
  if (on.trackys && on.schoolZones && on.liveTraffic) return s;
  return {
    ...s,
    showTrackysOnMap: s.showTrackysOnMap && on.trackys,
    schoolZonesShowOnMap: s.schoolZonesShowOnMap && on.schoolZones,
    schoolZonesAlert: s.schoolZonesAlert && on.schoolZones,
    showLiveTraffic: s.showLiveTraffic && on.liveTraffic,
  };
}
