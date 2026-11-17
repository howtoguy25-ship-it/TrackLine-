// Append-only audit log for every dashboard action: who, what, target, before/after, IP, time.
//
// Stored in auditLog/{id}. Firestore rules refuse every client read and write; only these
// functions write (Admin SDK), and no callable updates or deletes an entry. Each entry also
// carries the hash of the one before it (a chain held in auditChain/head), so an entry edited
// or removed directly in the console shows up as a broken chain in verifyChain().
const crypto = require("crypto");
const { maskRecord } = require("./mask");

const MAX_REASON = 500;

function clientIp(rawRequest) {
  if (!rawRequest) return null;
  const fwd = rawRequest.headers && rawRequest.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return rawRequest.ip || null;
}

function cleanReason(reason) {
  return typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
}

/** The stored shape of one entry (before hashing). Before/after are masked. */
function buildEntry({ actor, action, target = null, before = null, after = null, reason = "", ip = null, nowMs }) {
  return {
    at: nowMs,
    actorUid: actor.uid,
    actorEmail: actor.email || null,
    actorRole: actor.role,
    action,
    target: target == null ? null : String(target),
    before: maskRecord(before),
    after: maskRecord(after),
    reason: cleanReason(reason),
    ip: ip || null,
  };
}

function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

function hashEntry(entry, prevHash) {
  return crypto.createHash("sha256").update(`${prevHash || ""}|${stableStringify(entry)}`).digest("hex");
}

/** Recomputes the chain over entries in time order. Returns the index of the first bad entry or -1. */
function verifyChain(entries) {
  let prev = null;
  for (let i = 0; i < entries.length; i++) {
    const { hash, prevHash, id: _id, ...entry } = entries[i];
    if (prevHash !== prev || hashEntry(entry, prev) !== hash) return i;
    prev = hash;
  }
  return -1;
}

const CSV_COLUMNS = ["at", "actorEmail", "actorRole", "action", "target", "reason", "ip", "before", "after", "hash"];

function csvCell(v) {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(entries) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const e of entries) {
    rows.push(CSV_COLUMNS.map((c) => csvCell(c === "at" ? new Date(e.at).toISOString() : e[c])).join(","));
  }
  return rows.join("\n");
}

/** Writes one entry inside a transaction that advances the chain head. */
async function writeAudit(db, fields) {
  const entry = buildEntry(fields);
  const headRef = db.doc("auditChain/head");
  const ref = db.collection("auditLog").doc();
  await db.runTransaction(async (tx) => {
    const head = await tx.get(headRef);
    const prevHash = head.exists ? head.data().hash : null;
    const hash = hashEntry(entry, prevHash);
    tx.set(ref, { ...entry, prevHash, hash });
    tx.set(headRef, { hash, id: ref.id, at: entry.at });
  });
  return ref.id;
}

module.exports = { clientIp, buildEntry, hashEntry, verifyChain, toCsv, writeAudit, CSV_COLUMNS };
