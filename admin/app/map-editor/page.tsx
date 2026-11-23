"use client";
// Web map editor (gap item 16): every live report, fixed camera / road feature and pending map edit
// in the area on screen, on a real map. Moderators drag a pin to where it really is (asked for a
// reason; the server checks it's within 2 km and audits it), approve or remove. OpenStreetMap
// tiles via MapLibre (no key). Server ops: adminModeration mapArea / moveReport / approve / remove.
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction } from "@/components/ui";
import { pinColour, viewBox, type AreaReport, type MapEdit } from "@/lib/mapEditor";

const START = { lng: 151.0345, lat: -33.9175, zoom: 13 };
const STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

export default function MapEditorPage() {
  const role = useStaff()?.role ?? null;
  const can = canDo(role, "moderation.act");
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [data, setData] = useState<{ reports: AreaReport[]; mapEdits: MapEdit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<AreaReport | null>(null);
  const { act, dialog, banner } = useAction();

  const load = useCallback(async () => {
    const m = map.current;
    if (!m) return;
    const box = viewBox(m.getBounds());
    if (!box) {
      setError("Zoom in further (the editor works on up to about 50 km at a time).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setData(await api<{ reports: AreaReport[]; mapEdits: MapEdit[] }>("adminModeration", "mapArea", { box }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = new maplibregl.Map({ container: holder.current, style: STYLE, center: [START.lng, START.lat], zoom: START.zoom });
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.on("load", load);
    m.on("moveend", load);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [load]);

  // Pins: reports (draggable for moderators) and pending map edits.
  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    markers.current.forEach((x) => x.remove());
    markers.current = [];
    for (const r of data.reports) {
      const mk = new maplibregl.Marker({ color: pinColour(r), draggable: can }).setLngLat([r.lng, r.lat]).addTo(m);
      mk.getElement().title = `${r.item ?? r.type}${r.permanent ? " (fixed)" : ""}`;
      mk.getElement().addEventListener("click", () => setPicked(r));
      mk.on("dragend", () => {
        const to = mk.getLngLat();
        act(
          `Move ${r.item ?? r.type} here`,
          (reason) => api("adminModeration", "moveReport", { alertId: r.id, to: { lat: to.lat, lng: to.lng }, reason }),
          load
        ).then(() => mk.setLngLat([r.lng, r.lat]));
      });
      markers.current.push(mk);
    }
    for (const e of data.mapEdits) {
      const mk = new maplibregl.Marker({ color: "#7C3AED", scale: 0.8 }).setLngLat([e.lng, e.lat]).addTo(m);
      mk.getElement().title = `Pending map edit: ${e.kind}${e.speedLimit ? ` ${e.speedLimit} km/h` : ""}`;
      markers.current.push(mk);
    }
  }, [data, can, act, load]);

  const op = (name: string, r: AreaReport, title: string) => act(title, (reason) => api("adminModeration", name, { alertId: r.id, reason }), () => {
    setPicked(null);
    load();
  });

  return (
    <Page title="Map editor" actions={<button className="btn-secondary" onClick={load}>Reload</button>}>
      {dialog}
      {banner}
      <div className="card text-sm text-slate-600">
        Reports, fixed cameras / road features and pending map edits in the area on screen. {can ? "Drag a pin to move it (up to 2 km, with a reason). Click a pin to approve or remove it." : "View only for your role."}
        <span className="ml-2">
          <span className="pill" style={{ background: "#DC2626", color: "#fff" }}>report</span> <span className="pill" style={{ background: "#2563EB", color: "#fff" }}>fixed</span> <span className="pill" style={{ background: "#D97706", color: "#fff" }}>needs approval</span> <span className="pill" style={{ background: "#7C3AED", color: "#fff" }}>map edit</span>
        </span>
      </div>
      <Status busy={busy} error={error} />
      <div ref={holder} className="card" style={{ height: 560, padding: 0, overflow: "hidden" }} data-testid="map-editor-map" />
      {data && <div className="text-xs text-slate-500">{data.reports.length} reports · {data.mapEdits.length} pending map edits in view</div>}
      {picked && (
        <div className="card space-y-2">
          <div>
            <b>{picked.item ?? picked.type}</b> {picked.permanent && <span className="pill">fixed</span>} {picked.awaitingApproval && <span className="pill bg-amber-100">needs approval</span>}
          </div>
          <div className="text-sm">Reported {fmtTime(picked.createdAtMs)} · Still there {picked.confirmCount} · Not there {picked.notThere}</div>
          {picked.comment && <div className="text-sm italic">&ldquo;{picked.comment}&rdquo;</div>}
          <div className="space-x-3">
            {can && picked.awaitingApproval && <button className="text-green-700 underline" onClick={() => op("approve", picked, "Approve report")}>Approve</button>}
            {can && <button className="text-red-600 underline" onClick={() => op("remove", picked, "Remove report")}>Remove</button>}
            <button className="underline" onClick={() => setPicked(null)}>Close</button>
          </div>
        </div>
      )}
    </Page>
  );
}
