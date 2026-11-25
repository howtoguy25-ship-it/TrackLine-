"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

const ROLE_TEXT: Record<string, string> = {
  admin: "Everything except granting roles, legal text and system jobs",
  support: "Users and tickets; no billing or app config",
  moderator: "Reports, map edits and user content only",
  viewer: "Read-only",
};

export default function StaffPage() {
  const role = useStaff()?.role ?? null;
  const { data, error, busy, reload } = useData(() => api<{ staff: { uid: string; email: string; role: string; grantedAtMs: number }[] }>("adminGovernance", "staff"));
  const { act, dialog, banner } = useAction();
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("support");
  return (
    <Page title="Staff roles">
      {dialog}
      {banner}
      <div className="card text-sm">
        <ul className="list-disc pl-5">{Object.entries(ROLE_TEXT).map(([r, t]) => <li key={r}><b>{r}</b>: {t}</li>)}</ul>
        <p className="pt-2 text-xs text-slate-500">Only the owner can grant roles. A new role applies from that person&apos;s next sign-in; they must set up an authenticator app.</p>
      </div>
      {canDo(role, "roles.grant") && (
        <div className="card flex flex-wrap items-end gap-2">
          <div className="flex-1"><label className="label">Staff member&apos;s TrackLine account email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <select className="input w-40" value={newRole} onChange={(e) => setNewRole(e.target.value)}>{["admin", "support", "moderator", "viewer"].map((r) => <option key={r}>{r}</option>)}</select>
          <button className="btn-primary" disabled={!email} onClick={() => act(`Give ${email} the ${newRole} role`, (reason) => api("adminGovernance", "setRole", { email, role: newRole, reason }), () => (setEmail(""), reload()))}>Grant role</button>
        </div>
      )}
      <Status busy={busy} error={error} />
      <div className="card">
        <table className="table">
          <thead><tr><th>Email (masked)</th><th>Role</th><th>Since</th><th /></tr></thead>
          <tbody>
            {data?.staff.map((s) => (
              <tr key={s.uid}><td>{s.email}</td><td>{s.role}</td><td>{fmtTime(s.grantedAtMs)}</td>
                <td>{canDo(role, "roles.grant") && <button className="text-red-600 underline" onClick={() => act("Remove role", (reason) => api("adminGovernance", "setRole", { uid: s.uid, role: "none", reason }), reload)}>Remove</button>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
