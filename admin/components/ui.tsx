"use client";
import React, { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

/** Loads data from a dashboard call; reload() after an action. */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    setBusy(true);
    run()
      .then((d) => (setData(d), setError(null)))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setBusy(false));
  }, [run]);
  useEffect(reload, [reload]);
  return { data, error, busy, reload };
}

export function Page({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

export function Status({ busy, error }: { busy?: boolean; error?: string | null }) {
  if (error) return <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>;
  if (busy) return <div className="text-sm text-slate-500">Loading…</div>;
  return null;
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

/** Simple bar chart (inline SVG, no library). */
export function Bars({ points, label }: { points: { x: string; y: number }[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.y));
  const w = Math.max(points.length * 14, 200);
  return (
    <figure className="card">
      <figcaption className="label">{label}</figcaption>
      {points.length === 0 ? (
        <p className="text-sm text-slate-500">No data yet.</p>
      ) : (
        <svg viewBox={`0 0 ${w} 110`} className="h-32 w-full" role="img" aria-label={label}>
          {points.map((p, i) => {
            const h = (p.y / max) * 90;
            return (
              <g key={p.x}>
                <rect x={i * 14 + 2} y={100 - h} width={10} height={h} rx={2} fill="#0A84FF">
                  <title>{`${p.x}: ${p.y}`}</title>
                </rect>
              </g>
            );
          })}
          <line x1={0} y1={100} x2={w} y2={100} stroke="#CBD5E1" />
        </svg>
      )}
    </figure>
  );
}

/** Ask for the reason every action needs (it goes in the audit log). */
export function useReason() {
  const [state, setState] = useState<{ title: string; resolve: (r: string | null) => void } | null>(null);
  const [text, setText] = useState("");
  const ask = (title: string) => new Promise<string | null>((resolve) => (setText(""), setState({ title, resolve })));
  const dialog = state ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold">{state.title}</h2>
        <label className="label" htmlFor="reason">Reason (saved in the audit log)</label>
        <textarea id="reason" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => (state.resolve(null), setState(null))}>Cancel</button>
          <button className="btn-primary" disabled={text.trim().length < 3} onClick={() => (state.resolve(text.trim()), setState(null))}>Confirm</button>
        </div>
      </div>
    </div>
  ) : null;
  return { ask, dialog };
}

/** Run an action with a reason, then show the result or error. */
export function useAction() {
  const { ask, dialog } = useReason();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (title: string, fn: (reason: string) => Promise<unknown>, done?: () => void) => {
    const reason = await ask(title);
    if (!reason) return;
    try {
      await fn(reason);
      setNote({ ok: true, text: `${title}: done.` });
      done?.();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
  };
  const banner = note ? (
    <div className={`card text-sm ${note.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
      {note.text} <button className="ml-2 underline" onClick={() => setNote(null)}>Dismiss</button>
    </div>
  ) : null;
  return { act, dialog, banner };
}
