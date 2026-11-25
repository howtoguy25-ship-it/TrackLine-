"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { downloadText, fmtTime } from "@/lib/format";
import { Page, Status, useData } from "@/components/ui";

type Entry = { id: string; at: number; actorEmail: string; actorRole: string; action: string; target: string | null; reason: string; ip: string | null; before: unknown; after: unknown };

export default function AuditPage() {
  const [f, setF] = useState({ action: "", target: "", actor: "" });
  const [query, setQuery] = useState(f);
  const { data, error, busy } = useData(() => api<{ entries: Entry[] }>("adminGovernance", "audit", { ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)), limit: 300 }), [query]);
  const [chain, setChain] = useState<string | null>(null);
  return (
    <Page
      title="Audit log"
      actions={
        <>
          <button className="btn-secondary" onClick={async () => { const r = await api<{ intact: boolean; entries: number; firstBadIndex: number | null }>("adminGovernance", "verifyAudit"); setChain(r.intact ? `All ${r.entries} entries intact.` : `Chain broken at entry ${r.firstBadIndex} — something was edited or removed outside the dashboard.`); }}>Check integrity</button>
          <button className="btn-primary" onClick={async () => { const r = await api<{ csv: string }>("adminGovernance", "exportAudit"); downloadText(`trackline-audit-${new Date().toISOString().slice(0, 10)}.csv`, r.csv); }}>Export CSV (90 days)</button>
        </>
      }
    >
      <p className="text-sm text-slate-500">Append-only: entries can&apos;t be edited or deleted from the dashboard. Each entry is chained to the one before it.</p>
      {chain && <div className="card text-sm">{chain}</div>}
      <form className="card grid gap-2 md:grid-cols-4" onSubmit={(e) => (e.preventDefault(), setQuery(f))}>
        <input className="input" placeholder="Action (users.disable)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <input className="input" placeholder="Target (user or item ID)" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <input className="input" placeholder="Staff email" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <button className="btn-primary">Filter</button>
      </form>
      <Status busy={busy} error={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>Reason</th><th>IP</th><th>Before → after</th></tr></thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}><td className="whitespace-nowrap">{fmtTime(e.at)}</td><td>{e.actorEmail}<div className="text-xs text-slate-500">{e.actorRole}</div></td><td>{e.action}</td><td className="font-mono text-xs">{e.target}</td><td>{e.reason}</td><td className="text-xs">{e.ip}</td>
                <td className="max-w-xs font-mono text-xs">{JSON.stringify(e.before)} → {JSON.stringify(e.after)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
