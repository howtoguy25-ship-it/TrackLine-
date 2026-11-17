"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtAud, fmtTime } from "@/lib/format";
import { Bars, Page, Stat, Status, useData } from "@/components/ui";

type Money = { days: number; rows: { day: string; sold: number; revenueAud: number; providerCostAud: number; profitAud: number }[]; totals: { sold: number; revenueAud: number; providerCostAud: number; costPerCheckAud: number | null }; providers: Record<string, number>; creditsGranted: { uid: string; at: number; count: number; note: string }[]; refundNotes: { uid: string; note: string; atMs: number }[]; apiUsage: { googlePlaces: Record<string, unknown>[]; elevenLabsUsers: number; notTracked: string[] }; priceNote: string };

export default function MoneyPage() {
  const [days, setDays] = useState(30);
  const { data, error, busy } = useData(() => api<Money>("adminInsights", "money", { days }), [days]);
  return (
    <Page title="Money + providers" actions={[7, 30, 90].map((d) => <button key={d} className={d === days ? "btn-primary" : "btn-secondary"} onClick={() => setDays(d)}>{d} days</button>)}>
      <Status busy={busy && !data} error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Vehicle Checks sold" value={data.totals.sold} />
            <Stat label="Revenue" value={fmtAud(data.totals.revenueAud)} note={data.priceNote} />
            <Stat label="Provider cost" value={fmtAud(data.totals.providerCostAud)} note={`${fmtAud(data.totals.costPerCheckAud)} per check`} />
            <Stat label="Profit (before store fees)" value={fmtAud(data.totals.revenueAud - data.totals.providerCostAud)} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Bars label="Revenue per day (A$)" points={data.rows.map((r) => ({ x: r.day, y: r.revenueAud }))} />
            <Bars label="Profit per day (A$)" points={data.rows.map((r) => ({ x: r.day, y: Math.max(0, r.profitAud) }))} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="card"><div className="label">Spend by provider</div>
              <table className="table"><tbody>{Object.entries(data.providers).map(([p, v]) => <tr key={p}><td>{p}</td><td>{fmtAud(v)}</td></tr>)}</tbody></table>
              <div className="label pt-3">Other API usage</div>
              <div className="text-sm">Google Places lookups: {data.apiUsage.googlePlaces.length ? JSON.stringify(data.apiUsage.googlePlaces) : "none recorded"} · ElevenLabs users: {data.apiUsage.elevenLabsUsers}</div>
              <ul className="list-disc pl-5 pt-1 text-xs text-slate-500">{data.apiUsage.notTracked.map((n) => <li key={n}>Not tracked here: {n}</li>)}</ul>
            </div>
            <div className="card"><div className="label">Free checks granted and refund notes</div>
              <table className="table"><tbody>
                {data.creditsGranted.map((c, i) => <tr key={i}><td>{fmtTime(c.at)}</td><td className="font-mono text-xs">{c.uid}</td><td>+{c.count}</td><td>{c.note}</td></tr>)}
                {data.refundNotes.map((r, i) => <tr key={`r${i}`}><td>{fmtTime(r.atMs)}</td><td className="font-mono text-xs">{r.uid}</td><td>note</td><td>{r.note}</td></tr>)}
              </tbody></table>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
