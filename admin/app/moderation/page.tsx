"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type Report = { id: string; type: string; item: string | null; lat: number; lng: number; comment: string | null; createdBy: string | null; createdAtMs: number | null; confirmCount: number; notThere: number; needsConfirmation: boolean; awaitingApproval: boolean; permanent: boolean; profanity: string | null; reporterTrust: number | null };
const TABS = ["Reports", "Map edits", "User content", "Spam"] as const;
const osm = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

export default function ModerationPage() {
  const role = useStaff()?.role ?? null;
  const can = canDo(role, "moderation.act");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Reports");
  const [filter, setFilter] = useState({ type: "", maxAgeHours: "" });
  const { act, dialog, banner } = useAction();
  const reports = useData(() => api<{ reports: Report[] }>("adminModeration", "reports", { filter: { type: filter.type || undefined, maxAgeHours: filter.maxAgeHours ? Number(filter.maxAgeHours) : undefined } }), [filter]);
  const edits = useData(() => api<{ roadReports: { id: string; kind: string; lat: number; lng: number; confirmCount: number; detail: string | null; speedLimit: number | null }[]; placeReports: { id: string; placeId: string; reason: string; note: string | null }[] }>("adminModeration", "mapEdits"));
  const content = useData(() => api<{ photos: { id: string; placeId: string; storagePath: string }[]; mapChats: { id: string; comment: string; createdBy: string; flagged: string | null }[]; names: { uid: string; name: string; flagged: string }[] }>("adminModeration", "content"));
  const spam = useData(() => api<{ hittingLimits: { uid: string; reportsToday: number; blockedUntil: number | null; trust: number | null }[]; burstBlocked: number; shadowLimited: { uid: string; trust: number | null }[]; banned: number }>("adminModeration", "spam"));
  const op = (name: string, data: Record<string, unknown>, title: string, reload: () => void) => act(title, (reason) => api("adminModeration", name, { ...data, reason }), reload);
  return (
    <Page title="Moderation" actions={TABS.map((t) => <button key={t} className={t === tab ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t)}>{t}</button>)}>
      {dialog}
      {banner}
      {tab === "Reports" && (
        <>
          <div className="card flex flex-wrap gap-2">
            <input className="input w-48" placeholder="Type or item (police, speedCamera…)" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} />
            <input className="input w-40" placeholder="Max age (hours)" value={filter.maxAgeHours} onChange={(e) => setFilter({ ...filter, maxAgeHours: e.target.value })} />
            <span className="self-center text-xs text-slate-500">Flagged and low-trust reports are listed first.</span>
          </div>
          <Status busy={reports.busy} error={reports.error} />
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Report</th><th>Where</th><th>Votes</th><th>Reporter</th><th>Flags</th><th /></tr></thead>
              <tbody>
                {reports.data?.reports.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.item ?? r.type}</b><div className="text-xs">{fmtTime(r.createdAtMs)}</div>{r.comment && <div className="text-xs italic">&ldquo;{r.comment}&rdquo;</div>}</td>
                    <td><a className="text-brand underline" href={osm(r.lat, r.lng)} target="_blank" rel="noreferrer">Map</a></td>
                    <td>Still there {r.confirmCount} · Not there {r.notThere}</td>
                    <td className="font-mono text-xs"><a className="underline" href={`/users/?uid=${r.createdBy}`}>{r.createdBy?.slice(0, 8)}</a><div>trust {r.reporterTrust ?? "—"}</div></td>
                    <td className="space-x-1">{r.profanity && <span className="pill bg-red-100 text-red-700">profanity</span>}{r.awaitingApproval && <span className="pill bg-amber-100">needs approval</span>}{r.needsConfirmation && <span className="pill">low trust</span>}{r.permanent && <span className="pill">permanent</span>}</td>
                    <td className="space-x-2 whitespace-nowrap">
                      {can && r.awaitingApproval && <button className="text-green-700 underline" onClick={() => op("approve", { alertId: r.id }, "Approve report", reports.reload)}>Approve</button>}
                      {can && <button className="text-red-600 underline" onClick={() => op("remove", { alertId: r.id }, "Remove report", reports.reload)}>Remove</button>}
                      {can && <button className="underline" onClick={() => { const item = window.prompt("New type (item id, e.g. otherHazards, police, speedCamera)"); if (item) op("editType", { alertId: r.id, item }, `Change type to ${item}`, reports.reload); }}>Edit type</button>}
                      {can && r.createdBy && <button className="underline" onClick={() => op("banReporter", { uid: r.createdBy, duration: "24h" }, "Ban reporter for 24 h", reports.reload)}>Ban 24h</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "Map edits" && (
        <div className="card overflow-x-auto">
          <Status busy={edits.busy} error={edits.error} />
          <div className="label">School zones and speed limits reported by drivers</div>
          <table className="table">
            <tbody>
              {edits.data?.roadReports.map((r) => (
                <tr key={r.id}>
                  <td>{r.kind}{r.speedLimit != null ? ` (${r.speedLimit} km/h)` : ""}<div className="text-xs">{r.detail}</div></td>
                  <td><a className="text-brand underline" href={osm(r.lat, r.lng)} target="_blank" rel="noreferrer">Map preview</a></td>
                  <td>{r.confirmCount} confirmations</td>
                  <td className="space-x-2">{can && <><button className="text-green-700 underline" onClick={() => op("decideMapEdit", { id: r.id, approve: true }, "Approve map edit", edits.reload)}>Approve</button><button className="text-red-600 underline" onClick={() => op("decideMapEdit", { id: r.id, approve: false }, "Reject map edit", edits.reload)}>Reject</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="label pt-4">&ldquo;This place is wrong&rdquo; reports</div>
          <table className="table"><tbody>{edits.data?.placeReports.map((p) => <tr key={p.id}><td>{p.reason}</td><td className="font-mono text-xs">{p.placeId}</td><td>{p.note}</td></tr>)}</tbody></table>
        </div>
      )}
      {tab === "User content" && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card"><div className="label">Place photos waiting</div>
            {content.data?.photos.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b py-1 text-sm"><span className="font-mono text-xs">{p.storagePath}</span>
                {can && <span className="space-x-2"><button className="text-green-700 underline" onClick={() => op("decidePhoto", { id: p.id, approve: true }, "Approve photo", content.reload)}>Approve</button><button className="text-red-600 underline" onClick={() => op("decidePhoto", { id: p.id, approve: false }, "Reject photo", content.reload)}>Reject</button></span>}</div>
            ))}
          </div>
          <div className="card"><div className="label">Map chats (flagged first)</div>
            {content.data?.mapChats.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b py-1 text-sm"><span>{c.flagged && <span className="pill bg-red-100 text-red-700">{c.flagged}</span>} {c.comment}</span>
                {can && <button className="text-red-600 underline" onClick={() => op("remove", { alertId: c.id }, "Remove map chat", content.reload)}>Remove</button>}</div>
            ))}
          </div>
          <div className="card"><div className="label">Tracky names auto-flagged</div>
            {content.data?.names.map((n) => (
              <div key={n.uid} className="flex items-center justify-between border-b py-1 text-sm"><span>{n.name}</span>
                {can && <button className="text-red-600 underline" onClick={() => op("hideName", { uid: n.uid }, "Hide this name", content.reload)}>Hide</button>}</div>
            ))}
          </div>
        </div>
      )}
      {tab === "Spam" && spam.data && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card"><div className="label">Hitting limits today ({spam.data.burstBlocked} burst-blocked now, {spam.data.banned} banned)</div>
            <table className="table"><tbody>{spam.data.hittingLimits.map((s) => <tr key={s.uid}><td className="font-mono text-xs"><a className="underline" href={`/users/?uid=${s.uid}`}>{s.uid}</a></td><td>{s.reportsToday} today</td><td>{s.blockedUntil ? `blocked until ${fmtTime(s.blockedUntil)}` : ""}</td></tr>)}</tbody></table>
          </div>
          <div className="card"><div className="label">Shadow-limited (low trust: reports need a confirmation)</div>
            <table className="table"><tbody>{spam.data.shadowLimited.map((s) => <tr key={s.uid}><td className="font-mono text-xs"><a className="underline" href={`/users/?uid=${s.uid}`}>{s.uid}</a></td><td>trust {s.trust}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}
    </Page>
  );
}
