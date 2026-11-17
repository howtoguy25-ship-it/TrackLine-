// Dashboard > App control: remote config the app reads from appConfig/current (no new build).
// Every change is validated, kept as a version in appConfigHistory (so it can be rolled back),
// and audited.
const { BadInput, requireReason } = require("./staff");
const { compareVersions } = require("./messages");

// Features the app checks with isFeatureOn() (src/services/appConfig.ts).
const FEATURES = ["vehicleCheck", "trackys", "travelModes", "laneGuidance", "schoolZones", "brandBadges", "ads", "voiceSearch", "characterVoices", "liveTraffic"];

const DEFAULT_CONFIG = Object.freeze({
  version: 0,
  flags: Object.fromEntries(FEATURES.map((f) => [f, { enabled: true, percent: 100, countries: [] }])),
  minVersion: { ios: { soft: null, force: null }, android: { soft: null, force: null } },
  maintenance: { mode: "off", message: "" }, // off | banner | block
  tunables: {
    vehicleCheckPriceTier: "19.99",
    adFrequency: { appOpenMinMinutes: 240, maxPerDay: 3 },
    reports: { maxPerHour: 10, maxPerDay: 30 },
    stillThere: { askAfterMinutes: 20 },
  },
  whatsNew: { version: null, title: "", items: [] },
  budgets: { monthlyAud: {} }, // provider -> AUD per month, for the over-budget alert
});

const isVersion = (v) => v === null || (typeof v === "string" && /^\d+(\.\d+){0,3}$/.test(v));
const int = (v, lo, hi, name) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new BadInput(`${name} must be a whole number from ${lo} to ${hi}.`);
  return v;
};

/** The full, validated config (missing parts filled from the defaults). Throws BadInput. Pure. */
function validateConfig(input = {}) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const flags = input.flags || {};
  for (const [key, f] of Object.entries(flags)) {
    if (!FEATURES.includes(key)) throw new BadInput(`Unknown feature: ${key}.`);
    const countries = Array.isArray(f.countries) ? f.countries.map((c) => String(c).toUpperCase()) : [];
    if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw new BadInput("Countries are 2-letter codes, like AU.");
    out.flags[key] = { enabled: f.enabled !== false, percent: int(f.percent ?? 100, 0, 100, `${key} rollout %`), countries };
  }
  for (const p of ["ios", "android"]) {
    const mv = (input.minVersion || {})[p] || {};
    if (!isVersion(mv.soft ?? null) || !isVersion(mv.force ?? null)) throw new BadInput("Versions look like 1.4.0.");
    if (mv.soft && mv.force && compareVersions(mv.force, mv.soft) > 0) throw new BadInput(`${p}: the forced version can't be above the soft one.`);
    out.minVersion[p] = { soft: mv.soft || null, force: mv.force || null };
  }
  const m = input.maintenance || {};
  if (m.mode && !["off", "banner", "block"].includes(m.mode)) throw new BadInput("Maintenance mode is off, banner or block.");
  out.maintenance = { mode: m.mode || "off", message: typeof m.message === "string" ? m.message.trim().slice(0, 300) : "" };
  if (out.maintenance.mode !== "off" && !out.maintenance.message) throw new BadInput("Write the message users will see.");
  const t = input.tunables || {};
  if (t.vehicleCheckPriceTier !== undefined) {
    if (!["19.99", "24.99"].includes(t.vehicleCheckPriceTier)) throw new BadInput("Vehicle Check price tier is 19.99 or 24.99 (the store products that exist).");
    out.tunables.vehicleCheckPriceTier = t.vehicleCheckPriceTier;
  }
  if (t.adFrequency) {
    out.tunables.adFrequency = { appOpenMinMinutes: int(t.adFrequency.appOpenMinMinutes, 30, 1440, "Minutes between app-open ads"), maxPerDay: int(t.adFrequency.maxPerDay, 0, 10, "Ads per day") };
  }
  if (t.reports) out.tunables.reports = { maxPerHour: int(t.reports.maxPerHour, 1, 30, "Reports per hour"), maxPerDay: int(t.reports.maxPerDay, 1, 100, "Reports per day") };
  if (t.stillThere) out.tunables.stillThere = { askAfterMinutes: int(t.stillThere.askAfterMinutes, 5, 240, "Still there? after") };
  const w = input.whatsNew || {};
  if (w.version) {
    if (!isVersion(w.version)) throw new BadInput("What's New version looks like 1.4.0.");
    const items = Array.isArray(w.items) ? w.items.map((s) => String(s).trim().slice(0, 140)).filter(Boolean).slice(0, 8) : [];
    if (!items.length) throw new BadInput("Add at least one line to What's New.");
    out.whatsNew = { version: w.version, title: String(w.title || "What's new").slice(0, 60), items };
  }
  const b = (input.budgets && input.budgets.monthlyAud) || {};
  for (const [provider, aud] of Object.entries(b)) {
    if (!/^[a-zA-Z0-9_-]{2,30}$/.test(provider) || typeof aud !== "number" || aud < 0 || aud > 100000) throw new BadInput("Budgets are AUD amounts per provider.");
    out.budgets.monthlyAud[provider] = aud;
  }
  return out;
}

function configOps() {
  const read = async (db) => {
    const snap = await db.doc("appConfig/current").get();
    return snap.exists ? snap.data() : { ...DEFAULT_CONFIG };
  };
  const write = async (ctx, next, action, reason, extra = {}) => {
    const before = await read(ctx.db);
    const version = (before.version || 0) + 1;
    const doc = { ...next, version, updatedAtMs: ctx.nowMs, updatedBy: ctx.actor.uid };
    await ctx.db.doc("appConfig/current").set(doc);
    await ctx.db.doc(`appConfigHistory/v${String(version).padStart(6, "0")}`).set({ config: doc, atMs: ctx.nowMs, by: ctx.actor.uid, reason, ...extra });
    const { updatedAtMs: _a, updatedBy: _b, ...b } = before;
    await ctx.audit({ action, target: "appConfig", before: b, after: next, reason });
    return doc;
  };
  return {
    get: {
      perm: "config.read",
      run: async (ctx) => {
        const history = await ctx.db.collection("appConfigHistory").orderBy("atMs", "desc").limit(30).get();
        return { config: await read(ctx.db), features: FEATURES, history: history.docs.map((d) => ({ id: d.id, atMs: d.data().atMs, by: d.data().by, reason: d.data().reason, version: d.data().config.version })) };
      },
    },
    set: {
      perm: "config.write",
      run: async (ctx) => {
        const reason = requireReason(ctx.data);
        const next = validateConfig(ctx.data.config);
        return { ok: true, config: await write(ctx, next, "config.write", reason) };
      },
    },
    rollback: {
      perm: "config.write",
      run: async (ctx) => {
        const reason = requireReason(ctx.data);
        const id = typeof ctx.data.historyId === "string" ? ctx.data.historyId : "";
        const snap = await ctx.db.doc(`appConfigHistory/${id}`).get();
        if (!snap.exists) throw new BadInput("No such saved version.", "not-found");
        const { version: _v, updatedAtMs: _a, updatedBy: _b, ...cfg } = snap.data().config;
        return { ok: true, config: await write(ctx, validateConfig(cfg), "config.rollback", reason, { rolledBackTo: id }) };
      },
    },
  };
}

module.exports = { FEATURES, DEFAULT_CONFIG, validateConfig, configOps };
