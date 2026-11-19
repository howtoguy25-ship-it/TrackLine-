import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/services/firebase";
import { callFn } from "@/services/callable";

// Messages from TrackLine (owner dashboard campaigns, support replies): users/{uid}/inbox.
export interface InboxMessage {
  id: string;
  campaignId: string | null;
  title: string;
  body: string;
  category: string;
  channels: string[];
  imageUrl: string | null;
  button: { label: string; deepLink: string } | null;
  translations: Record<string, { title: string; body: string; buttonLabel?: string }>;
  from: string;
  createdAtMs: number;
  openedAtMs: number | null;
  clickedAtMs: number | null;
  dismissedAtMs: number | null;
}

/** The message in the phone's language when the dashboard wrote one. Pure. */
export function localised(m: InboxMessage, lang: string | null): { title: string; body: string; buttonLabel: string | null } {
  const t = lang && m.translations ? m.translations[lang] : undefined;
  return { title: t?.title || m.title, body: t?.body || m.body, buttonLabel: t?.buttonLabel || m.button?.label || null };
}

/** The banner to show on the home map: newest undismissed "banner" message. Pure. */
export function activeBanner(list: InboxMessage[]): InboxMessage | null {
  return list.filter((m) => m.channels.includes("banner") && !m.dismissedAtMs).sort((a, b) => b.createdAtMs - a.createdAtMs)[0] ?? null;
}

/** The full-screen announcement to show: newest unopened "fullscreen" message. Pure. */
export function activeAnnouncement(list: InboxMessage[]): InboxMessage | null {
  return list.filter((m) => m.channels.includes("fullscreen") && !m.openedAtMs && !m.dismissedAtMs).sort((a, b) => b.createdAtMs - a.createdAtMs)[0] ?? null;
}

export function subscribeInbox(uid: string, onChange: (list: InboxMessage[]) => void): () => void {
  return onSnapshot(
    query(collection(db, "users", uid, "inbox"), orderBy("createdAtMs", "desc"), limit(50)),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InboxMessage, "id">) }))),
    () => onChange([])
  );
}

export function reportInboxEvent(id: string, event: "opened" | "clicked" | "dismissed"): Promise<unknown> {
  return callFn("inboxEvent", { id, event }).catch(() => null);
}

export function phoneLanguage(): string | null {
  try {
    return (Intl.DateTimeFormat().resolvedOptions().locale || "").split("-")[0] || null;
  } catch {
    return null;
  }
}
