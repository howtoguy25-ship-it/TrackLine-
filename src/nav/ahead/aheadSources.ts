// Turns what the map already gathers -- "Alert while driving" features (alerts/collectFeatures.ts:
// mapped OSM features, driver reports, Live Traffic NSW, each already filtered by its Settings >
// Reports switch and merged across sources), derived features (crash-prone spots, lane endings)
// and live traffic -- into ahead sources (nav/ahead/aheadFeed.ts). Pure.
import type { ApproachFeature } from "@/alerts/approachAlerts";
import { kindOfItem } from "@/nav/ahead/aheadKinds";
import type { AheadSource } from "@/nav/ahead/aheadFeed";
import { tidyHeadline } from "@/map/alertCard";

export interface ReportLike {
  id: string;
  confirmCount?: number;
  createdAt?: number;
  reporterName?: string;
}
export interface IncidentLike {
  id: string;
  headline: string;
  advice: string;
}

/** Official text short enough for the banner's grey line. */
export function officialLine(i: IncidentLike): string | null {
  const advice = i.advice?.trim();
  if (advice && advice.length <= 60) return advice;
  const head = tidyHeadline(i.headline ?? "");
  return head || null;
}

export function aheadSourcesFrom(
  features: readonly ApproachFeature[],
  reports: readonly ReportLike[],
  incidents: readonly IncidentLike[]
): AheadSource[] {
  const reportById = new Map(reports.map((r) => [r.id, r]));
  const incidentById = new Map(incidents.map((i) => [i.id, i]));
  const out: AheadSource[] = [];
  for (const f of features) {
    if (f.key.startsWith("alert:")) {
      const r = reportById.get(f.key.slice(6));
      const kind = kindOfItem(f.item, true);
      if (!kind) continue;
      out.push({
        key: f.key,
        kind,
        item: f.item,
        source: "community",
        lat: f.lat,
        lng: f.lng,
        alertId: f.key.slice(6),
        confirmCount: r?.confirmCount ?? 0,
        createdAt: r?.createdAt ?? null,
        reporterName: r?.reporterName ?? null,
      });
    } else if (f.key.startsWith("ltn:")) {
      const i = incidentById.get(f.key.slice(4));
      const kind = kindOfItem(f.item, false);
      if (!kind) continue;
      out.push({ key: f.key, kind, item: f.item, source: "official", lat: f.lat, lng: f.lng, incidentId: f.key.slice(4), officialText: i ? officialLine(i) : null });
    } else {
      const kind = kindOfItem(f.item, false);
      if (!kind) continue;
      out.push({ key: f.key, kind, item: f.item, source: "map", lat: f.lat, lng: f.lng });
    }
  }
  return out;
}
