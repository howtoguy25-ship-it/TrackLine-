// Dashboard > Overview, Money + providers, System health. Read-only numbers from real data; a
// number with no source is reported as not available, never estimated.
const { BadInput, requireReason } = require("./staff");

const DAY = 24 * 60 * 60 * 1000;
const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);

/** "2026-11-17" in Sydney time (the business's day). */
function dayKey(t) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

function startOfSydneyDay(t) {
  // Walk back from t to the moment the Sydney date changes (within a day, 15-minute steps).
  const key = dayKey(t);
  let s = t - (t % (15 * 60 * 1000));
  while (dayKey(s - 1) === key) s -= 15 * 60 * 1000;
  return s;
}

/** Sum of the AUD costs in one providerUsage entry (its `costs` map or list). Pure. */
function usageCost(entry) {
  const c = entry && entry.costs;
  if (!c) return 0;
  const vals = Array.isArray(c) ? c.map((x) => (typeof x === "number" ? x : x && (x.aud ?? x.costAud ?? x.cost))) : Object.values(c).map((x) => (typeof x === "number" ? x : x && (x.aud ?? x.costAud ?? x.cost)));
  return vals.filter((n) => typeof n === "number" && isFinite(n)).reduce((a, b) => a + b, 0);
}

/** Per-provider AUD totals from providerUsage entries. Pure. */
function costsByProvider(entries) {
  const out = {};
  for (const e of entries) {
    const c = e.costs;
    if (!c || typeof c !== "object") continue;
    for (const [k, v] of Array.isArray(c) ? c.map((x) => [x.provider || "other", x]) : Object.entries(c)) {
      const n = typeof v === "number" ? v : v && (v.aud ?? v.costAud ?? v.cost);
      if (typeof n === "number" && isFinite(n)) out[k] = Math.round(((out[k] || 0) + n) * 100) / 100;
    }
  }
  return out;
}

/** Coarse usage map: 0.1 degree cells (~10 km) with at least `min` installs. No individuals. Pure. */
function usageCells(sessions, min = 5) {
  const cells = {};
  for (const s of sessions) {
    if (typeof s.approxLat !== "number" || typeof s.approxLng !== "number") continue;
    const lat = Math.floor(s.approxLat * 10) / 10;
    const lng = Math.floor(s.approxLng * 10) / 10;
    const k = `${lat}:${lng}`;
    cells[k] = cells[k] || { lat: lat + 0.05, lng: lng + 0.05, count: 0, city: s.city || null };
    cells[k].count++;
  }
  return Object.values(cells).filter((c) => c.count >= min);
}

/** Budget alerts: providers whose month-to-date spend passed the budget set in App control. Pure. */
function budgetAlerts(spend, budgets) {
  return Object.entries(budgets || {})
    .filter(([p, b]) => typeof b === "number" && (spend[p] || 0) > b)
    .map(([p, b]) => ({ kind: "budget", provider: p, spentAud: spend[p], budgetAud: b }));
}

async function count(q) {
  const r = await q.count().get();
  return r.data().count;
}

async function priceAud(db) {
  const cfg = await db.doc("config/vehicleCheck").get();
  const tier = cfg.exists ? String(cfg.data().priceTier || "19.99") : "19.99";
  return { tier, aud: tier === "24.99" ? 24.99 : 19.99 };
}

async function sentryCrashFree(sentry) {
  if (!sentry || !sentry.token || sentry.token === "unset" || !sentry.org || !sentry.project) return { available: false, reason: "Sentry stats need SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT (ADMIN.md)." };
  try {
    const url = `https://sentry.io/api/0/organizations/${encodeURIComponent(sentry.org)}/sessions/?project=${encodeURIComponent(sentry.project)}&field=crash_free_rate(session)&statsPeriod=1d&interval=1d`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${sentry.token}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { available: false, reason: `Sentry returned HTTP ${res.status}.` };
    const json = await res.json();
    const v = json && json.groups && json.groups[0] && json.groups[0].totals && json.groups[0].totals["crash_free_rate(session)"];
    return typeof v === "number" ? { available: true, percent: Math.round(v * 10000) / 100 } : { available: false, reason: "Sentry had no session data for today." };
  } catch (err) {
    return { available: false, reason: `Couldn't reach Sentry (${String(err.message).slice(0, 60)}).` };
  }
}

