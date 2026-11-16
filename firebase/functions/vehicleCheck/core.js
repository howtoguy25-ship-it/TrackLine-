// The full check, start to finish, with every outside dependency passed in (store, providers,
// receipt verifier, clock) so it runs the same against Firestore in production and an
// in-memory store in tests.
//
// Order of things (each step only after the one before succeeded):
//   1. the query is valid and in Australia            -> else nothing happens, nothing charged
//   2. the purchase verifies with Apple/Google         -> BEFORE any paid provider call
//   3. the purchase is claimed for exactly one report  -> a repeat gets the same report back
//   4. sections load (cache first, then providers, each retried once), progress written live
//   5. no core section loaded at all -> a free re-check credit, and the user is told
//   6. the cost of every paid call is logged to providerUsage

const crypto = require("crypto");
const { SECTIONS, mergeConfig } = require("./config");
const { parseQuery } = require("./query");
const { buildAdapters } = require("./providers");
const { gradeSection } = require("./grade");
const { ProviderError } = require("./errors");

const REPORT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function newReportId() {
  return crypto.randomBytes(12).toString("hex");
}

function today(now) {
  return now().toISOString().slice(0, 10);
}

function loadingSections() {
  const out = {};
  for (const s of SECTIONS) out[s.key] = { status: "loading" };
  return out;
}

/** Calls one section's provider, retrying once on a temporary failure. */
async function loadSection(section, adapter, query, deps) {
  if (!adapter || typeof adapter[section.method] !== "function") {
    return { status: "unavailable", reason: "No provider is set up for this section." };
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await adapter[section.method](query);
      const { grade, summary } = gradeSection(section.key, result.data, today(deps.now));
      const out = { status: "ok", grade, summary, source: result.source, asAt: result.asAt, data: result.data };
      // Firestore refuses undefined values, so recalls only appear when a provider sent some.
      if (Array.isArray(result.recalls)) out.recalls = result.recalls;
      return out;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ProviderError) || !err.retryable) break;
      if (attempt === 0 && deps.sleep) await deps.sleep(deps.retryDelayMs ?? 1500);
    }
  }
  if (lastErr instanceof ProviderError && lastErr.kind === "not_configured") {
    return { status: "unavailable", reason: lastErr.message };
  }
  if (lastErr instanceof ProviderError && lastErr.kind === "not_found") {
    return { status: "failed", notFound: true, error: lastErr.message, retries: 0 };
  }
  console.warn(`vehicleCheck: ${section.key} failed`, lastErr?.message ?? lastErr);
  return { status: "failed", error: "Couldn't load", retries: 0 };
}

function recallsSection(ppsr) {
  if (!ppsr || ppsr.status !== "ok" || !Array.isArray(ppsr.recalls)) return null;
  const { grade, summary } = gradeSection("recalls", { recalls: ppsr.recalls }, "");
  return { status: "ok", grade, summary, source: ppsr.source, asAt: ppsr.asAt, data: { recalls: ppsr.recalls } };
}

function overallStatus(sections) {
  const all = Object.values(sections);
  return all.every((s) => s.status === "ok") ? "complete" : "partial";
}

