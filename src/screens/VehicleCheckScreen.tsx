import { maybePromptToSave } from "@/guest/savePrompt";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useIAP, ErrorCode, type Purchase } from "react-native-iap";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { View } from "@/components/ui/Surface";
import { Text, TextInput } from "@/components/AppText";
import { Button, Chip } from "@/components/ui/Button";
import { REPORT_STATUS } from "@/theme/colors";
import { colors, radius, spacing } from "@/theme/tokens";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "@/context/LocationContext";
import { isOwnerEmail } from "@/config/admin";
import { env } from "@/config/env";
import { AU_STATES, DEFAULT_AU_STATE, classifyAuRegion } from "@/utils/auStates";
import { VehicleReportView } from "@/components/vehicleCheck/VehicleReportView";
import { SAMPLE_REPORT } from "@/vehicleCheck/sample";
import { reportHtml } from "@/vehicleCheck/reportHtml";
import {
  FULL_CHECK_BLURB,
  FULL_CHECK_PRODUCT_ID,
  FULL_CHECK_PRODUCT_IDS,
  SUPPORTED_COUNTRIES,
  detectCountry,
  isInAustralia,
  normalisePlate,
  normaliseVin,
  overallGrade,
  plateProblem,
  priceLabel,
  progress,
  queryKeyFor,
  recentReportFor,
  reportTitle,
  vinProblem,
  type SectionKey,
  type VehicleReport,
} from "@/vehicleCheck/model";
import {
  getVehicleCheckInfo,
  newRequestId,
  retrySection,
  runCreditCheck,
  runPaidCheck,
  subscribeMyChecks,
  subscribeReport,
  type RunInput,
  type RunOutcome,
  type VehicleCheckInfo,
} from "@/services/vehicleCheck";
import type { RootStackParamList } from "@/navigation/RootNavigator";

// Menu > Vehicle check: ONE paid product, the full check (written-off, stolen, finance owing,
// odometer history, rego and VIN). Plate + state (state from where you are) or a 17-character
// VIN; a labelled sample report before paying; "Get full check" -> App Store / Play purchase ->
// the server verifies the purchase and fills the report in live, section by section.
//
// Never charged twice: a car checked in the last 24 h opens its report instead of selling again;
// a purchase is only finished (consumed) once the server has delivered its report or credit, and
// a paid-but-undelivered purchase is re-sent automatically the next time this screen opens.

const PENDING_KEY = "@trackline/vehicleCheckPending";
const DELIVERED: RunOutcome["outcome"][] = ["complete", "partial", "already_used", "credited"];

type Mode = "plate" | "vin";
type Pending = { input: RunInput; queryKey: string };

