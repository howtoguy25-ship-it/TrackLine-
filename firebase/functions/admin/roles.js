// Owner dashboard roles and what each one may do. Every privileged dashboard call goes through
// authorize() on the server; the dashboard's own hiding of buttons is only convenience.
//
// A role is a Firebase Auth custom claim (`role`), set only by the setStaffRole callable, which
// only the owner may call. The owner account itself is recognised by its verified email so the
// very first role can be granted (there is nobody above the owner to grant theirs).

const ROLES = ["owner", "admin", "support", "moderator", "viewer"];

// Verified-email bootstrap. Keep in sync with ADMIN_EMAILS in ../index.js.
const OWNER_EMAILS = ["howtoguy25@gmail.com"];
const BOOTSTRAP_ADMIN_EMAILS = ["support@tracklinemaps.com"];

const ALL = ROLES;
const OWNER = ["owner"];
const OWNER_ADMIN = ["owner", "admin"];
const SUPPORT = ["owner", "admin", "support"];
const MODERATION = ["owner", "admin", "moderator"];

// action -> roles allowed. Read actions include "viewer"; nothing that changes data does.
const PERMISSIONS = {
  "overview.read": ALL,

  "users.read": ["owner", "admin", "support", "moderator", "viewer"],
  "users.reveal": SUPPORT,
  "users.passwordReset": SUPPORT,
  "users.signOut": SUPPORT,
  "users.disable": SUPPORT,
  "users.message": SUPPORT,
  "users.reportBan": ["owner", "admin", "support", "moderator"],
  "users.resetTrust": ["owner", "admin", "support", "moderator"],
  "users.removeReport": ["owner", "admin", "support", "moderator"],
  "users.grantCredit": OWNER_ADMIN, // billing: not support
  "users.merge": OWNER_ADMIN,
  "users.exportData": SUPPORT,
  "users.delete": OWNER_ADMIN,

  "messages.read": ["owner", "admin", "viewer"],
  "messages.send": OWNER_ADMIN,

  "config.read": ["owner", "admin", "viewer"],
  "config.write": OWNER_ADMIN,

  "moderation.read": ["owner", "admin", "moderator", "viewer"],
  "moderation.act": MODERATION,

  "support.read": ["owner", "admin", "support", "viewer"],
  "support.act": SUPPORT,
  "recovery.review": SUPPORT,

  "money.read": ["owner", "admin", "viewer"],

  "health.read": ["owner", "admin", "viewer"],
  "health.run": OWNER,

  "privacy.read": ["owner", "admin", "support", "viewer"],
  "privacy.act": OWNER_ADMIN,
  "legal.write": OWNER,

  "audit.read": OWNER_ADMIN,
  "audit.export": OWNER_ADMIN,

  "roles.read": OWNER_ADMIN,
  "roles.grant": OWNER,
};

/** The role an ID token carries: the custom claim, or the owner / bootstrap-admin email. */
function roleOf(token) {
  if (!token) return null;
  const email = String(token.email || "").toLowerCase();
  const verified = token.email_verified === true;
  if (verified && OWNER_EMAILS.includes(email)) return "owner";
  if (ROLES.includes(token.role) && token.role !== "owner") return token.role;
  if (verified && BOOTSTRAP_ADMIN_EMAILS.includes(email)) return "admin";
  return null;
}

function can(role, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed) throw new Error(`Unknown dashboard action: ${action}`);
  return !!role && allowed.includes(role);
}

/** The second factor Firebase recorded for this sign-in ("totp", "phone"), if any. */
function secondFactorOf(token) {
  return (token && token.firebase && token.firebase.sign_in_second_factor) || null;
}

const MAX_SESSION_AGE_S = 12 * 60 * 60;

class AuthzError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Checks a callable request for a dashboard action. Throws AuthzError with an HttpsError code.
 * requireMfa: staff must have signed in with a second factor (TOTP). It is only relaxed in the
 * emulator, which cannot issue second-factor tokens.
 */
function authorize(auth, action, { requireMfa = true, nowS = Math.floor(Date.now() / 1000) } = {}) {
  if (!auth || !auth.token) throw new AuthzError("unauthenticated", "Sign in first.");
  const token = auth.token;
  const role = roleOf(token);
  if (!role) throw new AuthzError("permission-denied", "This account has no dashboard role.");
  if (token.firebase && token.firebase.sign_in_provider === "anonymous") {
    throw new AuthzError("permission-denied", "Guest accounts can't use the dashboard.");
  }
  if (requireMfa && !secondFactorOf(token)) {
    throw new AuthzError("permission-denied", "Two-step sign-in (authenticator app) is required for the dashboard.");
  }
  if (typeof token.auth_time === "number" && nowS - token.auth_time > MAX_SESSION_AGE_S) {
    throw new AuthzError("unauthenticated", "Your dashboard session is too old. Sign in again.");
  }
  if (!can(role, action)) throw new AuthzError("permission-denied", `Your role (${role}) can't do this.`);
  return { uid: auth.uid, email: token.email || null, role };
}

/** Only the owner grants roles, never "owner" itself, and never to their own account. */
function validateRoleGrant(actor, targetUid, role) {
  if (actor.role !== "owner") throw new AuthzError("permission-denied", "Only the owner can grant roles.");
  if (typeof targetUid !== "string" || !targetUid) throw new AuthzError("invalid-argument", "Choose a user.");
  if (targetUid === actor.uid) throw new AuthzError("invalid-argument", "You can't change your own role.");
  if (role !== null && (!ROLES.includes(role) || role === "owner")) {
    throw new AuthzError("invalid-argument", "Role must be admin, support, moderator, viewer, or none.");
  }
}

module.exports = {
  ROLES,
  OWNER_EMAILS,
  BOOTSTRAP_ADMIN_EMAILS,
  PERMISSIONS,
  MAX_SESSION_AGE_S,
  AuthzError,
  roleOf,
  can,
  secondFactorOf,
  authorize,
  validateRoleGrant,
};
