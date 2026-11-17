"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type Flag = { enabled: boolean; percent: number; countries: string[] };
type Config = {
  version: number;
  flags: Record<string, Flag>;
  minVersion: Record<"ios" | "android", { soft: string | null; force: string | null }>;
  maintenance: { mode: "off" | "banner" | "block"; message: string };
  tunables: { vehicleCheckPriceTier: string; adFrequency: { appOpenMinMinutes: number; maxPerDay: number }; reports: { maxPerHour: number; maxPerDay: number }; stillThere: { askAfterMinutes: number } };
  whatsNew: { version: string | null; title: string; items: string[] };
  budgets: { monthlyAud: Record<string, number> };
};

export default function ConfigPage() {
  const role = useStaff()?.role ?? null;
  const editable = canDo(role, "config.write");
  const { data, error, busy, reload } = useData(() => api<{ config: Config; features: string[]; history: { id: string; atMs: number; by: string; reason: string; version: number }[] }>("adminConfig", "get"));
  const [c, setC] = useState<Config | null>(null);
  const { act, dialog, banner } = useAction();
  useEffect(() => {
    if (data) setC(JSON.parse(JSON.stringify(data.config)));
  }, [data]);
  if (!data || !c) return <Page title="App control"><Status busy={busy} error={error} /></Page>;
  const setFlag = (k: string, f: Partial<Flag>) => setC({ ...c, flags: { ...c.flags, [k]: { ...c.flags[k], ...f } } });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <Page
      title="App control"
      actions={editable && <button className="btn-primary" onClick={() => act("Publish app config", (reason) => api("adminConfig", "set", { config: c, reason }), reload)}>Publish changes</button>}
    >
      {dialog}
      {banner}
      <p className="text-sm text-slate-500">Changes reach phones within seconds, no new build. Version {data.config.version}. Every publish is kept below and can be rolled back.</p>
      <div className="card overflow-x-auto">
        <div className="label">Feature switches</div>
        <table className="table">
          <thead><tr><th>Feature</th><th>On</th><th>% of users</th><th>Only in countries (blank = all)</th></tr></thead>
          <tbody>
            {data.features.map((k) => {
              const f = c.flags[k] ?? { enabled: true, percent: 100, countries: [] };
              return (
                <tr key={k}>
                  <td>{k}</td>
                  <td><input type="checkbox" disabled={!editable} checked={f.enabled} onChange={(e) => setFlag(k, { enabled: e.target.checked })} /></td>
                  <td><input className="input w-24" type="number" min={0} max={100} disabled={!editable} value={f.percent} onChange={(e) => setFlag(k, { percent: num(e.target.value) })} /></td>
                  <td><input className="input" disabled={!editable} value={f.countries.join(",")} placeholder="AU,NZ" onChange={(e) => setFlag(k, { countries: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card space-y-2">
          <div className="label">Minimum app version</div>
          {(["ios", "android"] as const).map((p) => (
            <div key={p} className="grid grid-cols-3 items-center gap-2 text-sm">
              <span>{p === "ios" ? "iPhone" : "Android"}</span>
              <input className="input" placeholder="Soft prompt below" disabled={!editable} value={c.minVersion[p].soft ?? ""} onChange={(e) => setC({ ...c, minVersion: { ...c.minVersion, [p]: { ...c.minVersion[p], soft: e.target.value || null } } })} />
              <input className="input" placeholder="Force update below" disabled={!editable} value={c.minVersion[p].force ?? ""} onChange={(e) => setC({ ...c, minVersion: { ...c.minVersion, [p]: { ...c.minVersion[p], force: e.target.value || null } } })} />
            </div>
          ))}
          <div className="label pt-2">Maintenance</div>
          <select className="input" disabled={!editable} value={c.maintenance.mode} onChange={(e) => setC({ ...c, maintenance: { ...c.maintenance, mode: e.target.value as Config["maintenance"]["mode"] } })}>
            <option value="off">Off</option><option value="banner">Banner in the app</option><option value="block">Block the app with a message</option>
          </select>
          <input className="input" placeholder="Message users see" disabled={!editable} value={c.maintenance.message} onChange={(e) => setC({ ...c, maintenance: { ...c.maintenance, message: e.target.value } })} />
        </div>
        <div className="card space-y-2 text-sm">
          <div className="label">Prices, limits and timings</div>
          <label className="block">Vehicle Check price tier
            <select className="input" disabled={!editable} value={c.tunables.vehicleCheckPriceTier} onChange={(e) => setC({ ...c, tunables: { ...c.tunables, vehicleCheckPriceTier: e.target.value } })}><option value="19.99">A$19.99</option><option value="24.99">A$24.99</option></select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>Minutes between app-open ads<input className="input" type="number" disabled={!editable} value={c.tunables.adFrequency.appOpenMinMinutes} onChange={(e) => setC({ ...c, tunables: { ...c.tunables, adFrequency: { ...c.tunables.adFrequency, appOpenMinMinutes: num(e.target.value) } } })} /></label>
            <label>Ads per day<input className="input" type="number" disabled={!editable} value={c.tunables.adFrequency.maxPerDay} onChange={(e) => setC({ ...c, tunables: { ...c.tunables, adFrequency: { ...c.tunables.adFrequency, maxPerDay: num(e.target.value) } } })} /></label>
            <label>Reports per hour<input className="input" type="number" disabled={!editable} value={c.tunables.reports.maxPerHour} onChange={(e) => setC({ ...c, tunables: { ...c.tunables, reports: { ...c.tunables.reports, maxPerHour: num(e.target.value) } } })} /></label>
            <label>Reports per day<input className="input" type="number" disabled={!editable} value={c.tunables.reports.maxPerDay} onChange={(e) => setC({ ...c, tunables: { ...c.tunables, reports: { ...c.tunables.reports, maxPerDay: num(e.target.value) } } })} /></label>
            <label>&quot;Still there?&quot; after (min)<input className="input" type="number" disabled={!editable} value={c.tunables.stillThere.askAfterMinutes} onChange={(e) => setC({ ...c, tunables: { ...c.tunables, stillThere: { askAfterMinutes: num(e.target.value) } } })} /></label>
          </div>
          <div className="label pt-2">Monthly provider budgets (A$, for the over-budget alert)</div>
          <textarea className="input font-mono" rows={3} disabled={!editable} value={JSON.stringify(c.budgets.monthlyAud)} onChange={(e) => { try { setC({ ...c, budgets: { monthlyAud: JSON.parse(e.target.value || "{}") } }); } catch { /* wait for valid JSON */ } }} />
        </div>
      </div>
      <div className="card space-y-2">
        <div className="label">What&apos;s New (shown once after updating to this version)</div>
        <div className="grid grid-cols-3 gap-2">
          <input className="input" placeholder="Version 1.5.0" disabled={!editable} value={c.whatsNew.version ?? ""} onChange={(e) => setC({ ...c, whatsNew: { ...c.whatsNew, version: e.target.value || null } })} />
          <input className="input col-span-2" placeholder="Title" disabled={!editable} value={c.whatsNew.title} onChange={(e) => setC({ ...c, whatsNew: { ...c.whatsNew, title: e.target.value } })} />
        </div>
        <textarea className="input" rows={4} placeholder="One line per item" disabled={!editable} value={c.whatsNew.items.join("\n")} onChange={(e) => setC({ ...c, whatsNew: { ...c.whatsNew, items: e.target.value.split("\n") } })} />
      </div>
      <div className="card">
        <div className="label">Change history</div>
        <table className="table">
          <thead><tr><th>Version</th><th>When</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {data.history.map((h) => (
              <tr key={h.id}><td>{h.version}</td><td>{fmtTime(h.atMs)}</td><td>{h.reason}</td>
                <td>{editable && <button className="text-brand underline" onClick={() => act(`Roll back to version ${h.version}`, (reason) => api("adminConfig", "rollback", { historyId: h.id, reason }), reload)}>Roll back to this</button>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
