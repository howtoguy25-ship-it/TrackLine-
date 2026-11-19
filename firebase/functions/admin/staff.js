// The one wrapper every dashboard callable goes through: role check (custom claim), required
// second factor, session age, optional App Check, and an audit writer bound to the caller.
const { authorize, can, AuthzError } = require("./roles");
const { clientIp, writeAudit } = require("./audit");

const EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";

// App Check needs the dashboard's reCAPTCHA Enterprise site key (ADMIN.md). Off until the
// owner sets ADMIN_ENFORCE_APP_CHECK=true in firebase/functions/.env after registering it.
const ENFORCE_APP_CHECK = !EMULATOR && process.env.ADMIN_ENFORCE_APP_CHECK === "true";

class BadInput extends Error {
  constructor(message, code = "invalid-argument") {
    super(message);
    this.code = code;
  }
}

function requireReason(data) {
  const reason = typeof data?.reason === "string" ? data.reason.trim() : "";
  if (reason.length < 3) throw new BadInput("Give a reason for this action (it goes in the audit log).");
  return reason.slice(0, 500);
}

function str(data, key, { max = 200, required = true } = {}) {
  const v = typeof data?.[key] === "string" ? data[key].trim() : "";
  if (required && !v) throw new BadInput(`${key} is required.`);
  return v.slice(0, max);
}

/**
 * One callable per dashboard section. `ops` maps an op name to { perm, run(ctx) }; the caller
 * sends { op, ...args }. The role check is per op, so a viewer can read a section but not act.
 */
function makeStaffSection({ onCall, HttpsError, getFirestore, getAuth }) {
  return function staffSection(ops, opts = {}) {
    const options = { enforceAppCheck: ENFORCE_APP_CHECK };
    if (opts.secrets) options.secrets = opts.secrets;
    if (opts.timeoutSeconds) options.timeoutSeconds = opts.timeoutSeconds;
    return onCall(options, async (request) => {
      const data = request.data || {};
      const op = ops[data.op];
      if (!op) throw new HttpsError("invalid-argument", "Unknown dashboard operation.");
      let actor;
      try {
        actor = authorize(request.auth, op.perm, { requireMfa: !EMULATOR });
      } catch (err) {
        if (err instanceof AuthzError) throw new HttpsError(err.code, err.message);
        throw err;
      }
      const db = getFirestore();
      const ip = clientIp(request.rawRequest);
      const nowMs = Date.now();
      const ctx = {
        actor,
        db,
        auth: getAuth(),
        data,
        ip,
        nowMs,
        can: (perm) => can(actor.role, perm),
        audit: (fields) => writeAudit(db, { actor, ip, nowMs, action: fields.action || op.perm, ...fields }),
      };
      try {
        return await op.run(ctx);
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err instanceof BadInput || err instanceof AuthzError) throw new HttpsError(err.code, err.message);
        if (err && err.code === "auth/user-not-found") throw new HttpsError("not-found", "No such user.");
        console.error(`dashboard ${data.op} failed`, err);
        throw new HttpsError("internal", "That didn't work. Try again.");
      }
    });
  };
}

module.exports = { makeStaffSection, requireReason, str, BadInput, EMULATOR, ENFORCE_APP_CHECK };
