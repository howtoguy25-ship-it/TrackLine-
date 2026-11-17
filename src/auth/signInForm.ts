// Sign in / Create account form rules: what each field needs, the password strength hint, and
// which field a Firebase error belongs under. Pure, tested directly.

export type AuthMode = "signin" | "signup";
export type Field = "name" | "email" | "password" | "form";
export type FieldErrors = Partial<Record<Field, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD = 8;

export function validateAuthForm(mode: AuthMode, v: { name: string; email: string; password: string }): FieldErrors {
  const e: FieldErrors = {};
  if (mode === "signup" && !v.name.trim()) e.name = "Enter your name.";
  if (!v.email.trim()) e.email = "Enter your email.";
  else if (!EMAIL_RE.test(v.email.trim())) e.email = "That email address doesn't look right.";
  if (!v.password) e.password = "Enter your password.";
  else if (mode === "signup" && v.password.length < MIN_PASSWORD) e.password = `Use at least ${MIN_PASSWORD} characters.`;
  return e;
}

export type Strength = "weak" | "okay" | "strong";

/** A plain hint while typing a new password. Length counts most; mixing kinds of character helps. */
export function passwordStrength(pw: string): { level: Strength; hint: string } {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < MIN_PASSWORD) return { level: "weak", hint: `Weak: use at least ${MIN_PASSWORD} characters.` };
  if (pw.length >= 12 && kinds >= 3) return { level: "strong", hint: "Strong password." };
  if (pw.length >= 10 || kinds >= 3) return { level: "okay", hint: "Okay. Longer, with numbers or symbols, is stronger." };
  return { level: "weak", hint: "Weak: add numbers or symbols, or make it longer." };
}

/** Firebase Auth error code → the field it's shown under, in plain words. */
export function authErrorToField(code: string | undefined, fallback: string): { field: Field; message: string } {
  switch (code) {
    case "auth/invalid-email":
      return { field: "email", message: "That email address doesn't look right." };
    case "auth/user-not-found":
      return { field: "email", message: "No account uses that email. Create one below." };
    case "auth/email-already-in-use":
    case "auth/credential-already-in-use":
      return { field: "email", message: "That email already has an account. Sign in instead." };
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return { field: "password", message: "Incorrect email or password." };
    case "auth/weak-password":
      return { field: "password", message: `Use at least ${MIN_PASSWORD} characters.` };
    case "auth/too-many-requests":
      return { field: "form", message: "Too many tries. Wait a few minutes, or reset your password." };
    case "auth/network-request-failed":
      return { field: "form", message: "No internet connection. Check it and try again." };
    default:
      return { field: "form", message: fallback };
  }
}
