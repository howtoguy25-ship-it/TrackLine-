"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type TicketRow = { id: string; kind: string; status: string; subject: string; uid: string | null; assignee: string | null; risk: { level: string; score: number } | null; ai: { riskLevel: string; duplicateOf: string[] } | null; updatedAtMs: number };
type Ticket = { ticket: Record<string, unknown> & { id: string; kind: string; status: string; subject: string; uid: string | null; risk?: { score: number; level: string; reasons: string[]; mandatoryReview: boolean }; signals?: Record<string, unknown>; details?: Record<string, unknown>; newContact?: string | null; accountFound?: boolean; ai?: { summary: string; suggestedReply: string; riskLevel: string; riskReasons: string[]; duplicateOf: string[] } }; messages: { from: string; text: string; atMs: number }[]; notes: { staffEmail: string; text: string; atMs: number }[] };

function Inbox() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const { data, error, busy } = useData(() => api<{ tickets: TicketRow[] }>("adminSupport", "list", status ? { status } : {}), [status]);
  return (
    <Page title="Support + recovery" actions={["", "new", "waiting", "solved"].map((s) => <button key={s} className={s === status ? "btn-primary" : "btn-secondary"} onClick={() => setStatus(s)}>{s || "All"}</button>)}>
      <Status busy={busy} error={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Subject</th><th>Kind</th><th>Status</th><th>Risk</th><th>AI</th><th>Updated</th></tr></thead>
          <tbody>
            {data?.tickets.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/support/?id=${t.id}`)}>
                <td>{t.subject}</td><td><span className="pill">{t.kind}</span></td><td>{t.status}</td>
                <td>{t.risk ? `${t.risk.level} (${t.risk.score})` : "—"}</td>
                <td>{t.ai ? `${t.ai.riskLevel}${t.ai.duplicateOf.length ? ` · ${t.ai.duplicateOf.length} duplicate(s)` : ""}` : "—"}</td>
                <td>{fmtTime(t.updatedAtMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

function TicketView({ id }: { id: string }) {
  const role = useStaff()?.role ?? null;
  const can = canDo(role, "support.act");
  const { data, error, busy, reload } = useData(() => api<Ticket>("adminSupport", "get", { id }), [id]);
  const canned = useData(() => api<{ canned: Record<string, string> }>("adminSupport", "list", { status: "new" }));
  const { act, dialog, banner } = useAction();
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  if (!data) return <Page title="Ticket"><Status busy={busy} error={error} /></Page>;
  const t = data.ticket;
  return (
    <Page title={t.subject} actions={<a className="btn-secondary" href="/support/">All tickets</a>}>
      {dialog}
      {banner}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card space-y-2 md:col-span-2">
          <div className="label">Conversation</div>
          {data.messages.map((m, i) => (
            <div key={i} className={`rounded-lg p-2 text-sm ${m.from === "user" ? "bg-slate-100" : "bg-blue-50"}`}><b>{m.from === "user" ? "User" : "Staff"}</b> · {fmtTime(m.atMs)}<div className="whitespace-pre-wrap">{m.text}</div></div>
          ))}
          {can && (
            <>
              <div className="flex flex-wrap gap-2">
                {Object.entries(canned.data?.canned ?? {}).map(([k, v]) => <button key={k} className="btn-secondary" onClick={() => setReply(v)}>{k}</button>)}
              </div>
              <textarea className="input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the user (they see it in the app)" />
              <div className="flex gap-2">
                <button className="btn-primary" disabled={!reply.trim()} onClick={async () => { await api("adminSupport", "reply", { id, text: reply }); setReply(""); reload(); }}>Send reply</button>
                <button className="btn-secondary" disabled={!reply.trim()} onClick={async () => { await api("adminSupport", "reply", { id, text: reply, solve: true }); setReply(""); reload(); }}>Send + mark solved</button>
              </div>
            </>
          )}
        </div>
        <div className="space-y-3">
          <div className="card space-y-1 text-sm">
            <div className="label">Ticket</div>
            <div>Status: <b>{t.status}</b> · {t.kind}</div>
            {t.uid ? <a className="text-brand underline" href={`/users/?uid=${t.uid}`}>Open user</a> : <div>No matching account{t.kind === "recovery" ? " (reviewer sees none)" : ""}</div>}
            {can && (
              <div className="flex flex-wrap gap-1 pt-1">
                {["new", "waiting", "solved"].map((s) => <button key={s} className="btn-secondary" onClick={async () => { await api("adminSupport", "update", { id, status: s }); reload(); }}>{s}</button>)}
                <button className="btn-secondary" onClick={async () => { await api("adminSupport", "update", { id, assignee: "me" }); reload(); }}>Assign to me</button>
              </div>
            )}
          </div>
          {t.kind === "recovery" && t.risk && (
            <div className="card space-y-1 text-sm">
              <div className="label">Recovery review</div>
              <div>Risk score <b>{t.risk.score}</b> ({t.risk.level}){t.risk.mandatoryReview ? " — owner/support review required" : ""}</div>
              <ul className="list-disc pl-4 text-xs">{t.risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <div>New contact (verified by code): {t.newContact ?? "not verified"}</div>
              <pre className="whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs">{JSON.stringify(t.details, null, 2)}</pre>
              {canDo(role, "support.act") && t.status !== "solved" && (
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={!t.uid || !t.newContact} onClick={() => act("Approve: change contact in 24 h (old contact is told now)", (reason) => api("adminSupport", "reviewRecovery", { id, decision: "approve", reason }), reload)}>Approve</button>
                  <button className="btn-danger" onClick={() => act("Deny recovery", (reason) => api("adminSupport", "reviewRecovery", { id, decision: "deny", reason }), reload)}>Deny</button>
                </div>
              )}
            </div>
          )}
          <div className="card space-y-1 text-sm">
            <div className="label">AI assistant (suggestions only)</div>
            {t.ai ? (
              <>
                <div><b>Summary:</b> {t.ai.summary}</div>
                <div><b>Risk:</b> {t.ai.riskLevel} — {t.ai.riskReasons.join("; ")}</div>
                {t.ai.duplicateOf.length > 0 && <div><b>Same as:</b> {t.ai.duplicateOf.map((d) => <a key={d} className="mr-1 underline" href={`/support/?id=${d}`}>{d.slice(0, 6)}</a>)}</div>}
                <div className="rounded bg-slate-100 p-2">{t.ai.suggestedReply}</div>
                {can && <button className="btn-secondary" onClick={() => setReply(t.ai!.suggestedReply)}>Use suggested reply</button>}
              </>
            ) : (
              <p className="text-slate-500">Not run yet.</p>
            )}
            <button className="btn-secondary" onClick={async () => { const r = await api<{ ok: boolean; message?: string }>("adminSupport", "ai", { id }); setAiMsg(r.ok ? null : r.message ?? "Unavailable."); reload(); }}>Summarise with AI</button>
            {aiMsg && <p className="text-xs text-slate-500">{aiMsg}</p>}
            <p className="text-xs text-slate-400">The assistant never changes an account or grants access.</p>
          </div>
          <div className="card space-y-1 text-sm">
            <div className="label">Internal notes (staff only)</div>
            {data.notes.map((n, i) => <div key={i} className="text-xs"><b>{n.staffEmail}</b> {fmtTime(n.atMs)}: {n.text}</div>)}
            {can && <><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-secondary" disabled={!note.trim()} onClick={async () => { await api("adminSupport", "note", { id, text: note }); setNote(""); reload(); }}>Add note</button></>}
          </div>
        </div>
      </div>
    </Page>
  );
}

function SupportInner() {
  const id = useSearchParams().get("id");
  return id ? <TicketView id={id} /> : <Inbox />;
}
export default function SupportPage() {
  return <Suspense><SupportInner /></Suspense>;
}
