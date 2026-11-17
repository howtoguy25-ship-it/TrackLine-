// Sensitive fields are masked in everything the dashboard shows. Revealing one is a separate,
// logged action (users.reveal).

function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return email ? "•••" : null;
  const [local, domain] = email.split("@");
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${keep}${"•".repeat(Math.max(3, local.length - keep.length))}@${host.slice(0, 1)}${"•".repeat(Math.max(2, host.length - 1))}${tld}`;
}

/** "+61412345678" -> "•••• ••• 678"; keeps only the last three digits. */
function maskPhone(phone) {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••• ••${digits.slice(-4, -3)} ${digits.slice(-3)}`;
}

const SENSITIVE_KEYS = new Set(["email", "phoneNumber", "phone", "newEmail", "newPhone", "oldEmail", "oldPhone", "contact"]);
const NEVER_KEYS = new Set(["password", "passwordHash", "passwordSalt", "code", "codeHash", "grant", "grantHash", "expoPushToken", "pushToken"]);

/** Deep copy with emails / phones masked and secrets removed (for audit before/after and views). */
function maskRecord(value, depth = 0) {
  if (depth > 6 || value == null) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => maskRecord(v, depth + 1));
  if (typeof value === "object") {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (NEVER_KEYS.has(k)) continue;
      if (SENSITIVE_KEYS.has(k) && typeof v === "string") {
        out[k] = v.includes("@") ? maskEmail(v) : maskPhone(v);
      } else {
        out[k] = maskRecord(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

module.exports = { maskEmail, maskPhone, maskRecord };
