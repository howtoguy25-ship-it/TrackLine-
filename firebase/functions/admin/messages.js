// Dashboard > Messages: in-app inbox, home-map banner, full-screen announcement and push.
//
// Audience is worked out from deviceSessions/{uid} (one per install; the app writes platform,
// app version, country/state, a rounded last location, which features are on, and the
// driver's Notification settings). A user who switched a category off never gets a message in
// it, on any channel. Each delivery is users/{uid}/inbox/{campaignId}; push goes through Expo.
const { BadInput, requireReason } = require("./staff");

const CATEGORIES = Object.freeze({
  fun: { label: "Fun announcements" },
  news: { label: "News & updates" },
  traffic: { label: "Traffic advisories" },
  account: { label: "Account & security", required: true }, // can't be switched off
});
const CHANNELS = ["push", "inbox", "banner", "fullscreen"];
// Deep links the app knows how to open (src/navigation/deepLinks.ts).
const DEEP_LINKS = ["trackline://settings", "trackline://settings/notifications", "trackline://inbox", "trackline://vehicle-check", "trackline://travel", "trackline://trackys", "trackline://update", "trackline://help", "trackline://account"];
const LANGS = ["en", "es", "fr", "de", "zh", "ar", "vi", "it", "el", "ko", "hi", "ja"];

const TEMPLATES = Object.freeze({
  update: { name: "New update available", category: "news", channels: ["push", "inbox", "banner"], title: "A new TrackLine update is ready", body: "Update from the App Store or Google Play to get the latest fixes and features.", button: { label: "Update", deepLink: "trackline://update" } },
  roadClosure: { name: "Road closure in your area", category: "traffic", channels: ["push", "inbox"], title: "Road closure near you", body: "", button: null },
  maintenance: { name: "Maintenance", category: "news", channels: ["inbox", "banner"], title: "Planned maintenance", body: "Some features may be unavailable for a short time.", button: null },
  newFeature: { name: "New feature", category: "news", channels: ["inbox", "fullscreen"], title: "New in TrackLine", body: "", button: { label: "Take a look", deepLink: "trackline://settings" } },
});

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validated message content. Throws BadInput. Pure. */
function validateMessage(m = {}) {
  const title = clean(m.title, 80);
  const body = clean(m.body, 600);
  if (!title || !body) throw new BadInput("A message needs a title and a body.");
  const category = m.category;
  if (!CATEGORIES[category]) throw new BadInput("Pick a category (fun, news, traffic, account).");
  const channels = Array.isArray(m.channels) ? [...new Set(m.channels.filter((c) => CHANNELS.includes(c)))] : [];
  if (!channels.length) throw new BadInput("Pick at least one channel.");
  let imageUrl = null;
  if (m.imageUrl) {
    if (typeof m.imageUrl !== "string" || !/^https:\/\/[^\s]+$/.test(m.imageUrl)) throw new BadInput("The image must be an https:// link.");
    imageUrl = m.imageUrl.slice(0, 500);
  }
  let button = null;
  if (m.button && (m.button.label || m.button.deepLink)) {
    const label = clean(m.button.label, 30);
    if (!label || !DEEP_LINKS.includes(m.button.deepLink)) throw new BadInput(`A button needs a label and one of: ${DEEP_LINKS.join(", ")}.`);
    button = { label, deepLink: m.button.deepLink };
  }
  const translations = {};
  for (const [lang, t] of Object.entries(m.translations || {})) {
    if (!LANGS.includes(lang) || lang === "en") continue;
    const tt = clean(t && t.title, 80);
    const tb = clean(t && t.body, 600);
    if (tt && tb) translations[lang] = { title: tt, body: tb, ...(t.buttonLabel ? { buttonLabel: clean(t.buttonLabel, 30) } : {}) };
  }
  return { title, body, category, channels, imageUrl, button, translations };
}

function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

function km(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Validated audience. Every filter given must match (AND). Pure. */
function validateAudience(a = {}) {
  const out = {};
  if (a.uid) out.uid = clean(a.uid, 128);
  if (a.country) out.country = clean(a.country, 2).toUpperCase();
  if (a.state) out.state = clean(a.state, 10).toUpperCase();
  if (a.platform) {
    if (!["ios", "android", "web"].includes(a.platform)) throw new BadInput("Platform must be ios, android or web.");
    out.platform = a.platform;
  }
  if (a.minAppVersion) out.minAppVersion = clean(a.minAppVersion, 20);
  if (a.maxAppVersion) out.maxAppVersion = clean(a.maxAppVersion, 20);
  if (a.signedIn === true || a.signedIn === false) out.signedIn = a.signedIn;
  if (a.feature) out.feature = clean(a.feature, 40);
  if (a.radius) {
    const { lat, lng, km: r } = a.radius;
    if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180 || typeof r !== "number" || r <= 0 || r > 500) {
      throw new BadInput("A radius needs a centre and 1-500 km.");
    }
    out.radius = { lat, lng, km: r };
  }
  return out;
}

