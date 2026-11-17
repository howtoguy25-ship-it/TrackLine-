"use client";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  getMultiFactorResolver,
  multiFactor,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { api } from "@/lib/api";
import { IDLE_LIMIT_MS, isIdleExpired } from "@/lib/session";
import type { Role } from "@/lib/nav";

// Sign-in for staff: email + password, then the authenticator-app code (TOTP). An account
// without TOTP is made to set it up before it sees anything. 30 minutes idle signs out.
interface Staff {
  user: User;
  role: Role;
  email: string | null;
}
const StaffContext = createContext<Staff | null>(null);
export const useStaff = () => useContext(StaffContext);

type Stage =
  | { s: "loading" }
  | { s: "signin"; error?: string }
  | { s: "totp"; resolver: MultiFactorResolver; error?: string }
  | { s: "enrol"; user: User; secret: TotpSecret | null; error?: string }
  | { s: "norole"; user: User; message: string }
  | { s: "ready"; staff: Staff };

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<Stage>({ s: "loading" });
  const lastActivity = useRef(Date.now());

  useEffect(
    () =>
      onIdTokenChanged(auth, async (user) => {
        if (!user) return setStage({ s: "signin" });
        const token = await user.getIdTokenResult();
        const factor = (token.claims.firebase as { sign_in_second_factor?: string } | undefined)?.sign_in_second_factor;
        if (!factor) {
          if (multiFactor(user).enrolledFactors.length > 0) {
            // Enrolled already but this session skipped it (shouldn't happen): sign in again.
            await signOut(auth);
            return setStage({ s: "signin", error: "Sign in again with your authenticator code." });
          }
          return setStage({ s: "enrol", user, secret: null });
        }
        try {
          const me = await api<{ role: Role; email: string | null }>("adminGovernance", "whoami");
          setStage({ s: "ready", staff: { user, role: me.role, email: me.email } });
        } catch (err) {
          setStage({ s: "norole", user, message: (err as Error).message });
        }
      }),
    []
  );

  // Idle timeout.
  useEffect(() => {
    const touch = () => (lastActivity.current = Date.now());
    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => {
      if (auth.currentUser && isIdleExpired(lastActivity.current, Date.now(), IDLE_LIMIT_MS)) {
        signOut(auth).then(() => setStage({ s: "signin", error: "Signed out after 30 minutes without activity." }));
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, []);

  if (stage.s === "ready") return <StaffContext.Provider value={stage.staff}>{children}</StaffContext.Provider>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold">TrackLine dashboard</h1>
        {stage.s === "loading" && <p className="text-sm text-slate-500">Loading…</p>}
        {stage.s === "signin" && <SignIn error={stage.error} onMfa={(resolver) => setStage({ s: "totp", resolver })} />}
        {stage.s === "totp" && <TotpStep resolver={stage.resolver} />}
        {stage.s === "enrol" && <Enrol user={stage.user} />}
        {stage.s === "norole" && (
          <>
            <p className="text-sm">{stage.message}</p>
            <p className="text-sm text-slate-500">Ask the owner to give this account a role (ADMIN.md).</p>
            <button className="btn-secondary w-full" onClick={() => signOut(auth)}>Sign out</button>
          </>
        )}
        <p className="text-xs text-slate-400">Staff only. Every action is logged.</p>
      </div>
    </div>
  );
}

function SignIn({ error, onMfa }: { error?: string; onMfa: (r: MultiFactorResolver) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(undefined);
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (ex) {
          const code = (ex as { code?: string }).code;
          if (code === "auth/multi-factor-auth-required") onMfa(getMultiFactorResolver(auth, ex as never));
          else setErr(code === "auth/invalid-credential" ? "Wrong email or password." : (ex as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || !email || !password}>Continue</button>
    </form>
  );
}

function TotpStep({ resolver }: { resolver: MultiFactorResolver }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string>();
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!hint) return setErr("This account has no authenticator app set up.");
        try {
          await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim()));
        } catch {
          setErr("That code didn't work. Use the current 6-digit code from your authenticator app.");
        }
      }}
    >
      <label className="label" htmlFor="totp">Authenticator code</label>
      <input id="totp" className="input tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary w-full" disabled={code.length !== 6}>Sign in</button>
    </form>
  );
}

function Enrol({ user }: { user: User }) {
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string>();
  return (
    <div className="space-y-3">
      <p className="text-sm">Two-step sign-in is required. Set up an authenticator app (Google Authenticator, 1Password, Authy…).</p>
      {!secret ? (
        <button
          className="btn-primary w-full"
          onClick={async () => {
            try {
              setSecret(await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession()));
            } catch (ex) {
              const code = (ex as { code?: string }).code;
              setErr(code === "auth/requires-recent-login" ? "Sign out and sign in again first, then set up the app." : `Couldn't start set-up (${code ?? (ex as Error).message}). TOTP must be turned on for the project (ADMIN.md).`);
            }
          }}
        >
          Set up authenticator app
        </button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), "Authenticator app");
              await signOut(auth); // sign in again so the session carries the second factor
            } catch {
              setErr("That code didn't match. Try the next code your app shows.");
            }
          }}
        >
          <p className="text-sm">Add this key in your app (or open the link on your phone), then enter the 6-digit code it shows.</p>
          <code className="block break-all rounded bg-slate-100 p-2 text-sm">{secret.secretKey}</code>
          <a className="text-sm text-brand underline" href={secret.generateQrCodeUrl(user.email ?? "staff", "TrackLine")}>Open in authenticator app</a>
          <input className="input tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-primary w-full" disabled={code.length !== 6}>Finish set-up</button>
        </form>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-secondary w-full" onClick={() => signOut(auth)}>Sign out</button>
    </div>
  );
}
