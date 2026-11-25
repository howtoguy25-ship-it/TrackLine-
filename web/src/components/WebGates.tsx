import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/services/firebase";
import { acceptLegal, inboxEvent, localised, subscribeConfig, subscribeInbox, subscribeLegal, type InboxMessage, type LegalDoc, type RemoteConfig } from "@/services/account";

// What the owner dashboard can put in front of web users: maintenance (banner or block), a
// dismissible banner, a full-screen announcement, and the Privacy / Terms re-accept.
export function WebGates({ user, onConfig }: { user: User | null; onConfig: (c: RemoteConfig) => void }) {
  const [cfg, setCfg] = useState<RemoteConfig>({});
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [legal, setLegal] = useState<Record<string, LegalDoc | null>>({});
  const [accepted, setAccepted] = useState<Record<string, number> | null>(null);
  useEffect(() => subscribeConfig((c) => (setCfg(c), onConfig(c))), [onConfig]);
  useEffect(() => (user ? subscribeInbox(user.uid, setInbox) : undefined), [user]);
  useEffect(() => {
    const a = subscribeLegal("privacy", (d) => setLegal((l) => ({ ...l, privacy: d })));
    const b = subscribeLegal("terms", (d) => setLegal((l) => ({ ...l, terms: d })));
    return () => (a(), b());
  }, []);
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid))
      .then((s) => setAccepted((s.exists() && (s.data().acceptedLegal as Record<string, number>)) || {}))
      .catch(() => setAccepted(null));
  }, [user]);

  const banner = useMemo(() => inbox.filter((m) => m.channels.includes("banner") && !m.dismissedAtMs)[0] ?? null, [inbox]);
  const announcement = useMemo(() => inbox.filter((m) => m.channels.includes("fullscreen") && !m.openedAtMs && !m.dismissedAtMs)[0] ?? null, [inbox]);
  const pendingLegal = accepted ? (["terms", "privacy"] as const).find((k) => legal[k]?.lastMajorVersion && (accepted[k] ?? 0) < (legal[k]!.lastMajorVersion as number)) : undefined;

  if (cfg.maintenance?.mode === "block") {
    return (
      <div className="web-gate-block" role="alert">
        <h1>Back soon</h1>
        <p>{cfg.maintenance.message}</p>
      </div>
    );
  }
  return (
    <>
      {cfg.maintenance?.mode === "banner" && (
        <div className="web-gate-banner warn" role="status"><p>{cfg.maintenance.message}</p></div>
      )}
      {banner && (
        <div className="web-gate-banner" role="status" style={cfg.maintenance?.mode === "banner" ? { top: 130 } : undefined}>
          <p><strong>{localised(banner).title}</strong> {localised(banner).body}</p>
          <button className="ac-close" aria-label="Dismiss" onClick={() => inboxEvent(banner.id, "dismissed")}>×</button>
        </div>
      )}
      {announcement && (
        <div className="web-gate-modal" role="dialog" aria-label={localised(announcement).title}>
          <div>
            <h2>{localised(announcement).title}</h2>
            <p>{localised(announcement).body}</p>
            <button className="ac-btn primary" onClick={() => inboxEvent(announcement.id, "opened")}>Close</button>
          </div>
        </div>
      )}
      {pendingLegal && user && legal[pendingLegal] && (
        <div className="web-gate-modal" role="dialog" aria-label="Updated terms">
          <div>
            <h2>{pendingLegal === "privacy" ? "We've updated our Privacy Policy" : "We've updated our Terms"}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{legal[pendingLegal]!.text}</p>
            <button
              className="ac-btn primary"
              onClick={() => {
                const next = { ...(accepted ?? {}), [pendingLegal]: legal[pendingLegal]!.version };
                setAccepted(next);
                void acceptLegal(user.uid, next).catch(() => {});
              }}
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </>
  );
}
