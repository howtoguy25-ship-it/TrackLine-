"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { downloadText, fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type Row = { uid: string; email: string | null; phone: string | null; displayName: string | null; guest: boolean; disabled: boolean; platform: string | null; country: string | null; appVersion: string | null; createdAtMs: number | null; lastActiveMs: number | null; trust: number | null; reportBanned: boolean };

function Search() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState({ q: "", filter: {} as Record<string, unknown> });
  const { data, error, busy } = useData(() => api<{ rows: Row[]; total: number }>("adminUsers", "search", query), [query]);
  const set = (k: string, v: unknown) => setFilter((f) => ({ ...f, [k]: v === "" ? undefined : v }));
  return (
    <Page title="Users">
      <form className="card grid gap-3 md:grid-cols-6" onSubmit={(e) => (e.preventDefault(), setQuery({ q, filter }))}>
        <div className="md:col-span-2">
          <label className="label" htmlFor="q">Email, phone (+61…), name, user ID or Tracky name</label>
          <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Account</label>
          <select className="input" onChange={(e) => set("guest", e.target.value === "" ? "" : e.target.value === "guest")}>
            <option value="">Any</option><option value="guest">Guest</option><option value="signed">Signed in</option>
          </select>
        </div>
        <div>
          <label className="label">Platform</label>
          <select className="input" onChange={(e) => set("platform", e.target.value)}>
            <option value="">Any</option><option value="ios">iOS</option><option value="android">Android</option><option value="web">Web</option>
          </select>
        </div>
        <div>
          <label className="label">Country</label>
          <input className="input" placeholder="AU" maxLength={2} onChange={(e) => set("country", e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="label">Created after</label>
          <input className="input" type="date" onChange={(e) => set("createdAfterMs", e.target.value ? Date.parse(e.target.value) : "")} />
        </div>
        <div>
          <label className="label">Trust from / to</label>
          <div className="flex gap-1">
            <input className="input" type="number" onChange={(e) => set("minTrust", e.target.value === "" ? "" : Number(e.target.value))} />
            <input className="input" type="number" onChange={(e) => set("maxTrust", e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" onChange={(e) => set("banned", e.target.checked || "")} /> Report-banned only</label>
        <div className="md:col-span-4" />
        <button className="btn-primary">Search</button>
      </form>
      <Status busy={busy} error={error} />
      {data && (
        <div className="card overflow-x-auto">
          <div className="label">{data.total} found{data.total > 50 ? " (first 50)" : ""}</div>
          <table className="table">
            <thead><tr><th>User</th><th>Contact (masked)</th><th>Type</th><th>Platform</th><th>Created</th><th>Last active</th><th>Trust</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.uid} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/users/?uid=${r.uid}`)}>
                  <td><div className="font-semibold">{r.displayName ?? "—"}</div><div className="font-mono text-xs text-slate-500">{r.uid}</div></td>
                  <td>{r.email ?? "—"}<br />{r.phone ?? ""}</td>
                  <td>{r.guest ? <span className="pill">Guest</span> : <span className="pill">Account</span>} {r.disabled && <span className="pill bg-red-100 text-red-700">Disabled</span>} {r.reportBanned && <span className="pill bg-amber-100">Report ban</span>}</td>
                  <td>{r.platform ?? "—"} {r.appVersion ?? ""} {r.country ?? ""}</td>
                  <td>{fmtTime(r.createdAtMs)}</td>
                  <td>{fmtTime(r.lastActiveMs)}</td>
                  <td>{r.trust ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

type Profile = {
  account: Row;
  signInMethods: string[];
  role: string | null;
  lastSignInMs: number | null;
  devices: { id: string; model: string | null; os: string | null; appVersion: string | null; lastSeenMs: number | null }[];
  trust: number | null;
  reportBan: { until: number; permanent: boolean } | null;
  reports: { total: number; confirmed: number; accuracy: number | null; recent: { id: string; type: string; item: string | null; confirmCount: number; notThere: number; createdAtMs: number | null }[] };
  purchases: { id: string; platform: string; sandbox: boolean; atMs: number | null; outcome: string | null }[];
  vehicleChecks: number;
  credits: number;
  tickets: { id: string; subject: string; status: string; kind: string; createdAtMs: number }[];
  auditHistory: { id: string; at: number; action: string; actorEmail: string; reason: string }[];
  pendingDeletion: { executeAtMs: number } | null;
};

function ProfileView({ uid }: { uid: string }) {
  const staff = useStaff();
  const role = staff?.role ?? null;
  const { data, error, busy, reload } = useData(() => api<Profile>("adminUsers", "profile", { uid }), [uid]);
  const { act, dialog, banner } = useAction();
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});
  const [msg, setMsg] = useState({ title: "", body: "" });
  const [mergeFrom, setMergeFrom] = useState("");
  const call = (op: string, extra: Record<string, unknown> = {}) => (reason: string) => api("adminUsers", op, { uid, reason, ...extra });
  if (!data) return <Page title="User"><Status busy={busy} error={error} /></Page>;
  const a = data.account;
  return (
    <Page title={a.displayName ?? "User"} actions={<a className="btn-secondary" href="/users/">Back to search</a>}>
      {dialog}
      {banner}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card space-y-1 text-sm">
          <div className="label">Account</div>
          <div className="font-mono text-xs">{a.uid}</div>
          <div>Email: {revealed.email ?? a.email ?? "—"} {a.email && canDo(role, "users.reveal") && !revealed.email && <button className="text-brand underline" onClick={() => act("Reveal email", async (reason) => { const r = await api<{ value: string | null }>("adminUsers", "reveal", { uid, field: "email", reason }); setRevealed((v) => ({ ...v, email: r.value })); })}>Reveal</button>}</div>
          <div>Phone: {revealed.phone ?? a.phone ?? "—"} {a.phone && canDo(role, "users.reveal") && !revealed.phone && <button className="text-brand underline" onClick={() => act("Reveal phone", async (reason) => { const r = await api<{ value: string | null }>("adminUsers", "reveal", { uid, field: "phone", reason }); setRevealed((v) => ({ ...v, phone: r.value })); })}>Reveal</button>}</div>
          <div>Sign-in: {data.signInMethods.join(", ")}</div>
          <div>Created {fmtTime(a.createdAtMs)} · last sign-in {fmtTime(data.lastSignInMs)}</div>
          <div>Staff role: {data.role ?? "none"}</div>
          {a.disabled && <div className="font-semibold text-red-600">Disabled</div>}
          {data.pendingDeletion && <div className="font-semibold text-red-600">Deletes on {fmtTime(data.pendingDeletion.executeAtMs)}</div>}
          <p className="pt-2 text-xs text-slate-500">Passwords are never visible to staff and can't be set here.</p>
        </div>
        <div className="card space-y-1 text-sm">
          <div className="label">Reporting</div>
          <div>Trust score: {data.trust ?? "—"}</div>
          <div>Reports: {data.reports.total} ({data.reports.confirmed} confirmed{data.reports.accuracy != null ? `, ${data.reports.accuracy}%` : ""})</div>
          <div>Report ban: {data.reportBan?.permanent ? "permanent" : data.reportBan && data.reportBan.until > Date.now() ? `until ${fmtTime(data.reportBan.until)}` : "none"}</div>
          <div className="label pt-2">Purchases</div>
          <div>{data.purchases.length} purchases · {data.vehicleChecks} Vehicle Checks · {data.credits} free credits</div>
          {data.purchases.map((p) => <div key={p.id} className="text-xs">{fmtTime(p.atMs)} {p.platform}{p.sandbox ? " (sandbox)" : ""} — {p.outcome ?? "pending"}</div>)}
        </div>
        <div className="card space-y-1 text-sm">
          <div className="label">Devices</div>
          {data.devices.length === 0 && <div className="text-slate-500">None recorded yet.</div>}
          {data.devices.map((d) => <div key={d.id}>{d.model ?? "Unknown"} · {d.os ?? ""} · v{d.appVersion ?? "?"} · {fmtTime(d.lastSeenMs)}</div>)}
          <div className="label pt-2">Support tickets</div>
          {data.tickets.map((t) => <div key={t.id}><a className="text-brand underline" href={`/support/?id=${t.id}`}>{t.subject}</a> <span className="pill">{t.status}</span></div>)}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="label">Actions (each needs a reason and is logged)</div>
        <div className="flex flex-wrap gap-2">
          {canDo(role, "users.act") && (
            <>
              <button className="btn-secondary" onClick={() => act("Send password reset email", call("passwordReset", { channel: "email" }))}>Password reset (email)</button>
              <button className="btn-secondary" onClick={() => act("Send password reset SMS code", call("passwordReset", { channel: "sms" }))}>Password reset (SMS code)</button>
              <button className="btn-secondary" onClick={() => act("Sign out all devices", call("signOut"), reload)}>Sign out everywhere</button>
              <button className={a.disabled ? "btn-secondary" : "btn-danger"} onClick={() => act(a.disabled ? "Enable account" : "Disable account", call("setDisabled", { disabled: !a.disabled }), reload)}>{a.disabled ? "Enable" : "Disable"} account</button>
              <button className="btn-secondary" onClick={() => act("Export user data", async (reason) => { const r = await api<{ data: unknown }>("adminUsers", "exportData", { uid, reason }); downloadText(`trackline-user-${uid}.json`, JSON.stringify(r.data, null, 2), "application/json"); })}>Export data</button>
            </>
          )}
          {canDo(role, "users.moderate") && (
            <>
              {(["1h", "24h", "7d", "permanent", "none"] as const).map((d) => (
                <button key={d} className="btn-secondary" onClick={() => act(d === "none" ? "Lift report ban" : `Report ban: ${d}`, call("reportBan", { duration: d }), reload)}>{d === "none" ? "Lift ban" : `Ban reports ${d}`}</button>
              ))}
              <button className="btn-secondary" onClick={() => act("Reset trust score", call("resetTrust"), reload)}>Reset trust</button>
            </>
          )}
          {canDo(role, "users.billing") && <button className="btn-secondary" onClick={() => act("Grant 1 free Vehicle Check", call("grantCredit", { count: 1 }), reload)}>Grant free Vehicle Check</button>}
          {canDo(role, "users.delete") &&
            (data.pendingDeletion ? (
              <button className="btn-secondary" onClick={() => act("Cancel deletion", call("cancelDelete"), reload)}>Undo deletion</button>
            ) : (
              <button className="btn-danger" onClick={() => act("Delete account + data (7-day undo)", call("delete"), reload)}>Delete account</button>
            ))}
        </div>
        {canDo(role, "users.billing") && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1"><label className="label">Merge another account into this one (its user ID)</label><input className="input" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} /></div>
            <button className="btn-secondary" disabled={!mergeFrom} onClick={() => act("Merge accounts", (reason) => api("adminUsers", "merge", { fromUid: mergeFrom, intoUid: uid, reason }), reload)}>Merge</button>
          </div>
        )}
        {canDo(role, "users.act") && (
          <div className="grid gap-2 md:grid-cols-3">
            <input className="input" placeholder="Message title" value={msg.title} onChange={(e) => setMsg({ ...msg, title: e.target.value })} />
            <input className="input" placeholder="Message" value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} />
            <button className="btn-primary" disabled={!msg.title || !msg.body} onClick={() => act("Send in-app message", call("message", msg), () => setMsg({ title: "", body: "" }))}>Send in-app message</button>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card">
          <div className="label">Recent reports</div>
          <table className="table"><tbody>
            {data.reports.recent.map((r) => (
              <tr key={r.id}><td>{r.item ?? r.type}</td><td>{fmtTime(r.createdAtMs)}</td><td>+{r.confirmCount} / −{r.notThere}</td>
                <td>{canDo(role, "users.moderate") && <button className="text-red-600 underline" onClick={() => act("Remove report", (reason) => api("adminUsers", "removeReport", { alertId: r.id, reason }), reload)}>Remove</button>}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <div className="label">Audit history for this user</div>
          <table className="table"><tbody>
            {data.auditHistory.map((h) => <tr key={h.id}><td>{fmtTime(h.at)}</td><td>{h.action}</td><td>{h.actorEmail}</td><td>{h.reason}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </Page>
  );
}

function UsersInner() {
  const uid = useSearchParams().get("uid");
  return uid ? <ProfileView uid={uid} /> : <Search />;
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersInner />
    </Suspense>
  );
}