/** Does this install get the message? Respects the driver's Notification settings. Pure. */
function inAudience(session, audience, category) {
  if (!session) return false;
  const prefs = session.notificationPrefs || {};
  if (!CATEGORIES[category]?.required && prefs[category] === false) return false;
  if (audience.uid && session.uid !== audience.uid) return false;
  if (audience.country && session.country !== audience.country) return false;
  if (audience.state && session.state !== audience.state) return false;
  if (audience.platform && session.platform !== audience.platform) return false;
  if (audience.minAppVersion && (!session.appVersion || compareVersions(session.appVersion, audience.minAppVersion) < 0)) return false;
  if (audience.maxAppVersion && (!session.appVersion || compareVersions(session.appVersion, audience.maxAppVersion) > 0)) return false;
  if (audience.signedIn === true && session.isAnonymous !== false) return false;
  if (audience.signedIn === false && session.isAnonymous !== true) return false;
  if (audience.feature && !(session.features && session.features[audience.feature] === true)) return false;
  if (audience.radius) {
    if (typeof session.approxLat !== "number" || typeof session.approxLng !== "number") return false;
    if (km(audience.radius, { lat: session.approxLat, lng: session.approxLng }) > audience.radius.km) return false;
  }
  return true;
}

async function matchingSessions(db, audience, category) {
  if (audience.uid) {
    const s = await db.doc(`deviceSessions/${audience.uid}`).get();
    const session = s.exists ? { uid: s.id, ...s.data() } : null;
    return session && inAudience(session, audience, category) ? [session] : [];
  }
  const snap = await db.collection("deviceSessions").limit(50000).get();
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((s) => inAudience(s, audience, category));
}

function inboxDoc(msg, campaignId, nowMs) {
  return {
    campaignId: campaignId || null,
    title: msg.title,
    body: msg.body,
    category: msg.category,
    channels: msg.channels || ["inbox"],
    imageUrl: msg.imageUrl || null,
    button: msg.button || null,
    translations: msg.translations || {},
    from: msg.from || "TrackLine",
    createdAtMs: nowMs,
    openedAtMs: null,
    clickedAtMs: null,
    dismissedAtMs: null,
  };
}

/** One message straight to one user's inbox (support replies, account notices). */
async function deliverToUser(db, uid, { title, body, channel = "inbox", category = "account", from = "TrackLine", nowMs = Date.now() }) {
  const ref = db.collection(`users/${uid}/inbox`).doc();
  await ref.set(inboxDoc({ title, body, category, channels: [channel], from }, null, nowMs));
  return ref.id;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function pushAll(messages, fetchImpl = fetch) {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(batch) });
      const json = await res.json().catch(() => null);
      const tickets = Array.isArray(json && json.data) ? json.data : [];
      tickets.forEach((t) => (t && t.status === "ok" ? ok++ : failed++));
      failed += Math.max(0, batch.length - tickets.length);
    } catch {
      failed += batch.length;
    }
  }
  return { ok, failed };
}

