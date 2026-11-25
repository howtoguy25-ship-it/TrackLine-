"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { canDo } from "@/lib/nav";
import { fmtTime } from "@/lib/format";
import { useStaff } from "@/components/AuthGate";
import { Page, Status, useAction, useData } from "@/components/ui";

type Meta = { templates: Record<string, { name: string; category: string; channels: string[]; title: string; body: string; button: { label: string; deepLink: string } | null }>; categories: Record<string, { label: string; required?: boolean }>; channels: string[]; deepLinks: string[]; languages: string[] };
type Campaign = { id: string; message: { title: string; category: string; channels: string[] }; audience: Record<string, unknown>; status: string; sendAtMs: number; stats: { targeted: number; delivered: number; pushSent: number; pushFailed: number; opened: number; clicked: number } | null };

const CHANNEL_LABEL: Record<string, string> = { push: "Push notification", inbox: "In-app Inbox", banner: "Home-map banner", fullscreen: "Full-screen announcement" };

export default function MessagesPage() {
  const role = useStaff()?.role ?? null;
  const meta = useData(() => api<Meta>("adminMessages", "templates"));
  const list = useData(() => api<{ campaigns: Campaign[] }>("adminMessages", "list"));
  const { act, dialog, banner } = useAction();
  const [m, setM] = useState({ title: "", body: "", category: "news", channels: ["inbox"] as string[], imageUrl: "", buttonLabel: "", deepLink: "", lang: "", tTitle: "", tBody: "" });
  const [aud, setAud] = useState({ country: "", state: "", platform: "", minAppVersion: "", maxAppVersion: "", signedIn: "", feature: "", uid: "", lat: "", lng: "", km: "" });
  const [when, setWhen] = useState("");
  const [estimate, setEstimate] = useState<{ users: number; withPush: number } | null>(null);

  const audience = () => {
    const a: Record<string, unknown> = {};
    for (const k of ["country", "state", "platform", "minAppVersion", "maxAppVersion", "feature", "uid"] as const) if (aud[k]) a[k] = aud[k];
    if (aud.signedIn) a.signedIn = aud.signedIn === "yes";
    if (aud.lat && aud.lng && aud.km) a.radius = { lat: Number(aud.lat), lng: Number(aud.lng), km: Number(aud.km) };
    return a;
  };
  const message = () => ({
    title: m.title,
    body: m.body,
    category: m.category,
    channels: m.channels,
    ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}),
    ...(m.buttonLabel && m.deepLink ? { button: { label: m.buttonLabel, deepLink: m.deepLink } } : {}),
    ...(m.lang && m.tTitle && m.tBody ? { translations: { [m.lang]: { title: m.tTitle, body: m.tBody } } } : {}),
  });
  // Live audience size.
  useEffect(() => {
    const t = setTimeout(() => api<{ users: number; withPush: number }>("adminMessages", "estimate", { audience: audience(), category: m.category }).then(setEstimate).catch(() => setEstimate(null)), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aud, m.category]);

  const T = meta.data;
  return (
    <Page title="Messages to users">
      {dialog}
      {banner}
      <Status busy={meta.busy} error={meta.error} />
      {T && canDo(role, "messages.send") && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card space-y-2">
            <div className="label">Compose</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(T.templates).map(([k, t]) => (
                <button key={k} className="btn-secondary" onClick={() => setM({ ...m, title: t.title, body: t.body, category: t.category, channels: t.channels, buttonLabel: t.button?.label ?? "", deepLink: t.button?.deepLink ?? "" })}>{t.name}</button>
              ))}
            </div>
            <input className="input" placeholder="Title" maxLength={80} value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} />
            <textarea className="input" placeholder="Message" rows={4} maxLength={600} value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} />
            <input className="input" placeholder="Image (https:// link, optional)" value={m.imageUrl} onChange={(e) => setM({ ...m, imageUrl: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Button label (optional)" value={m.buttonLabel} onChange={(e) => setM({ ...m, buttonLabel: e.target.value })} />
              <select className="input" value={m.deepLink} onChange={(e) => setM({ ...m, deepLink: e.target.value })}>
                <option value="">Button opens…</option>
                {T.deepLinks.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="label">Category (users can switch these off in Settings &gt; Notifications)</div>
            <select className="input" value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })}>
              {Object.entries(T.categories).map(([k, c]) => <option key={k} value={k}>{c.label}{c.required ? " (always delivered)" : ""}</option>)}
            </select>
            <div className="label">Channels</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {T.channels.map((ch) => (
                <label key={ch} className="flex items-center gap-1">
                  <input type="checkbox" checked={m.channels.includes(ch)} onChange={(e) => setM({ ...m, channels: e.target.checked ? [...m.channels, ch] : m.channels.filter((x) => x !== ch) })} /> {CHANNEL_LABEL[ch] ?? ch}
                </label>
              ))}
            </div>
            <div className="label">Another language (optional)</div>
            <div className="grid grid-cols-3 gap-2">
              <select className="input" value={m.lang} onChange={(e) => setM({ ...m, lang: e.target.value })}>
                <option value="">None</option>
                {T.languages.filter((l) => l !== "en").map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <input className="input" placeholder="Title" value={m.tTitle} onChange={(e) => setM({ ...m, tTitle: e.target.value })} />
              <input className="input" placeholder="Message" value={m.tBody} onChange={(e) => setM({ ...m, tBody: e.target.value })} />
            </div>
          </div>
          <div className="card space-y-2">
            <div className="label">Audience (all filters must match)</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Country (AU)" value={aud.country} onChange={(e) => setAud({ ...aud, country: e.target.value.toUpperCase() })} />
              <input className="input" placeholder="State (NSW)" value={aud.state} onChange={(e) => setAud({ ...aud, state: e.target.value.toUpperCase() })} />
              <select className="input" value={aud.platform} onChange={(e) => setAud({ ...aud, platform: e.target.value })}><option value="">Any platform</option><option value="ios">iOS</option><option value="android">Android</option></select>
              <select className="input" value={aud.signedIn} onChange={(e) => setAud({ ...aud, signedIn: e.target.value })}><option value="">Guests + accounts</option><option value="yes">Signed in only</option><option value="no">Guests only</option></select>
              <input className="input" placeholder="App version from (1.4.0)" value={aud.minAppVersion} onChange={(e) => setAud({ ...aud, minAppVersion: e.target.value })} />
              <input className="input" placeholder="App version to" value={aud.maxAppVersion} onChange={(e) => setAud({ ...aud, maxAppVersion: e.target.value })} />
              <select className="input" value={aud.feature} onChange={(e) => setAud({ ...aud, feature: e.target.value })}>
                <option value="">Any features</option>
                {["trackys", "schoolZones", "liveTraffic", "speedometer", "shareArrivals"].map((f) => <option key={f} value={f}>Has {f} on</option>)}
              </select>
              <input className="input" placeholder="Single user ID" value={aud.uid} onChange={(e) => setAud({ ...aud, uid: e.target.value })} />
            </div>
            <div className="label">City radius</div>
            <div className="grid grid-cols-3 gap-2">
              <input className="input" placeholder="Lat -33.87" value={aud.lat} onChange={(e) => setAud({ ...aud, lat: e.target.value })} />
              <input className="input" placeholder="Lng 151.21" value={aud.lng} onChange={(e) => setAud({ ...aud, lng: e.target.value })} />
              <input className="input" placeholder="km" value={aud.km} onChange={(e) => setAud({ ...aud, km: e.target.value })} />
            </div>
            <div className="rounded-lg bg-slate-100 p-3 text-sm">{estimate ? <>About <b>{estimate.users}</b> users ({estimate.withPush} can get push), after their Notification settings.</> : "Working out audience…"}</div>
            <label className="label" htmlFor="when">Send at (leave empty to send now)</label>
            <input id="when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button
              className="btn-primary w-full"
              disabled={!m.title || !m.body || m.channels.length === 0}
              onClick={() => act(when ? "Schedule message" : "Send message now", (reason) => api("adminMessages", "send", { message: message(), audience: audience(), reason, ...(when ? { sendAtMs: new Date(when).getTime() } : {}) }), list.reload)}
            >
              {when ? "Schedule" : "Send now"}
            </button>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <div className="label">Sent and scheduled</div>
        <Status busy={list.busy} error={list.error} />
        <table className="table">
          <thead><tr><th>Title</th><th>Channels</th><th>Status</th><th>When</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th /></tr></thead>
          <tbody>
            {list.data?.campaigns.map((c) => (
              <tr key={c.id}>
                <td>{c.message.title}<div className="text-xs text-slate-500">{c.message.category} · {JSON.stringify(c.audience)}</div></td>
                <td>{c.message.channels.join(", ")}</td>
                <td><span className="pill">{c.status}</span></td>
                <td>{fmtTime(c.sendAtMs)}</td>
                <td>{c.stats ? `${c.stats.delivered} in-app · ${c.stats.pushSent} push` : "—"}</td>
                <td>{c.stats?.opened ?? "—"}</td>
                <td>{c.stats?.clicked ?? "—"}</td>
                <td>{c.status === "scheduled" && canDo(role, "messages.send") && <button className="text-red-600 underline" onClick={() => act("Cancel scheduled message", (reason) => api("adminMessages", "cancel", { id: c.id, reason }), list.reload)}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
