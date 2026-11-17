import { useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/services/firebase";
import {
  GUEST_WARNING,
  authErrorText,
  cancelChange,
  contactKind,
  createTicket,
  emailSignIn,
  emailSignUp,
  inboxEvent,
  localised,
  myTickets,
  newContactStart,
  newContactVerify,
  recoverByEmail,
  recoveryTicket,
  replyTicket,
  saveNotificationPrefs,
  statusLabel,
  subscribeInbox,
  ticketThread,
  toInternational,
  type InboxMessage,
  type Ticket,
} from "@/services/account";
import "./AccountCenter.css";

// Account, help and messages on the web: the same account as the phone app, open to anyone in
// a browser (guests included). Phone, Google and Apple use the existing buttons passed in.
type Tab = "account" | "recover" | "help" | "inbox" | "notifications";

interface Props {
  user: User | null;
  onSignInGoogle: () => void;
  onSignInApple: () => void;
  onSignInPhone: () => void;
  onSignOut: () => void;
  onClose: () => void;
  initialTab?: Tab;
}

export function AccountCenter({ user, onSignInGoogle, onSignInApple, onSignInPhone, onSignOut, onClose, initialTab = "account" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const guest = !user || user.isAnonymous;
  const tabs: [Tab, string][] = [["account", "Account"], ["recover", "Can't sign in?"], ["help", "Help"], ["inbox", "Inbox"], ["notifications", "Notifications"]];
  return (
    <div className="account-center" role="dialog" aria-label="Account and help">
      <div className="ac-head">
        <strong>Account &amp; help</strong>
        <button className="ac-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="ac-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "account" && <AccountTab user={user} guest={guest} onSignInGoogle={onSignInGoogle} onSignInApple={onSignInApple} onSignInPhone={onSignInPhone} onSignOut={onSignOut} />}
      {tab === "recover" && <RecoverTab />}
      {tab === "help" && <HelpTab />}
      {tab === "inbox" && user && <InboxTab uid={user.uid} />}
      {tab === "notifications" && user && <NotificationsTab uid={user.uid} />}
    </div>
  );
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; id: string }) {
  return (
    <label className="ac-field" htmlFor={props.id}>
      <span>{props.label}</span>
      <input id={props.id} type={props.type || "text"} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? "ac-error" : "ac-note"}>{children}</p>;
}

function AccountTab({ user, guest, onSignInGoogle, onSignInApple, onSignInPhone, onSignOut }: { user: User | null; guest: boolean; onSignInGoogle: () => void; onSignInApple: () => void; onSignInPhone: () => void; onSignOut: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useRun();
  if (!guest && user) {
    return (
      <div className="ac-body">
        <Note>Signed in as {user.email || user.phoneNumber || user.displayName || "you"}. Your saved places and settings follow you to the TrackLine app.</Note>
        <button className="ac-btn secondary" onClick={onSignOut}>Sign out</button>
      </div>
    );
  }
  return (
    <div className="ac-body">
      <Note>You&apos;re using TrackLine as a guest. Everything works. {GUEST_WARNING}</Note>
      <button className="ac-btn" onClick={onSignInGoogle}>Continue with Google</button>
      <button className="ac-btn" onClick={onSignInApple}>Continue with Apple</button>
      <button className="ac-btn" onClick={onSignInPhone}>Continue with phone number</button>
      <div className="ac-or">or with email</div>
      <Field id="ac-email" label="Email" type="email" value={email} onChange={setEmail} />
      <Field id="ac-password" label="Password" type="password" value={password} onChange={setPassword} />
      {error && <Note error>{error}</Note>}
      <button
        className="ac-btn primary"
        disabled={busy || !email || password.length < (mode === "signup" ? 8 : 1)}
        onClick={() => run(async () => void (mode === "signup" ? await emailSignUp(email, password) : await emailSignIn(email, password)))}
      >
        {mode === "signup" ? "Create account (keeps everything)" : "Sign in"}
      </button>
      <button className="ac-link" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}</button>
      {mode === "signin" && (
        <button className="ac-link" disabled={!email} onClick={() => run(async () => void (await recoverByEmail(email).catch(() => sendPasswordResetEmail(auth, email.trim()))))}>
          Forgot password? (we&apos;ll email a reset link)
        </button>
      )}
    </div>
  );
}