/** Sends one campaign now. Returns counts. Push is skipped in the emulator (no real devices). */
async function sendCampaign(db, campaignId, nowMs, { push = pushAll } = {}) {
  const ref = db.doc(`campaigns/${campaignId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new BadInput("No such message.", "not-found");
  const c = snap.data();
  if (c.status !== "scheduled" && c.status !== "sending") return { skipped: c.status };
  await ref.update({ status: "sending" });
  const sessions = await matchingSessions(db, c.audience, c.message.category);
  const inAppChannels = c.message.channels.filter((ch) => ch !== "push");
  let delivered = 0;
  if (inAppChannels.length) {
    for (let i = 0; i < sessions.length; i += 400) {
      const b = db.batch();
      sessions.slice(i, i + 400).forEach((s) => b.set(db.doc(`users/${s.uid}/inbox/${campaignId}`), inboxDoc({ ...c.message, channels: c.message.channels }, campaignId, nowMs)));
      await b.commit();
      delivered += Math.min(400, sessions.length - i);
    }
  }
  let pushed = { ok: 0, failed: 0 };
  if (c.message.channels.includes("push")) {
    const msgs = sessions
      .filter((s) => typeof s.expoPushToken === "string" && s.expoPushToken.startsWith("ExponentPushToken"))
      .map((s) => {
        const t = (s.language && c.message.translations[s.language]) || c.message;
        return { to: s.expoPushToken, title: t.title, body: t.body, sound: "default", data: { campaignId, deepLink: c.message.button ? c.message.button.deepLink : "trackline://inbox" } };
      });
    if (msgs.length && process.env.FUNCTIONS_EMULATOR !== "true") pushed = await push(msgs);
    else pushed = { ok: 0, failed: 0, skipped: msgs.length };
  }
  const stats = { targeted: sessions.length, delivered, pushSent: pushed.ok, pushFailed: pushed.failed, opened: 0, clicked: 0 };
  await ref.update({ status: "sent", sentAtMs: nowMs, stats });
  return stats;
}

function messagesOps() {
  return {
    templates: { perm: "messages.read", run: async () => ({ templates: TEMPLATES, categories: CATEGORIES, channels: CHANNELS, deepLinks: DEEP_LINKS, languages: LANGS }) },
    estimate: {
      perm: "messages.read",
      run: async (ctx) => {
        const audience = validateAudience(ctx.data.audience);
        const category = CATEGORIES[ctx.data.category] ? ctx.data.category : "news";
        const sessions = await matchingSessions(ctx.db, audience, category);
        return { users: sessions.length, withPush: sessions.filter((s) => typeof s.expoPushToken === "string" && s.expoPushToken.startsWith("ExponentPushToken")).length };
      },
    },
    list: {
      perm: "messages.read",
      run: async (ctx) => {
        const snap = await ctx.db.collection("campaigns").orderBy("createdAtMs", "desc").limit(100).get();
        return { campaigns: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
      },
    },
    send: {
      perm: "messages.send",
      run: async (ctx) => {
        const message = validateMessage(ctx.data.message);
        const audience = validateAudience(ctx.data.audience);
        const reason = requireReason(ctx.data);
        const sendAtMs = typeof ctx.data.sendAtMs === "number" && ctx.data.sendAtMs > ctx.nowMs ? ctx.data.sendAtMs : null;
        const ref = await ctx.db.collection("campaigns").add({ message, audience, status: "scheduled", sendAtMs: sendAtMs || ctx.nowMs, createdAtMs: ctx.nowMs, createdBy: ctx.actor.uid, stats: null });
        await ctx.audit({ action: "messages.send", target: ref.id, after: { title: message.title, category: message.category, channels: message.channels, audience, sendAtMs }, reason });
        if (sendAtMs) return { ok: true, id: ref.id, scheduled: true, sendAtMs };
        const stats = await sendCampaign(ctx.db, ref.id, ctx.nowMs);
        return { ok: true, id: ref.id, scheduled: false, stats };
      },
    },
    cancel: {
      perm: "messages.send",
      run: async (ctx) => {
        const id = clean(ctx.data.id, 100);
        const reason = requireReason(ctx.data);
        const ref = ctx.db.doc(`campaigns/${id}`);
        const snap = await ref.get();
        if (!snap.exists || snap.data().status !== "scheduled") throw new BadInput("Only a scheduled message that hasn't gone out can be cancelled.");
        await ref.update({ status: "cancelled", cancelledAtMs: ctx.nowMs });
        await ctx.audit({ action: "messages.cancel", target: id, before: { status: "scheduled" }, after: { status: "cancelled" }, reason });
        return { ok: true };
      },
    },
  };
}

/** The app reports opened / clicked / dismissed once per message (counted once per user). */
async function recordInboxEvent(db, FieldValue, uid, { id, event }, nowMs) {
  const field = { opened: "openedAtMs", clicked: "clickedAtMs", dismissed: "dismissedAtMs" }[event];
  if (!field || typeof id !== "string" || !id) throw new BadInput("Unknown inbox event.");
  const ref = db.doc(`users/${uid}/inbox/${id}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { counted: false };
    const doc = snap.data();
    if (doc[field]) return { counted: false };
    tx.update(ref, { [field]: nowMs, ...(event === "clicked" && !doc.openedAtMs ? { openedAtMs: nowMs } : {}) });
    if (doc.campaignId && event !== "dismissed") {
      const inc = { [`stats.${event}`]: FieldValue.increment(1) };
      if (event === "clicked" && !doc.openedAtMs) inc["stats.opened"] = FieldValue.increment(1);
      tx.update(db.doc(`campaigns/${doc.campaignId}`), inc);
    }
    return { counted: true };
  });
}

module.exports = { CATEGORIES, CHANNELS, DEEP_LINKS, TEMPLATES, validateMessage, validateAudience, inAudience, compareVersions, sendCampaign, deliverToUser, messagesOps, recordInboxEvent, pushAll, matchingSessions };
