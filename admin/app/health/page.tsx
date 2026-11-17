"use client";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type Health = { feeds: { id: string; updatedAtMs: number | null; detail: string | null }[]; functionErrors: { fn: string; count: number; last: number; lastMessage: string }[]; appVersions: Record<string, number>; crashFree: { available: boolean; percent?: number; reason?: string }; latencyNote: string };

export default function HealthPage() {
  const role = useStaff()?.role ?? null;
  const { data, error, busy, reload } = useData(() => api<Health>("adminInsights", "health"));
  const { act, dialog, banner } = useAction();
  const run = (job: string, extra: Record<string, unknown> = {}) => act(`Run ${job}`, (reason) => api("adminInsights", "run", { job, reason, ...extra }), reload);
  return (
    <Page title="System health">
      {dialog}
      {banner}
      <Status busy={busy} error={error} />
      {canDo(role, "health.run") && (
        <div className="card flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => run("refreshSchoolZones")}>Re-run school zones refresh</button>
          <button className="btn-secondary" onClick={() => run("resyncHazards")}>Re-sync official hazards (Live Traffic NSW)</button>
          <button className="btn-secondary" onClick={() => run("clearCache", { cache: "vehicleCheckCache" })}>Clear Vehicle Check cache</button>
          <button className="btn-secondary" onClick={() => run("clearCache", { cache: "poiPopularity" })}>Clear badge popularity cache</button>
        </div>
      )}
      {data && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card"><div className="label">Data feeds</div>
            <table className="table"><tbody>{data.feeds.map((f) => <tr key={f.id}><td>{f.id}</td><td>{fmtTime(f.updatedAtMs)}</td><td>{f.detail}</td></tr>)}</tbody></table>
          </div>
          <div className="card"><div className="label">Cloud Function errors (24 h)</div>
            {data.functionErrors.length === 0 ? <p className="text-sm text-slate-500">None logged.</p> : <table className="table"><tbody>{data.functionErrors.map((e) => <tr key={e.fn}><td>{e.fn}</td><td>{e.count}</td><td>{fmtTime(e.last)}</td><td className="text-xs">{e.lastMessage}</td></tr>)}</tbody></table>}
            <p className="pt-2 text-xs text-slate-500">{data.latencyNote}</p>
          </div>
          <div className="card"><div className="label">Crash reports</div><p className="text-sm">{data.crashFree.available ? `${data.crashFree.percent}% crash-free sessions (24 h, Sentry)` : data.crashFree.reason}</p></div>
          <div className="card"><div className="label">App versions in use (30 days)</div>
            <table className="table"><tbody>{Object.entries(data.appVersions).sort((a, b) => b[1] - a[1]).map(([v, n]) => <tr key={v}><td>{v}</td><td>{n}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}
    </Page>
  );
}