/** Runs every section for a query; writes progress through onSection. */
async function runSections(query, config, deps, onSection) {
  const { bySection, instances } = buildAdapters(config, deps);
  const sections = {};
  const byKey = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
  const base = { ...query, decodeVin: config.decodeVin };

  // Vehicle first: it gives the VIN that PPSR and odometer need for a plate query.
  sections.vehicle = await loadSection(byKey.vehicle, bySection.vehicle, base, deps);
  await onSection("vehicle", sections.vehicle);
  if (sections.vehicle.notFound) {
    // Not on the register: nothing else to look up (and nothing more to pay for).
    for (const s of SECTIONS.filter((x) => x.key !== "vehicle")) {
      sections[s.key] = { status: "failed", notFound: true, error: "Vehicle not found", retries: 0 };
      await onSection(s.key, sections[s.key]);
    }
    const costs = Object.values(instances).flatMap((a) => a.costs || []);
    return { sections, costs, providers: Object.values(instances).map((a) => a.name) };
  }
  const vin = query.vin || (sections.vehicle.status === "ok" ? sections.vehicle.data.vin : null);
  const withVin = vin ? { ...base, kind: "vin", vin } : base;

  await Promise.all(
    SECTIONS.filter((s) => s.key !== "vehicle").map(async (s) => {
      const q = s.key === "ppsr" || s.key === "odometer" ? withVin : base;
      sections[s.key] = await loadSection(s, bySection[s.key], q, deps);
      await onSection(s.key, sections[s.key]);
    })
  );
  const recalls = recallsSection(sections.ppsr);
  if (recalls) {
    sections.recalls = recalls;
    await onSection("recalls", recalls);
  }
  if (sections.ppsr && "recalls" in sections.ppsr) {
    // Recalls have their own section; the PPSR one is rewritten without them.
    delete sections.ppsr.recalls;
    await onSection("ppsr", sections.ppsr);
  }
  const costs = Object.values(instances).flatMap((a) => a.costs || []);
  return { sections, costs, providers: Object.values(instances).map((a) => a.name) };
}

function coreLoaded(sections) {
  return SECTIONS.filter((s) => s.core).some((s) => sections[s.key]?.status === "ok");
}

/**
 * input: { country, plate, state } | { country, vin }
 * payment: { type: "purchase", platform, token } | { type: "credit" }
 * -> { outcome, reportId?, message? }
 */
async function runFullCheck({ uid, isAdmin = false, input, payment, requestId }, deps) {
  const now = deps.now || (() => new Date());
  const config = mergeConfig(deps.configOverride);
  const d = { ...deps, now };

  const parsed = parseQuery(input);
  if (!parsed.ok) return { outcome: "invalid", reason: parsed.reason };
  const { query } = parsed;
  const reportId = REPORT_ID_RE.test(String(requestId || "")) ? requestId : newReportId();

  // --- 2 + 3: pay, exactly once ---------------------------------------------------------------
  let paidWith;
  if (payment?.type === "credit") {
    const ok = await d.store.useCredit(uid, reportId);
    if (!ok) return { outcome: "no_credit", message: "You don't have a free re-check to use." };
    paidWith = { type: "credit" };
  } else if (payment?.type === "purchase") {
    let receipt;
    try {
      receipt = await d.verifyPurchase({ platform: payment.platform, token: payment.token, productId: config.productId });
    } catch (err) {
      return { outcome: "invalid_purchase", message: err.message || "That purchase couldn't be verified." };
    }
    if (receipt.sandbox && !(isAdmin && config.allowSandboxForAdmins)) {
      return { outcome: "invalid_purchase", message: "Test purchases can't run a real check." };
    }
    const claim = await d.store.claimPurchase(receipt.key, { uid, reportId, queryKey: query.key, platform: receipt.platform, sandbox: receipt.sandbox, at: now().getTime() });
    if (claim.status === "used") {
      if (claim.uid !== uid) return { outcome: "invalid_purchase", message: "That purchase belongs to another account." };
      // Same purchase again (a retry after a dropped connection, or a replay): the same report,
      // never a second charge or a second set of provider calls.
      return { outcome: claim.outcome || "already_used", reportId: claim.reportId };
    }
    paidWith = { type: "purchase", key: receipt.key, platform: receipt.platform, sandbox: receipt.sandbox };
  } else {
    return { outcome: "invalid_purchase", message: "No payment." };
  }

  // --- 4: the report, section by section ------------------------------------------------------
  const createdAt = now().getTime();
  await d.store.createReport(uid, reportId, {
    query: { kind: query.kind, plate: query.plate ?? null, state: query.state ?? null, vin: query.vin ?? null },
    queryKey: query.key,
    status: "running",
    createdAt,
    paidWith: paidWith.type,
    sections: loadingSections(),
  });

  let result;
  const cached = await d.store.getCache(query.key, createdAt - config.cacheHours * 3600_000);
  if (cached) {
    result = { sections: cached.sections, costs: [], providers: cached.providers, fromCache: true };
    for (const [k, v] of Object.entries(result.sections)) await d.store.updateSection(uid, reportId, k, v);
  } else {
    result = await runSections(query, config, d, (key, value) => d.store.updateSection(uid, reportId, key, value));
  }

  // --- 5: nothing core loaded -> free re-check -----------------------------------------------
  if (!coreLoaded(result.sections)) {
    const notFound = result.sections.vehicle?.notFound;
    await d.store.addCredit(uid, { reportId, reason: notFound ? "not_found" : "providers_down", at: now().getTime() });
    await d.store.finishReport(uid, reportId, { status: "credited", notFound: !!notFound, finishedAt: now().getTime() });
    if (paidWith.key) await d.store.finishPurchase(paidWith.key, { outcome: "credited" });
    await d.store.logUsage({ uid, reportId, queryKey: query.key, outcome: "credited", costs: result.costs, at: now().getTime() });
    return {
      outcome: "credited",
      reportId,
      message: notFound
        ? "We couldn't find that vehicle on the register. You haven't lost your check: a free re-check is saved to your account."
        : "The vehicle registers aren't answering right now. You haven't lost your check: a free re-check is saved to your account.",
    };
  }

  // A full, successful result is cached for the next 24 h (failed sections never are).
  if (!result.fromCache && Object.values(result.sections).every((s) => s.status === "ok")) {
    await d.store.setCache(query.key, { sections: result.sections, providers: result.providers, at: createdAt });
  }
  const status = overallStatus(result.sections);
  await d.store.finishReport(uid, reportId, { status, providers: result.providers, fromCache: !!result.fromCache, finishedAt: now().getTime() });
  if (paidWith.key) await d.store.finishPurchase(paidWith.key, { outcome: status });
  await d.store.logUsage({ uid, reportId, queryKey: query.key, outcome: status, fromCache: !!result.fromCache, costs: result.costs, at: now().getTime() });
  return { outcome: status, reportId };
}

