"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type Req = { id: string; uid: string; kind: string; status: string; requestedAtMs: number; completedAtMs?: number; executeAtMs?: number };
type Legal = { docs: Record<"privacy" | "terms", { current: { version: number; major: boolean; text: string; publishedAtMs: number } | null; versions: { version: number; major: boolean; publishedAtMs: number }[] }>; business: { businessName: string; abn: string } };

export default function PrivacyPage() {
  const role = useStaff()?.role ?? null;
  const reqs = useData(() => api<{ requests: Req[]; overdue: string[]; deadlineDays: number }>("adminGovernance", "dataRequests"));
  const legal = useData(() => api<Legal>("adminGovernance", "legal"));
  const { act, dialog, banner } = useAction();
  const [kind, setKind] = useState<"privacy" | "terms">("privacy");
  const [text, setText] = useState<string | null>(null);
  const [major, setMajor] = useState(false);
  const cur = legal.data?.docs[kind].current;
  return (
    <Page title="Privacy & legal">
      {dialog}
      {banner}
      {legal.data && <div className="card text-sm"><b>{legal.data.business.businessName}</b> · ABN {legal.data.business.abn}</div>}
      <div className="card overflow-x-auto">
        <div className="label">Data requests (to be completed within {reqs.data?.deadlineDays ?? 30} days)</div>
        <Status busy={reqs.busy} error={reqs.error} />
        <table className="table">
          <thead><tr><th>User</th><th>Kind</th><th>Status</th><th>Requested</th><th>Done / runs</th><th /></tr></thead>
          <tbody>
            {reqs.data?.requests.map((r) => (
              <tr key={r.id} className={reqs.data!.overdue.includes(r.id) ? "bg-red-50" : ""}>
                <td className="font-mono text-xs"><a className="underline" href={`/users/?uid=${r.uid}`}>{r.uid}</a></td><td>{r.kind}</td><td>{r.status}{reqs.data!.overdue.includes(r.id) ? " (overdue)" : ""}</td>
                <td>{fmtTime(r.requestedAtMs)}</td><td>{fmtTime(r.completedAtMs ?? r.executeAtMs)}</td>
                <td>{canDo(role, "privacy.act") && r.status !== "completed" && <button className="underline" onClick={() => act("Mark request completed", (reason) => api("adminGovernance", "completeRequest", { id: r.id, reason }), reqs.reload)}>Mark done</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pt-2 text-xs text-slate-500">Export and delete are run from the user&apos;s page (Users). Deletion waits 7 days so it can be undone.</p>
      </div>
      <div className="card space-y-2">
        <div className="flex gap-2">{(["privacy", "terms"] as const).map((k) => <button key={k} className={k === kind ? "btn-primary" : "btn-secondary"} onClick={() => (setKind(k), setText(null))}>{k === "privacy" ? "Privacy Policy" : "Terms"}</button>)}</div>
        <div className="text-sm text-slate-500">{cur ? `Version ${cur.version}, published ${fmtTime(cur.publishedAtMs)}` : "Not published from the dashboard yet (the app links the website policy)."}</div>
        <textarea className="input font-mono" rows={16} disabled={!canDo(role, "legal.write")} value={text ?? cur?.text ?? ""} onChange={(e) => setText(e.target.value)} />
        {canDo(role, "legal.write") && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} /> Major change (every user is asked to accept it)</label>
            <button className="btn-primary" disabled={!text} onClick={() => act(`Publish ${kind} v${(cur?.version ?? 0) + 1}`, (reason) => api("adminGovernance", "publishLegal", { kind, text, major, reason }), () => (setText(null), legal.reload()))}>Publish new version</button>
          </div>
        )}
        <div className="label pt-2">Versions</div>
        <ul className="text-sm">{legal.data?.docs[kind].versions.map((v) => <li key={v.version}>v{v.version} · {fmtTime(v.publishedAtMs)}{v.major ? " · major" : ""}</li>)}</ul>
      </div>
    </Page>
  );
}