function RecoverTab() {
  const [step, setStep] = useState<"form" | "code" | "done" | "cancel">("form");
  const [f, setF] = useState({ signUpContact: "", approxSignupMonth: "", deviceModel: "", message: "", newContact: "", code: "", challengeId: "", changeId: "" });
  const [done, setDone] = useState("");
  const { busy, error, run } = useRun();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  if (step === "done") return <div className="ac-body"><Note>{done}</Note></div>;
  if (step === "cancel")
    return (
      <div className="ac-body">
        <Note>Got a message saying someone asked to change your email or phone? Enter the reference and code from it.</Note>
        <Field id="ac-ref" label="Reference" value={f.changeId} onChange={set("changeId")} />
        <Field id="ac-ccode" label="6-digit code" value={f.code} onChange={set("code")} />
        {error && <Note error>{error}</Note>}
        <button className="ac-btn danger" disabled={busy || !f.changeId || f.code.length !== 6} onClick={() => run(async () => (await cancelChange(f.changeId, f.code), setDone("Cancelled. Nothing on your account changed."), setStep("done")))}>Cancel the change</button>
      </div>
    );
  return (
    <div className="ac-body">
      <Note>Still have your email? Use &quot;Forgot password?&quot; on the Account tab. Still have your phone? Use &quot;Continue with phone number&quot;. Lost both? Tell us about the account and we&apos;ll check it&apos;s you.</Note>
      {step === "form" ? (
        <>
          <Field id="ac-signup" label="Email or phone you signed up with" value={f.signUpContact} onChange={set("signUpContact")} />
          <Field id="ac-month" label="Roughly when (YYYY-MM)" value={f.approxSignupMonth} onChange={set("approxSignupMonth")} placeholder="2025-03" />
          <Field id="ac-device" label="Phone you used" value={f.deviceModel} onChange={set("deviceModel")} placeholder="iPhone 15" />
          <Field id="ac-msg" label="Anything else" value={f.message} onChange={set("message")} />
          <Field id="ac-new" label="An email or mobile you can use now" value={f.newContact} onChange={set("newContact")} />
          {error && <Note error>{error}</Note>}
          <button className="ac-btn primary" disabled={busy || !contactKind(toInternational(f.signUpContact)) || !f.newContact} onClick={() => run(async () => (setF({ ...f, challengeId: (await newContactStart(f.newContact)).challengeId }), setStep("code")))}>
            Send a code to my new contact
          </button>
        </>
      ) : (
        <>
          <Field id="ac-code" label="Code we sent to your new contact" value={f.code} onChange={set("code")} />
          {error && <Note error>{error}</Note>}
          <button
            className="ac-btn primary"
            disabled={busy || f.code.length !== 6}
            onClick={() =>
              run(async () => {
                const { proof } = await newContactVerify(f.challengeId, f.code);
                const r = await recoveryTicket({ ...f, proof });
                setDone(`${r.message} If we approve it, the change happens 24 hours later, and we tell your old email or phone first so the real owner can stop it.`);
                setStep("done");
              })
            }
          >
            Send to the TrackLine team
          </button>
        </>
      )}
      <button className="ac-link" onClick={() => setStep("cancel")}>Cancel a change to my account</button>
      <Note>TrackLine staff will never ask for your password or a code.</Note>
    </div>
  );
}

function HelpTab() {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof ticketThread>> | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const { busy, error, run } = useRun();
  const load = () => void myTickets().then(setList).catch(() => setList([]));
  useEffect(load, []);
  if (open)
    return (
      <div className="ac-body">
        <button className="ac-link" onClick={() => (setOpen(null), load())}>← All requests</button>
        <strong>{open.ticket.subject}</strong>
        {open.messages.map((m, i) => <div key={i} className={m.from === "user" ? "ac-me" : "ac-them"}>{m.text}</div>)}
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply" aria-label="Reply" />
        <button className="ac-btn primary" disabled={busy || !text.trim()} onClick={() => run(async () => (setOpen(await replyTicket(open.ticket.id, text.trim())), setText("")))}>Send reply</button>
      </div>
    );
  return (
    <div className="ac-body">
      <Note>Tell us what&apos;s wrong. We reply here and in your Inbox.</Note>
      <Field id="ac-subject" label="Subject" value={subject} onChange={setSubject} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened?" aria-label="What happened?" />
      {error && <Note error>{error}</Note>}
      <button className="ac-btn primary" disabled={busy || !subject.trim() || !text.trim()} onClick={() => run(async () => (await createTicket(subject.trim(), text.trim()), setSubject(""), setText(""), load()))}>Send</button>
      <strong>Your requests</strong>
      {list?.length === 0 && <Note>None yet.</Note>}
      {list?.map((t) => (
        <button key={t.id} className="ac-row" onClick={() => run(async () => setOpen(await ticketThread(t.id)))}>
          <span>{t.subject}</span>
          <em>{statusLabel(t.status)}</em>
        </button>
      ))}
    </div>
  );
}

function InboxTab({ uid }: { uid: string }) {
  const [list, setList] = useState<InboxMessage[]>([]);
  useEffect(() => subscribeInbox(uid, setList), [uid]);
  return (
    <div className="ac-body">
      {list.length === 0 && <Note>No messages from TrackLine yet.</Note>}
      {list.map((m) => {
        const t = localised(m);
        return (
          <details key={m.id} className="ac-msg" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && !m.openedAtMs && inboxEvent(m.id, "opened")}>
            <summary>{!m.openedAtMs && <span className="ac-dot" />}{t.title}</summary>
            <p>{t.body}</p>
            <small>{m.from} · {new Date(m.createdAtMs).toLocaleDateString()}</small>
          </details>
        );
      })}
    </div>
  );
}

function NotificationsTab({ uid }: { uid: string }) {
  const KEY = "trackline.notificationPrefs";
  const [prefs, setPrefs] = useState<{ fun: boolean; news: boolean; traffic: boolean }>(() => {
    try {
      return { fun: true, news: true, traffic: true, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return { fun: true, news: true, traffic: true };
    }
  });
  const toggle = (k: keyof typeof prefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    void saveNotificationPrefs(uid, next).catch(() => {});
  };
  const rows: [keyof typeof prefs, string][] = [["fun", "Fun announcements"], ["news", "News & updates"], ["traffic", "Traffic advisories"]];
  return (
    <div className="ac-body">
      <Note>Messages from TrackLine (Inbox and banners). Account and security messages always come.</Note>
      {rows.map(([k, label]) => (
        <label key={k} className="ac-toggle">
          <span>{label}</span>
          <input type="checkbox" checked={prefs[k]} onChange={() => toggle(k)} />
        </label>
      ))}
    </div>
  );
}
