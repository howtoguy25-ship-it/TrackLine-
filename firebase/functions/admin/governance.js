// Dashboard > Privacy & legal, Staff roles, Audit log.
const { BadInput, requireReason, str } = require("./staff");
const { validateRoleGrant, roleOf, AuthzError } = require("./roles");
const { toCsv, verifyChain } = require("./audit");
const { maskEmail } = require("./mask");

const DAY = 24 * 60 * 60 * 1000;
const REQUEST_DEADLINE_MS = 30 * DAY;
const LEGAL_DOCS = ["privacy", "terms"];

/** Which data requests are overdue (past 30 days and not completed). Pure. */
function overdue(requests, nowMs) {
  return requests.filter((r) => r.status !== "completed" && r.status !== "cancelled" && nowMs - r.requestedAtMs > REQUEST_DEADLINE_MS);
}

function governanceOps({ businessInfo }) {
  return {
    // ---- Privacy & legal ----
    dataRequests: {
      perm: "privacy.read",
      run: async (ctx) => {
        const snap = await ctx.db.collection("dataRequests").orderBy("requestedAtMs", "desc").limit(300).get();
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const pending = await ctx.db.collection("pendingDeletions").limit(300).get();
        return { requests: rows, overdue: overdue(rows, ctx.nowMs).map((r) => r.id), pendingDeletions: pending.docs.map((d) => d.data()), deadlineDays: 30 };
      },
    },
    completeRequest: {
      perm: "privacy.act",
      run: async (ctx) => {
        const id = str(ctx.data, "id");
        const reason = requireReason(ctx.data);
        const ref = ctx.db.doc(`dataRequests/${id}`);
        const snap = await ref.get();
        if (!snap.exists) throw new BadInput("No such request.", "not-found");
        await ref.update({ status: "completed", completedAtMs: ctx.nowMs, completedBy: ctx.actor.uid });
        await ctx.audit({ action: "privacy.completeRequest", target: id, before: { status: snap.data().status }, after: { status: "completed" }, reason });
        return { ok: true };
      },
    },
    legal: {
      perm: "privacy.read",
      run: async (ctx) => {
        const docs = {};
        for (const k of LEGAL_DOCS) {
          const cur = await ctx.db.doc(`legalDocs/${k}`).get();
          const hist = await ctx.db.collection(`legalDocs/${k}/versions`).orderBy("version", "desc").limit(20).get();
          docs[k] = { current: cur.exists ? cur.data() : null, versions: hist.docs.map((d) => ({ version: d.data().version, major: d.data().major, publishedAtMs: d.data().publishedAtMs })) };
        }
        return { docs, business: businessInfo };
      },
    },
    publishLegal: {
      perm: "legal.write",
      run: async (ctx) => {
        const kind = LEGAL_DOCS.includes(ctx.data.kind) ? ctx.data.kind : null;
        if (!kind) throw new BadInput("Document is privacy or terms.");
        const reason = requireReason(ctx.data);
        const text = typeof ctx.data.text === "string" ? ctx.data.text.trim() : "";
        if (text.length < 200 || text.length > 100000) throw new BadInput("The text must be 200 to 100,000 characters.");
        const major = !!ctx.data.major;
        const ref = ctx.db.doc(`legalDocs/${kind}`);
        const cur = await ref.get();
        const version = (cur.exists ? cur.data().version || 0 : 0) + 1;
        const doc = { kind, version, major, text, publishedAtMs: ctx.nowMs, publishedBy: ctx.actor.uid, lastMajorVersion: major ? version : cur.exists ? cur.data().lastMajorVersion || null : null };
        await ctx.db.doc(`legalDocs/${kind}/versions/v${String(version).padStart(4, "0")}`).set(doc);
        await ref.set(doc);
        await ctx.audit({ action: "legal.publish", target: kind, before: cur.exists ? { version: cur.data().version } : null, after: { version, major, length: text.length }, reason });
        return { ok: true, version };
      },
    },

    // ---- Staff roles (owner only grants) ----
    staff: {
      perm: "roles.read",
      run: async (ctx) => {
        const snap = await ctx.db.collection("staff").limit(200).get();
        return { staff: snap.docs.map((d) => ({ uid: d.id, ...d.data(), email: maskEmail(d.data().email) })) };
      },
    },
    setRole: {
      perm: "roles.grant",
      run: async (ctx) => {
        const reason = requireReason(ctx.data);
        let targetUid = typeof ctx.data.uid === "string" ? ctx.data.uid : "";
        if (!targetUid && typeof ctx.data.email === "string") {
          const u = await ctx.auth.getUserByEmail(ctx.data.email.trim().toLowerCase());
          targetUid = u.uid;
        }
        const role = ctx.data.role === "none" || ctx.data.role == null ? null : ctx.data.role;
        try {
          validateRoleGrant(ctx.actor, targetUid, role);
        } catch (err) {
          if (err instanceof AuthzError) throw new BadInput(err.message, err.code);
          throw err;
        }
        const user = await ctx.auth.getUser(targetUid);
        if (roleOf({ email: user.email, email_verified: user.emailVerified }) === "owner") throw new BadInput("The owner's role can't be changed.");
        if (role && !user.email) throw new BadInput("Staff accounts need an email address (for sign-in and 2FA).");
        const before = (user.customClaims && user.customClaims.role) || null;
        await ctx.auth.setCustomUserClaims(targetUid, { ...(user.customClaims || {}), role: role || null });
        await ctx.auth.revokeRefreshTokens(targetUid); // new role applies from their next sign-in
        if (role) await ctx.db.doc(`staff/${targetUid}`).set({ email: user.email, role, grantedBy: ctx.actor.uid, grantedAtMs: ctx.nowMs });
        else await ctx.db.doc(`staff/${targetUid}`).delete();
        await ctx.audit({ action: "roles.grant", target: targetUid, before: { role: before }, after: { role }, reason });
        return { ok: true, uid: targetUid, role };
      },
    },

    // ---- Audit log (read + CSV export; no edit or delete exists anywhere) ----
    audit: {
      perm: "audit.read",
      run: async (ctx) => {
        let q = ctx.db.collection("auditLog").orderBy("at", "desc");
        if (typeof ctx.data.beforeMs === "number") q = q.where("at", "<", ctx.data.beforeMs);
        const snap = await q.limit(Math.min(500, ctx.data.limit || 200)).get();
        let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (ctx.data.action) rows = rows.filter((r) => r.action === ctx.data.action);
        if (ctx.data.target) rows = rows.filter((r) => r.target === ctx.data.target);
        if (ctx.data.actor) rows = rows.filter((r) => r.actorEmail === ctx.data.actor || r.actorUid === ctx.data.actor);
        return { entries: rows };
      },
    },
    exportAudit: {
      perm: "audit.export",
      run: async (ctx) => {
        const since = typeof ctx.data.sinceMs === "number" ? ctx.data.sinceMs : ctx.nowMs - 90 * DAY;
        const snap = await ctx.db.collection("auditLog").where("at", ">=", since).orderBy("at").limit(20000).get();
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        await ctx.audit({ action: "audit.export", target: null, after: { rows: rows.length, sinceMs: since }, reason: "export" });
        return { csv: toCsv(rows), rows: rows.length };
      },
    },
    verifyAudit: {
      perm: "audit.read",
      run: async (ctx) => {
        const snap = await ctx.db.collection("auditLog").orderBy("at").limit(20000).get();
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Entries written in the same millisecond can sort either way; order by the chain itself.
        const byPrev = new Map(rows.map((r) => [r.prevHash || null, r]));
        const ordered = [];
        let cur = byPrev.get(null);
        while (cur && ordered.length < rows.length) {
          ordered.push(cur);
          cur = byPrev.get(cur.hash);
        }
        const bad = ordered.length === rows.length ? verifyChain(ordered) : ordered.length;
        return { entries: rows.length, intact: bad === -1, firstBadIndex: bad === -1 ? null : bad };
      },
    },
    whoami: {
      perm: "overview.read",
      run: async (ctx) => ({ uid: ctx.actor.uid, email: ctx.actor.email, role: ctx.actor.role }),
    },
  };
}

module.exports = { governanceOps, overdue, REQUEST_DEADLINE_MS, LEGAL_DOCS };