export function VehicleCheckScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "VehicleCheck">>();
  const params = route.params ?? {};
  const { user } = useAuth();
  const { location } = useLocation();
  const isOwner = isOwnerEmail(user?.email);

  // Where the driver is: Australia only for now.
  const here = useMemo(() => {
    const lat = location?.coords.latitude;
    const lng = location?.coords.longitude;
    const auState = lat != null && lng != null && isInAustralia(lat, lng) ? classifyAuRegion(lat, lng) : null;
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return detectCountry(auState, locale);
  }, [location]);
  const countrySupported = !!here.country && SUPPORTED_COUNTRIES.includes(here.country);

  const [mode, setMode] = useState<Mode>(params.vin && !params.plate ? "vin" : "plate");
  const [plate, setPlate] = useState(params.plate ?? "");
  const [vin, setVin] = useState(params.vin ?? "");
  const [stateCode, setStateCode] = useState<string>(params.state ?? here.state ?? DEFAULT_AU_STATE);
  const [touched, setTouched] = useState(false);

  const [info, setInfo] = useState<VehicleCheckInfo | null>(null);
  const [infoError, setInfoError] = useState(false);
  const [myChecks, setMyChecks] = useState<VehicleReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params.reportId ?? null);
  const [active, setActive] = useState<VehicleReport | null>(null);
  const [busy, setBusy] = useState<"buying" | "running" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<SectionKey | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    getVehicleCheckInfo()
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setInfoError(true));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => (user ? subscribeMyChecks(user.uid, setMyChecks) : undefined), [user]);
  // A report that can't be loaded says so (a paid report must never just vanish).
  const [activeError, setActiveError] = useState<string | null>(null);
  useEffect(
    () =>
      user && activeId
        ? subscribeReport(
            user.uid,
            activeId,
            (r) => {
              setActiveError(null);
              setActive(r);
            },
            () => setActiveError(activeId)
          )
        : undefined,
    [user, activeId]
  );

  // ---- what's being asked for ----------------------------------------------------------------
  const problem = mode === "vin" ? vinProblem(vin) : plateProblem(plate, stateCode);
  const input = useMemo<RunInput | null>(
    () =>
      problem || !here.country
        ? null
        : mode === "vin"
          ? { country: here.country, vin: normaliseVin(vin), requestId: "" }
          : { country: here.country, plate: normalisePlate(plate), state: stateCode, requestId: "" },
    [problem, here.country, mode, vin, plate, stateCode]
  );
  const queryKey = input ? queryKeyFor(mode === "vin" ? { kind: "vin", vin } : { kind: "plate", plate, state: stateCode }) : null;
  const recent = queryKey ? recentReportFor(myChecks, queryKey, now) : null;

  // ---- paying and delivering -----------------------------------------------------------------
  const handleOutcome = useCallback((outcome: RunOutcome) => {
    if ("reportId" in outcome && outcome.reportId) setActiveId(outcome.reportId);
    if (outcome.outcome === "credited") setMessage(outcome.message);
    else if (outcome.outcome === "invalid") setMessage("Check the plate, state or VIN and try again.");
    else if (outcome.outcome === "invalid_purchase" || outcome.outcome === "no_credit" || outcome.outcome === "not_available") setMessage(outcome.message);
    else setMessage(null);
  }, []);

  const deliver = useCallback(
    async (purchase: Purchase, finish: (args: { purchase: Purchase; isConsumable: boolean }) => Promise<void>, pending: Pending) => {
      const token = purchase.purchaseToken;
      if (!token) {
        setMessage("The store didn't return a purchase to verify. Nothing was looked up.");
        setBusy(null);
        return;
      }
      setBusy("running");
      setActiveId(pending.input.requestId);
      try {
        const outcome = await runPaidCheck(pending.input, Platform.OS === "android" ? "android" : "ios", token, purchase.productId);
        handleOutcome(outcome);
        if (DELIVERED.includes(outcome.outcome)) {
          // Only now is the purchase used up: the report (or the free re-check) exists.
          await finish({ purchase, isConsumable: true });
          await AsyncStorage.removeItem(PENDING_KEY);
          maybePromptToSave("purchase").catch(() => {});
        }
      } catch {
        // Not finished: the purchase stays with the store and is re-sent next time.
        setMessage("Your payment went through but the check couldn't start. It will continue automatically when you reopen Vehicle check.");
      } finally {
        setBusy(null);
      }
    },
    [handleOutcome]
  );

  const pendingRef = useRef<Pending | null>(null);
  const { connected, products, fetchProducts, requestPurchase, finishTransaction, availablePurchases, getAvailablePurchases } = useIAP({
    onPurchaseSuccess: (purchase) => {
      if (!(FULL_CHECK_PRODUCT_IDS as readonly string[]).includes(purchase.productId)) return;
      const pending = pendingRef.current;
      if (pending) deliver(purchase, finishTransaction, pending);
    },
    onPurchaseError: (error) => {
      setBusy(null);
      if (error.code === ErrorCode.UserCancelled) return;
      if (error.code === ErrorCode.SkuNotFound || error.code === ErrorCode.ItemUnavailable) {
        setMessage("The full check isn't set up on the store yet.");
        return;
      }
      setMessage(`Payment didn't go through: ${error.message}`);
    },
  });

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: [...FULL_CHECK_PRODUCT_IDS], type: "in-app" });
    getAvailablePurchases();
  }, [connected, fetchProducts, getAvailablePurchases]);

  // A purchase paid for earlier but never delivered (app closed, network dropped): finish it now.
  const resumedRef = useRef(false);
  useEffect(() => {
    const unfinished = availablePurchases.find((p) => (FULL_CHECK_PRODUCT_IDS as readonly string[]).includes(p.productId));
    if (!unfinished || resumedRef.current) return;
    resumedRef.current = true;
    AsyncStorage.getItem(PENDING_KEY).then((raw) => {
      const pending = raw ? (JSON.parse(raw) as Pending) : null;
      if (pending) deliver(unfinished, finishTransaction, pending);
    });
  }, [availablePurchases, deliver, finishTransaction]);

  // The product for the current price tier (config/vehicleCheck priceTier, via the server).
  const productId = info?.productId ?? FULL_CHECK_PRODUCT_ID;
  const product = products.find((p) => p.id === productId);
  const price = priceLabel(product?.displayPrice, info?.priceAud);
  const credits = info?.credits ?? 0;
  const onSale = !!info?.available;

  const onBuy = useCallback(async () => {
    Keyboard.dismiss();
    setTouched(true);
    setMessage(null);
    if (!input || !queryKey) return;
    if (recent) {
      setActiveId(recent.id);
      return;
    }
    const pending: Pending = { input: { ...input, requestId: newRequestId() }, queryKey };
    pendingRef.current = pending;
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    if (credits > 0) {
      setBusy("running");
      setActiveId(pending.input.requestId);
      try {
        handleOutcome(await runCreditCheck(pending.input));
        await AsyncStorage.removeItem(PENDING_KEY);
      } catch {
        setMessage("Couldn't start the check. Your free re-check hasn't been used.");
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy("buying");
    try {
      await requestPurchase({ request: { apple: { sku: productId }, google: { skus: [productId] } }, type: "in-app" });
    } catch {
      setBusy(null);
    }
  }, [input, queryKey, recent, credits, productId, requestPurchase, handleOutcome]);

  const onRetry = useCallback(
    async (section: SectionKey) => {
      if (!activeId) return;
      setRetrying(section);
      try {
        const r = await retrySection(activeId, section);
        if (r.outcome === "limit" && r.message) setMessage(r.message);
      } catch {
        setMessage("Couldn't retry right now.");
      } finally {
        setRetrying(null);
      }
    },
    [activeId]
  );

  const onShare = useCallback(async (report: VehicleReport) => {
    try {
      const { uri } = await Print.printToFileAsync({ html: reportHtml(report) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: reportTitle(report) });
    } catch {
      Alert.alert("Couldn't make the PDF", "Please try again.");
    }
  }, []);

  // ---- a report on screen ----------------------------------------------------------------------
  if (activeId && active) {
    const p = progress(active);
    const grade = overallGrade(active);
    return (
      <ScrollView contentContainerStyle={styles.content} testID="vehicle-check-report">
        {message && <Text style={styles.message}>{message}</Text>}
        {active.status === "running" && (
          <View style={styles.progress} testID="vehicle-check-progress">
            <Text style={styles.progressText}>{`Checking… ${p.done} of ${p.total} sections`}</Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round((p.done / p.total) * 100)}%` }]} />
            </View>
          </View>
        )}
        {active.status === "credited" ? (
          <Text style={styles.message} testID="vehicle-check-credited">
            {active.notFound
              ? "We couldn't find that vehicle on the register. You haven't lost your check: a free re-check is saved to your account."
              : "The vehicle registers weren't answering. You haven't lost your check: a free re-check is saved to your account."}
          </Text>
        ) : (
          <>
            {grade && active.status !== "running" && (
              <View style={[styles.overall, { backgroundColor: REPORT_STATUS[grade].fill }]}>
                <Text style={[styles.overallText, { color: REPORT_STATUS[grade].on }]}>
                  {grade === "green" ? "No problems found" : grade === "amber" ? "Some things to check" : "Problems found: read before you buy"}
                </Text>
              </View>
            )}
            <VehicleReportView report={active} onRetry={onRetry} retrying={retrying} />
          </>
        )}
        <View style={styles.actions}>
          {active.status !== "running" && active.status !== "credited" && (
            <Button variant="primary" icon="share" label="Share / export PDF" onPress={() => onShare(active)} fullWidth testID="vehicle-check-share" />
          )}
          <Text style={styles.muted}>Saved to My checks.</Text>
          <Button variant="secondary" label="Check another vehicle" onPress={() => setActiveId(null)} fullWidth />
        </View>
      </ScrollView>
    );
  }

  // ---- the form --------------------------------------------------------------------------------
  const notInCountry = !!here.country && !countrySupported;
  const showProblem = touched && problem;
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="vehicle-check-form">
      <Text style={styles.heading}>Vehicle check</Text>
      <Text style={styles.blurb} testID="vehicle-check-blurb">{FULL_CHECK_BLURB}</Text>
      {activeError && activeError === activeId ? (
        <Text style={styles.loadError} testID="vehicle-report-load-error">
          Couldn&apos;t load your report. Check your connection; it&apos;s saved and will show here once it loads.
        </Text>
      ) : null}

      {notInCountry ? (
        <Text style={styles.message} testID="vehicle-check-country">Full check not available in your country yet.</Text>
      ) : (
        <>
          <View style={styles.tabs}>
            <Chip label="Number plate" selected={mode === "plate"} onPress={() => setMode("plate")} testID="mode-plate" />
            <Chip label="VIN" selected={mode === "vin"} onPress={() => setMode("vin")} testID="mode-vin" />
          </View>
          {mode === "plate" ? (
            <>
              <TextInput
                value={plate}
                onChangeText={setPlate}
                placeholder="Number plate"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                style={styles.input}
                testID="plate-input"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.states}>
                {AU_STATES.map((s) => (
                  <Chip key={s.code} label={s.code} selected={stateCode === s.code} onPress={() => setStateCode(s.code)} testID={`state-${s.code}`} />
                ))}
              </ScrollView>
            </>
          ) : (
            <TextInput
              value={vin}
              onChangeText={setVin}
              placeholder="17-character VIN"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
              style={styles.input}
              testID="vin-input"
            />
          )}
          {showProblem ? <Text style={styles.problem} testID="input-problem">{problem}</Text> : null}

          {recent && (
            <Pressable onPress={() => setActiveId(recent.id)} style={styles.recent} testID="recent-report">
              <Text style={styles.recentText}>You checked this vehicle in the last 24 hours. Open that report (no charge).</Text>
            </Pressable>
          )}

          {(onSale || isOwner || __DEV__) && (
            <Button
              variant="primary"
              size="large"
              label={recent ? "Open today's report" : credits > 0 ? "Use your free re-check" : `Get full check — ${price}`}
              onPress={onBuy}
              loading={busy !== null}
              disabled={!onSale || (!recent && credits === 0 && !product && connected)}
              fullWidth
              testID="buy-full-check"
            />
          )}
          <Text style={styles.muted} testID="vehicle-check-terms">
            {"By buying you agree to the "}
            <Text style={styles.link} onPress={() => Linking.openURL(`https://${env.firebase.projectId}.web.app/vehicle-check-terms.html`).catch(() => {})}>
              Vehicle check terms
            </Text>
            {". Always inspect the vehicle and get a mechanic's check."}
          </Text>
          {!onSale && info && <Text style={styles.muted} testID="not-on-sale">{"The full check isn't available yet."}</Text>}
          {isOwner && info?.sections && (
            // Owner only: which provider answers each section, and what's still BLOCKED.
            <View style={styles.ownerPanel} testID="owner-provider-status">
              <Text style={styles.ownerTitle}>{`Owner: ${info.enabled ? "switched on" : "switched off"} · ${onSale ? "on sale" : "not on sale"}`}</Text>
              {Object.entries(info.sections).map(([section, v]) => (
                <Text key={section} style={styles.muted}>{`${section} (${v.provider}): ${v.status}`}</Text>
              ))}
            </View>
          )}
          {infoError && <Text style={styles.muted}>{"Couldn't reach TrackLine. Check your connection."}</Text>}
          {message && <Text style={styles.message}>{message}</Text>}
        </>
      )}

      <Button variant="ghost" label={showSample ? "Hide the sample report" : "See a sample report"} onPress={() => setShowSample((v) => !v)} testID="toggle-sample" />
      {showSample && <VehicleReportView report={SAMPLE_REPORT} />}

      {myChecks.length > 0 && (
        <View style={styles.myChecks} testID="my-checks">
          <Text style={styles.subheading}>My checks</Text>
          {myChecks.map((r) => {
            const g = overallGrade(r);
            return (
              <Pressable key={r.id} onPress={() => setActiveId(r.id)} style={styles.checkRow} testID={`my-check-${r.id}`}>
                <View style={[styles.dot, { backgroundColor: g ? REPORT_STATUS[g].dot : colors.border }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkTitle} numberOfLines={1}>{reportTitle(r)}</Text>
                  <Text style={styles.muted}>
                    {new Date(r.createdAt).toLocaleDateString("en-AU")}
                    {r.status === "credited" ? " · free re-check given" : r.status === "partial" ? " · some sections to retry" : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontSize: 24, fontWeight: "700", color: colors.text },
  subheading: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  blurb: { fontSize: 15, color: colors.textMuted },
  loadError: { fontSize: 15, color: colors.danger, fontWeight: "600" },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  states: { gap: spacing.xs, paddingVertical: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 52,
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: 1,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  problem: { color: REPORT_STATUS.red.on, fontSize: 14 },
  recent: { backgroundColor: REPORT_STATUS.green.fill, borderRadius: radius.sm, padding: spacing.md },
  recentText: { color: REPORT_STATUS.green.on, fontWeight: "600" },
  message: { color: colors.text, fontSize: 15, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, padding: spacing.md },
  muted: { color: colors.textMuted, fontSize: 13 },
  progress: { gap: spacing.xs },
  progressText: { color: colors.text, fontWeight: "600" },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.primary },
  overall: { borderRadius: radius.sm, padding: spacing.md },
  overallText: { fontWeight: "700", fontSize: 16 },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  myChecks: { marginTop: spacing.lg, gap: spacing.xs },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  checkTitle: { color: colors.text, fontWeight: "600" },
  ownerPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md, gap: 2 },
  ownerTitle: { color: colors.text, fontWeight: "700" },
  link: { color: colors.primary, fontWeight: "600" },
});