/** "Couldn't load -- tap to retry": one failed section again, free, a few times at most. */
async function retrySection({ uid, reportId, section: key }, deps) {
  const now = deps.now || (() => new Date());
  const config = mergeConfig(deps.configOverride);
  const d = { ...deps, now };
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) return { outcome: "invalid", reason: "unknown_section" };
  const report = await d.store.getReport(uid, reportId);
  if (!report) return { outcome: "not_found" };
  if (report.status === "credited" || report.status === "running") return { outcome: "invalid", reason: "not_retryable" };
  const current = report.sections?.[key];
  if (!current || current.status !== "failed") return { outcome: "invalid", reason: "section_not_failed" };
  const retries = (current.retries ?? 0) + 1;
  if (retries > config.maxSectionRetries) return { outcome: "limit", message: "Tried a few times already. Please try again later." };

  const { bySection, instances } = buildAdapters(config, d);
  const vin = report.query?.vin || (report.sections.vehicle?.status === "ok" ? report.sections.vehicle.data.vin : null);
  const base = { kind: report.query.kind, plate: report.query.plate, state: report.query.state, vin: report.query.vin, decodeVin: config.decodeVin };
  const q = (key === "ppsr" || key === "odometer") && vin ? { ...base, kind: "vin", vin } : base;
  const loaded = await loadSection(section, bySection[key], q, d);
  const value = loaded.status === "failed" ? { ...loaded, retries } : loaded;
  if (key === "ppsr") {
    const recalls = recallsSection(loaded);
    if (recalls) await d.store.updateSection(uid, reportId, "recalls", recalls);
    delete value.recalls;
  }
  await d.store.updateSection(uid, reportId, key, value);
  const after = { ...report.sections, [key]: value };
  await d.store.finishReport(uid, reportId, { status: overallStatus(after) });
  const costs = Object.values(instances).flatMap((a) => a.costs || []);
  await d.store.logUsage({ uid, reportId, queryKey: report.queryKey, outcome: `retry_${key}_${value.status}`, costs, at: now().getTime() });
  return { outcome: value.status === "ok" ? "ok" : "failed", reportId };
}

module.exports = { runFullCheck, retrySection, runSections, loadSection, REPORT_ID_RE };
