"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtAud, fmtNum } from "@/lib/format";
import { Bars, Page, Stat, Status, useData } from "@/components/ui";

type Overview = {
  cards: Record<string, number | null> & { crashFree: { available: boolean; percent?: number; reason?: string } };
  priceNote: string;
  series: Record<string, number | string>[];
  usageCells: { lat: number; lng: number; count: number; city: string | null }[];
  alerts: { kind: string; [k: string]: unknown }[];
};

const ALERT_TEXT = (a: Overview["alerts"][number]) =>
  a.kind === "budget"
    ? `${a.provider}: A$${a.spentAud} spent this month, over the A$${a.budgetAud} budget`
    : a.kind === "functionErrors"
      ? `${a.count} Cloud Function errors in the last 24 h (System health)`
      : a.kind === "spamSpike"
        ? `${a.blockedReporters} reporters burst-blocked right now (Moderation > Spam)`
        : a.kind === "apiKey"
          ? `Provider problem (${a.source}): ${a.message}`
          : a.kind;

export default function OverviewPage() {
  const [days, setDays] = useState(30);
  const { data, error, busy } = useData(() => api<Overview>("adminInsights", "overview", { days }), [days]);
  const c = data?.cards;
  const series = (key: string) => (data?.series ?? []).map((d) => ({ x: String(d.day), y: Number(d[key] ?? 0) }));
  return (
    <Page
      title="Overview"
      actions={[7, 30, 90].map((d) => (
        <button key={d} className={d === days ? "btn-primary" : "btn-secondary"} onClick={() => setDays(d)}>
          {d} days
        </button>
      ))}
    >
      <Status busy={busy && !data} error={error} />
      {data && data.alerts.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <div className="label">Alerts</div>
          <ul className="list-disc pl-5 text-sm">{data.alerts.map((a, i) => <li key={i}>{ALERT_TEXT(a)}</li>)}</ul>
        </div>
      )}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Online now" value={fmtNum(c.onlineNow)} note="active in the last 5 min" />
          <Stat label="Daily active" value={fmtNum(c.dailyActive)} />
          <Stat label="Monthly active" value={fmtNum(c.monthlyActive)} />
          <Stat label="New installs today" value={fmtNum(c.newInstallsToday)} note={`${fmtNum(c.newAccountsToday)} new accounts`} />
          <Stat label="Guests / signed in" value={`${fmtNum(c.guests)} / ${fmtNum(c.signedIn)}`} note={`${c.guestConversionPercent ?? "—"}% signed in · ${fmtNum(c.linkedToday)} guests linked today`} />
          <Stat label="Trips today" value={fmtNum(c.tripsToday)} />
          <Stat label="Reports today" value={fmtNum(c.reportsToday)} />
          <Stat label="Vehicle Checks" value={`${fmtNum(c.vehicleChecksToday)} today`} note={`${fmtNum(c.vehicleChecks30d)} in 30 days · ${fmtAud(c.revenue30d)}`} />
          <Stat label="Revenue today" value={fmtAud(c.revenueToday)} note={data.priceNote} />
          <Stat label="Crash-free sessions" value={c.crashFree.available ? `${c.crashFree.percent}%` : "—"} note={c.crashFree.available ? "last 24 h (Sentry)" : c.crashFree.reason} />
          <Stat label="Open tickets" value={fmtNum(c.openTickets)} />
          <Stat label="Pending moderation" value={fmtNum(c.pendingModeration)} />
        </div>
      )}
      {data && (
        <div className="grid gap-3 md:grid-cols-2">
          <Bars label="Daily active" points={series("active")} />
          <Bars label="New accounts" points={series("newAccounts")} />
          <Bars label="Trips" points={series("trips")} />
          <Bars label="Reports" points={series("reports")} />
          <Bars label="Vehicle Checks sold" points={series("vehicleChecks")} />
          <Bars label="New guests" points={series("newGuests")} />
        </div>
      )}
      {data && (
        <div className="card">
          <div className="label">Active usage by area (last 7 days, ~10 km cells with 5+ installs; no individuals)</div>
          {data.usageCells.length === 0 ? (
            <p className="text-sm text-slate-500">Not enough installs in any one area yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Area</th><th>Centre</th><th>Installs</th></tr></thead>
              <tbody>
                {[...data.usageCells].sort((a, b) => b.count - a.count).map((u) => (
                  <tr key={`${u.lat}:${u.lng}`}><td>{u.city ?? "—"}</td><td>{u.lat.toFixed(2)}, {u.lng.toFixed(2)}</td><td>{u.count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Page>
  );
}
