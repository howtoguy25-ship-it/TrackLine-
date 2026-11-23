// Dashboard > Moderation: driver reports, map edits (school zones / speed limits), place photos,
// map chats / names, and the spam view. Every action is audited.
const { BadInput, requireReason, str } = require("./staff");
const { banPatch } = require("./users");
const { flagText } = require("./profanity");

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);
const HOUR = 60 * 60 * 1000;

function km(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Flagged / low-trust first, then newest. Pure. */
function priority(r) {
  let p = 0;
  if (r.profanity) p += 8;
  if (r.awaitingApproval) p += 4;
  if (r.needsConfirmation) p += 3;
  if ((r.notThere || 0) > 0) p += 2;
  if (r.reporterTrust != null && r.reporterTrust < 0) p += 2;
  return p;
}

function filterReports(rows, { type, area, maxAgeHours } = {}, nowMs = Date.now()) {
  return rows
    .filter((r) => !type || r.type === type || r.item === type)
    .filter((r) => !area || km(area, r) <= area.km)
    .filter((r) => !maxAgeHours || (r.createdAtMs && nowMs - r.createdAtMs <= maxAgeHours * HOUR))
    .sort((a, b) => priority(b) - priority(a) || (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

/** The map editor's view box, checked. Pure. */
function parseBox(b) {
  const n = ["south", "west", "north", "east"].map((k) => Number(b && b[k]));
  if (n.some((v) => !Number.isFinite(v)) || n[0] >= n[2] || n[1] >= n[3] || n[0] < -90 || n[2] > 90) throw new BadInput("Pick an area on the map.");
  if (n[2] - n[0] > 0.5 || n[3] - n[1] > 0.5) throw new BadInput("Zoom in further (the editor works on up to about 50 km at a time).");
  return { south: n[0], west: n[1], north: n[2], east: n[3] };
}

function inBox(box, p) {
  return typeof p.lat === "number" && typeof p.lng === "number" && p.lat >= box.south && p.lat <= box.north && p.lng >= box.west && p.lng <= box.east;
}

/** How far a pin may be dragged in one edit (a typo guard, not a rule of the road). */
const MAX_MOVE_KM = 2;

/** A pin move, checked against where it is now. Pure. */
function checkMove(from, to) {
  const lat = Number(to.lat);
  const lng = Number(to.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new BadInput("That isn't a place on the map.");
  if (km(from, { lat, lng }) > MAX_MOVE_KM) throw new BadInput(`A pin can move at most ${MAX_MOVE_KM} km in one edit.`);
  return { lat, lng };
}

function moderationOps({ reportStore, POLICY, encodeGeohash }) {
  return {
    // Web map editor (gap item 16): every live report and pending map edit inside the view box.
    mapArea: {
      perm: "moderation.read",
      run: async (ctx) => {
        const box = parseBox(ctx.data.box);
        const [recent, fixed, road] = await Promise.all([
          ctx.db.collection("alerts").orderBy("createdAt", "desc").limit(600).get(),
          ctx.db.collection("alerts").where("permanent", "==", true).limit(600).get(),
          ctx.db.collection("roadFeatureReports").where("status", "==", "pending").limit(300).get(),
        ]);
        const seen = new Set();
        const reports = [];
        for (const d of [...fixed.docs, ...recent.docs]) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          const a = d.data();
          if (!inBox(box, a)) continue;
          if (!a.permanent && ms(a.expiresAt) != null && ms(a.expiresAt) < ctx.nowMs) continue;
          reports.push({ id: d.id, type: a.type, item: a.item || null, lat: a.lat, lng: a.lng, comment: a.comment || null, permanent: !!a.permanent, awaitingApproval: !!a.awaitingApproval, confirmCount: a.confirmCount || 0, notThere: a.notThere || 0, createdAtMs: ms(a.createdAt) });
        }
        const mapEdits = road.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => inBox(box, r)).map((r) => ({ id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, speedLimit: r.speedLimit ?? null, confirmCount: r.confirmCount || 0 }));
        return { reports: reports.slice(0, 400), mapEdits };
      },
    },
    moveReport: {
      perm: "moderation.act",
      run: async (ctx) => {
        const alertId = str(ctx.data, "alertId");
        const reason = requireReason(ctx.data);
        const ref = ctx.db.doc(`alerts/${alertId}`);
        const snap = await ref.get();
        if (!snap.exists) throw new BadInput("No such report.", "not-found");
        const a = snap.data();
        const to = checkMove({ lat: a.lat, lng: a.lng }, ctx.data.to || {});
        await ref.update({ lat: to.lat, lng: to.lng, geohash: encodeGeohash(to.lat, to.lng, 9), movedBy: ctx.actor.uid, movedAtMs: ctx.nowMs });
        await ctx.audit({ action: "moderation.moveReport", target: alertId, before: { lat: a.lat, lng: a.lng }, after: to, reason });
        return { ok: true, ...to };
      },
    },
    reports: {
      perm: "moderation.read",
      run: async (ctx) => {
        const snap = await ctx.db.collection("alerts").orderBy("createdAt", "desc").limit(400).get();
        const rows = snap.docs.map((d) => {
          const a = d.data();
          return { id: d.id, type: a.type, item: a.item || null, lat: a.lat, lng: a.lng, comment: a.comment || null, createdBy: a.createdBy || null, createdAtMs: ms(a.createdAt), expiresAtMs: ms(a.expiresAt), confirmCount: a.confirmCount || 0, notThere: a.notThere || 0, needsConfirmation: !!a.needsConfirmation, awaitingApproval: !!a.awaitingApproval, permanent: !!a.permanent, profanity: flagText(a.comment) };
        });
        const uids = [...new Set(rows.map((r) => r.createdBy).filter(Boolean))].slice(0, 300);
        const states = uids.length ? await ctx.db.getAll(...uids.map((u) => ctx.db.doc(`reporterState/${u}`))) : [];
        const trust = Object.fromEntries(states.filter((s) => s.exists).map((s) => [s.id, s.data().trust]));
        rows.forEach((r) => (r.reporterTrust = trust[r.createdBy] ?? null));
        return { reports: filterReports(rows, ctx.data.filter || {}, ctx.nowMs).slice(0, 200) };
      },
    },
    approve: {
      perm: "moderation.act",
      run: async (ctx) => {
        const alertId = str(ctx.data, "alertId");
        const reason = requireReason(ctx.data);
        const result = await reportStore().moderate(alertId, true, ctx.actor.uid, ctx.nowMs);
        await ctx.audit({ action: "moderation.approve", target: alertId, after: { result }, reason });
        return { ok: true, result };
      },
    },
    remove: {
      perm: "moderation.act",
      run: async (ctx) => {
        const alertId = str(ctx.data, "alertId");
        const reason = requireReason(ctx.data);
        const ref = ctx.db.doc(`alerts/${alertId}`);
        const snap = await ref.get();
        if (!snap.exists) throw new BadInput("That report is already gone.", "not-found");
        await ref.delete();
        await ctx.db.collection("moderationLog").add({ alertId, approve: false, by: ctx.actor.uid, atMs: ctx.nowMs });
        const a = snap.data();
        await ctx.audit({ action: "moderation.remove", target: alertId, before: { type: a.type, item: a.item || null, createdBy: a.createdBy || null, comment: a.comment || null }, after: { removed: true }, reason });
        return { ok: true };
      },
    },
    editType: {
      perm: "moderation.act",
      run: async (ctx) => {
        const alertId = str(ctx.data, "alertId");
        const reason = requireReason(ctx.data);
        const item = str(ctx.data, "item");
        const pol = POLICY.items[item];
        if (!pol) throw new BadInput("Unknown report type.");
        const ref = ctx.db.doc(`alerts/${alertId}`);
        const snap = await ref.get();
        if (!snap.exists) throw new BadInput("That report is gone.", "not-found");
        const before = { type: snap.data().type, item: snap.data().item || null };
        await ref.update({ type: pol.type, item });
        await ctx.audit({ action: "moderation.editType", target: alertId, before, after: { type: pol.type, item }, reason });
        return { ok: true };
      },
    },
    banReporter: {
      perm: "moderation.act",
      run: async (ctx) => {
        const uid = str(ctx.data, "uid");
        const reason = requireReason(ctx.data);
        const patch = banPatch(ctx.data.duration, ctx.nowMs);
        const ref = ctx.db.doc(`reporterState/${uid}`);
        const before = await ref.get();
        await ref.set(patch, { merge: true });
        const b = before.exists ? before.data() : {};
        await ctx.audit({ action: "moderation.banReporter", target: uid, before: { reportBanUntil: b.reportBanUntil || 0, reportBanPermanent: !!b.reportBanPermanent }, after: patch, reason });
        return { ok: true, ...patch };
      },
    },
    mapEdits: {
      perm: "moderation.read",
      run: async (ctx) => {
        const [road, place] = await Promise.all([
          ctx.db.collection("roadFeatureReports").where("status", "==", "pending").limit(200).get(),
          ctx.db.collection("placeReports").limit(200).get(),
        ]);
        return {
          roadReports: road.docs.map((d) => ({ id: d.id, kind: d.data().kind, lat: d.data().lat, lng: d.data().lng, confirmCount: d.data().confirmCount || 0, detail: d.data().detail || d.data().note || null, speedLimit: d.data().speedLimit ?? null, reportedBy: d.data().reportedBy, createdAtMs: ms(d.data().createdAt) })),
          placeReports: place.docs.filter((d) => !d.data().resolution).map((d) => ({ id: d.id, placeId: d.data().placeId, reason: d.data().reason, note: d.data().note || null, reportedBy: d.data().reportedBy, createdAtMs: ms(d.data().createdAt) })),
        };
      },
    },
    decideMapEdit: {
      perm: "moderation.act",
      run: async (ctx) => {
        const id = str(ctx.data, "id");
        const reason = requireReason(ctx.data);
        const approve = !!ctx.data.approve;
        const ref = ctx.db.doc(`roadFeatureReports/${id}`);
        const snap = await ref.get();
        if (!snap.exists) throw new BadInput("No such map edit.", "not-found");
        const status = approve ? "approved" : "rejected";
        await ref.update({ status, decidedBy: ctx.actor.uid, decidedAtMs: ctx.nowMs });
        await ctx.audit({ action: "moderation.mapEdit", target: id, before: { status: snap.data().status }, after: { status }, reason });
        return { ok: true, status };
      },
    },
    content: {
      perm: "moderation.read",
      run: async (ctx) => {
        const [photos, chats, names] = await Promise.all([
          ctx.db.collection("placePhotos").where("status", "==", "pending").limit(100).get(),
          ctx.db.collection("alerts").where("item", "==", "mapChats").limit(200).get(),
          ctx.db.collection("presence").limit(500).get(),
        ]);
        return {
          photos: photos.docs.map((d) => ({ id: d.id, placeId: d.data().placeId, storagePath: d.data().storagePath, uploaderUid: d.data().uploaderUid })),
          mapChats: chats.docs.map((d) => ({ id: d.id, comment: d.data().comment || "", createdBy: d.data().createdBy, flagged: flagText(d.data().comment) })).sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0)),
          names: names.docs.filter((d) => d.data().displayName).map((d) => ({ uid: d.id, name: d.data().displayName, flagged: flagText(d.data().displayName) })).filter((n) => n.flagged),
        };
      },
    },
    decidePhoto: {
      perm: "moderation.act",
      run: async (ctx) => {
        const id = str(ctx.data, "id");
        const reason = requireReason(ctx.data);
        const status = ctx.data.approve ? "approved" : "rejected";
        const ref = ctx.db.doc(`placePhotos/${id}`);
        const snap = await ref.get();
        if (!snap.exists) throw new BadInput("No such photo.", "not-found");
        await ref.update({ status, decidedBy: ctx.actor.uid, decidedAtMs: ctx.nowMs });
        await ctx.audit({ action: "moderation.photo", target: id, before: { status: snap.data().status }, after: { status }, reason });
        return { ok: true, status };
      },
    },
    hideName: {
      perm: "moderation.act",
      run: async (ctx) => {
        const uid = str(ctx.data, "uid");
        const reason = requireReason(ctx.data);
        const ref = ctx.db.doc(`presence/${uid}`);
        const snap = await ref.get();
        const before = snap.exists ? snap.data().displayName || null : null;
        if (snap.exists) await ref.update({ displayName: null });
        await ctx.db.doc(`users/${uid}`).set({ nameHiddenByModeration: true }, { merge: true });
        await ctx.audit({ action: "moderation.hideName", target: uid, before: { name: before }, after: { name: null }, reason });
        return { ok: true };
      },
    },
    spam: {
      perm: "moderation.read",
      run: async (ctx) => {
        const snap = await ctx.db.collection("reporterState").limit(2000).get();
        const day = 24 * HOUR;
        const rows = snap.docs.map((d) => {
          const s = d.data();
          const log = (s.log || []).filter((t) => ctx.nowMs - t < day);
          return {
            uid: d.id,
            reportsToday: log.length,
            blockedUntil: s.blockUntil > ctx.nowMs ? s.blockUntil : null,
            trust: s.trust ?? null,
            shadowLimited: typeof s.trust === "number" && s.trust < POLICY.trust.needsConfirmationBelow,
            banned: !!s.reportBanPermanent || (s.reportBanUntil || 0) > ctx.nowMs,
          };
        });
        return {
          hittingLimits: rows.filter((r) => r.reportsToday >= POLICY.maxPerDay * 0.8 || r.blockedUntil).sort((a, b) => b.reportsToday - a.reportsToday).slice(0, 100),
          burstBlocked: rows.filter((r) => r.blockedUntil).length,
          shadowLimited: rows.filter((r) => r.shadowLimited).slice(0, 100),
          banned: rows.filter((r) => r.banned).length,
        };
      },
    },
  };
}

module.exports = { moderationOps, filterReports, priority, parseBox, inBox, checkMove, MAX_MOVE_KM };