function insightsOps({ sentry, jobs }) {
  return {
    overview: {
      perm: "overview.read",
      run: async (ctx) => {
        const { db, nowMs } = ctx;
        const sessions = db.collection("deviceSessions");
        const dayStart = startOfSydneyDay(nowMs);
        const at = (t) => new Date(t);
        const [onlineNow, dau, mau, guests, signedIn, newInstalls, linkedToday, reportsToday, openTickets, awaiting, pendingRoad, pendingPhotos, purchasesToday, purchasesMonth, todayStats] = await Promise.all([
          count(sessions.where("lastActiveAt", ">", at(nowMs - 5 * 60 * 1000))),
          count(sessions.where("lastActiveAt", ">", at(nowMs - DAY))),
          count(sessions.where("lastActiveAt", ">", at(nowMs - 30 * DAY))),
          count(sessions.where("isAnonymous", "==", true)),
          count(sessions.where("isAnonymous", "==", false)),
          count(sessions.where("firstOpenAt", ">=", at(dayStart))),
          count(sessions.where("linkedAt", ">=", at(dayStart))),
          count(db.collection("alerts").where("createdAt", ">=", at(dayStart))),
          count(db.collection("supportTickets").where("status", "in", ["new", "waiting"])),
          count(db.collection("alerts").where("awaitingApproval", "==", true)),
          count(db.collection("roadFeatureReports").where("status", "==", "pending")),
          count(db.collection("placePhotos").where("status", "==", "pending")),
          count(db.collection("vehicleCheckPurchases").where("at", ">=", dayStart)),
          count(db.collection("vehicleCheckPurchases").where("at", ">=", nowMs - 30 * DAY)),
          db.doc(`statsDaily/${dayKey(nowMs)}`).get(),
        ]);
        const price = await priceAud(db);
        const range = [7, 30, 90].includes(ctx.data.days) ? ctx.data.days : 30;
        const statsSnap = await db.collection("statsDaily").where("day", ">=", dayKey(nowMs - range * DAY)).orderBy("day").get();
        const sessionSample = await sessions.where("lastActiveAt", ">", at(nowMs - 7 * DAY)).limit(20000).get();
        const today = todayStats.exists ? todayStats.data() : {};
        const alerts = [];
        const errs = await db.collection("opsErrors").where("atMs", ">", nowMs - DAY).limit(500).get();
        if (errs.size) alerts.push({ kind: "functionErrors", count: errs.size });
        const blocked = await count(db.collection("reporterState").where("blockUntil", ">", nowMs));
        if (blocked >= 10) alerts.push({ kind: "spamSpike", blockedReporters: blocked });
        for (const id of ["revCheckStatus", "plateLookupStatus", "plateRecognizerStatus"]) {
          const s = await db.doc(`config/${id}`).get();
          if (s.exists && (s.data().lastError || s.data().status === "error")) alerts.push({ kind: "apiKey", source: id, message: String(s.data().lastError || s.data().message || "error").slice(0, 120) });
        }
        const cfg = await db.doc("appConfig/current").get();
        const monthUsage = await db.collection("providerUsage").where("at", ">=", nowMs - 30 * DAY).limit(5000).get();
        alerts.push(...budgetAlerts(costsByProvider(monthUsage.docs.map((d) => d.data())), cfg.exists ? cfg.data().budgets?.monthlyAud : {}));
        const total = guests + signedIn;
        return {
          cards: {
            onlineNow,
            dailyActive: dau,
            monthlyActive: mau,
            newInstallsToday: newInstalls,
            newAccountsToday: today.newAccounts || 0,
            guests,
            signedIn,
            guestConversionPercent: total ? Math.round((signedIn / total) * 1000) / 10 : null,
            linkedToday,
            tripsToday: today.trips || 0,
            reportsToday,
            vehicleChecksToday: purchasesToday,
            vehicleChecks30d: purchasesMonth,
            revenueToday: Math.round(purchasesToday * price.aud * 100) / 100,
            revenue30d: Math.round(purchasesMonth * price.aud * 100) / 100,
            crashFree: await sentryCrashFree(sentry && sentry()),
            openTickets,
            pendingModeration: awaiting + pendingRoad + pendingPhotos,
          },
          priceNote: `Revenue = checks sold x A$${price.aud} (price tier ${price.tier}), before Apple/Google fees.`,
          series: statsSnap.docs.map((d) => d.data()),
          usageCells: usageCells(sessionSample.docs.map((d) => d.data())),
          alerts,
        };
      },
    },
    money: {
      perm: "money.read",
      run: async (ctx) => {
        const { db, nowMs } = ctx;
        const days = [7, 30, 90].includes(ctx.data.days) ? ctx.data.days : 30;
        const since = nowMs - days * DAY;
        const [purchases, usage, credits, refunds, poiBudget, persona] = await Promise.all([
          db.collection("vehicleCheckPurchases").where("at", ">=", since).limit(10000).get(),
          db.collection("providerUsage").where("at", ">=", since).limit(10000).get(),
          db.collection("vehicleCheckCredits").limit(5000).get(),
          db.collection("refundNotes").where("atMs", ">=", since).limit(1000).get(),
          db.collection("poiLookupBudget").limit(100).get(),
          db.collection("personaUsage").limit(5000).get(),
        ]);
        const price = await priceAud(db);
        const byDay = {};
        purchases.docs.forEach((d) => {
          const p = d.data();
          if (p.sandbox) return;
          const k = dayKey(p.at);
          byDay[k] = byDay[k] || { day: k, sold: 0, revenueAud: 0, providerCostAud: 0 };
          byDay[k].sold++;
          byDay[k].revenueAud = Math.round((byDay[k].revenueAud + price.aud) * 100) / 100;
        });
        usage.docs.forEach((d) => {
          const u = d.data();
          const k = dayKey(u.at);
          byDay[k] = byDay[k] || { day: k, sold: 0, revenueAud: 0, providerCostAud: 0 };
          byDay[k].providerCostAud = Math.round((byDay[k].providerCostAud + usageCost(u)) * 100) / 100;
        });
        const rows = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ ...r, profitAud: Math.round((r.revenueAud - r.providerCostAud) * 100) / 100 }));
        const sold = rows.reduce((a, r) => a + r.sold, 0);
        const providerCost = Math.round(rows.reduce((a, r) => a + r.providerCostAud, 0) * 100) / 100;
        const staffGrants = credits.docs.flatMap((d) => (d.data().history || []).filter((h) => h.reason === "staff_grant" && h.at >= since).map((h) => ({ uid: d.id, ...h })));
        return {
          days,
          rows,
          totals: { sold, revenueAud: Math.round(sold * price.aud * 100) / 100, providerCostAud: providerCost, costPerCheckAud: sold ? Math.round((providerCost / sold) * 100) / 100 : null },
          providers: costsByProvider(usage.docs.map((d) => d.data())),
          creditsGranted: staffGrants,
          refundNotes: refunds.docs.map((d) => d.data()),
          apiUsage: {
            googlePlaces: poiBudget.docs.map((d) => ({ id: d.id, ...d.data() })),
            elevenLabsUsers: persona.size,
            notTracked: ["Mapbox (see the Mapbox account dashboard)", "TfNSW Open Data (free; usage in the TfNSW developer portal)", "map matching (Mapbox)", "AdMob (needs AdMob reporting connected)"],
          },
          priceNote: `Revenue = non-sandbox checks x A$${price.aud}, before Apple/Google fees.`,
        };
      },
    },
    health: {
      perm: "health.read",
      run: async (ctx) => {
        const { db, nowMs } = ctx;
        const [sources, traffic, errs, versions] = await Promise.all([
          db.collection("dataSources").limit(50).get(),
          db.collection("trafficNsw").limit(20).get(),
          db.collection("opsErrors").where("atMs", ">", nowMs - DAY).limit(500).get(),
          db.collection("deviceSessions").where("lastActiveAt", ">", new Date(nowMs - 30 * DAY)).select("appVersion", "platform").limit(50000).get(),
        ]);
        const byFn = {};
        errs.docs.forEach((d) => {
          const e = d.data();
          byFn[e.fn] = byFn[e.fn] || { fn: e.fn, count: 0, last: null, lastMessage: null };
          byFn[e.fn].count++;
          if (!byFn[e.fn].last || e.atMs > byFn[e.fn].last) {
            byFn[e.fn].last = e.atMs;
            byFn[e.fn].lastMessage = e.message;
          }
        });
        const appVersions = {};
        versions.docs.forEach((d) => {
          const k = `${d.data().platform || "?"} ${d.data().appVersion || "unknown"}`;
          appVersions[k] = (appVersions[k] || 0) + 1;
        });
        return {
          feeds: [
            ...sources.docs.map((d) => ({ id: d.id, updatedAtMs: ms(d.data().updatedAt), detail: d.data().zones != null ? `${d.data().zones} zones` : d.data().status || null })),
            ...traffic.docs.map((d) => ({ id: `trafficNsw/${d.id}`, updatedAtMs: ms(d.data().fetchedAt || d.data().updatedAt), detail: d.data().failed && d.data().failed.length ? `failed: ${d.data().failed.join(", ")}` : null })),
          ],
          functionErrors: Object.values(byFn).sort((a, b) => b.count - a.count),
          appVersions,
          crashFree: await sentryCrashFree(sentry && sentry()),
          latencyNote: "Function latency is in Google Cloud Console > Cloud Run > each function > Metrics.",
        };
      },
    },
    run: {
      perm: "health.run",
      run: async (ctx) => {
        const reason = requireReason(ctx.data);
        const job = ctx.data.job;
        let result;
        if (job === "refreshSchoolZones") result = await jobs.refreshSchoolZones();
        else if (job === "resyncHazards") result = await jobs.resyncHazards();
        else if (job === "clearCache") {
          const allowed = { vehicleCheckCache: "vehicleCheckCache", poiPopularity: "poiPopularity" };
          const coll = allowed[ctx.data.cache];
          if (!coll) throw new BadInput("Cache is vehicleCheckCache or poiPopularity.");
          const snap = await ctx.db.collection(coll).limit(2000).get();
          for (let i = 0; i < snap.docs.length; i += 400) {
            const b = ctx.db.batch();
            snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
            await b.commit();
          }
          result = { cleared: snap.size, cache: coll };
        } else throw new BadInput("Job is refreshSchoolZones, resyncHazards or clearCache.");
        await ctx.audit({ action: "health.run", target: job, after: result, reason });
        return { ok: true, result };
      },
    },
  };
}

module.exports = { insightsOps, usageCost, costsByProvider, usageCells, budgetAlerts, dayKey, startOfSydneyDay };
