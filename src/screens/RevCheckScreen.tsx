import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useIAP, ErrorCode, type Purchase } from "react-native-iap";
import { recordManualCheck, recordRevCheckResult, getVehicleHistory } from "@/services/vehicleHistory";
import { runRevCheck, subscribeRevCheckProviderStatus, type RevCheckResult } from "@/services/revCheck";
import { AU_STATES, DEFAULT_AU_STATE } from "@/utils/auStates";
import { REV_CHECK_PRODUCT_ID, REV_CHECK_FALLBACK_PRICE_LABEL } from "@/services/iap";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import type { RootStackParamList } from "@/navigation/RootNavigator";

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

// Real vehicle history / REV check screen, wired to BusinessAPI.com.au's live PPSR Searches API
// (see revCheck.ts's own header for the full contract this follows) once a provider key is
// saved in Settings. PPSR searches by VIN, never a plate -- a plate isn't stable enough for
// PPSR's own purpose (see revCheck.ts) -- so the plate field here is for this app's own record
// (matches what the AI detector actually reads) while the VIN field is what a real check
// actually runs on. Never fabricates a result: with no provider key, or on any error, this shows
// the real outcome from revCheck.ts, not invented data.
//
// Real money: once a provider key is connected, running a check is gated behind a real Apple/
// Google In-App Purchase (see iap.ts) -- the app charges the driver the IAP price, then spends
// the fixed wholesale cost from the connected PPSR account to actually run the search. The
// purchased transaction is deliberately NOT finished/consumed until the real check succeeds --
// if the BAPI call itself fails after a successful payment, the driver gets a free retry (same
// already-paid transaction) instead of being charged twice or losing money on a check that never
// delivered anything.
export function RevCheckScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "RevCheck">>();
  const params = route.params;

  const [plate, setPlate] = useState(params?.plate ?? "");
  const [vin, setVin] = useState(params?.vin ?? "");
  const [state, setState] = useState(params?.state ?? DEFAULT_AU_STATE);
  const [checking, setChecking] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [result, setResult] = useState<RevCheckResult | null>(null);
  // Set only when `result` came from a PAST paid check loaded off this vehicle's history entry
  // (see the load effect below), never from a check just run this instant -- lets the render
  // show an honest "last checked X ago" instead of implying a stale result just happened live.
  const [cachedResultAt, setCachedResultAt] = useState<number | null>(null);

  // Live from Firestore now (config/revCheckStatus), not a local device setting -- see
  // revCheck.ts's own header for why. Starts false (the same honest "assume not connected"
  // default the old synchronous local-settings check always had) until the first real snapshot
  // lands.
  const [providerConfigured, setProviderConfigured] = useState(false);
  useEffect(() => subscribeRevCheckProviderStatus(setProviderConfigured), []);

  // Holds a purchase that has been PAID for but not yet delivered a successful check result --
  // see the header comment above. A ref (not just state) because it's read from inside the
  // useIAP purchase-success callback's own closure, which needs the current value synchronously,
  // not a stale one from whenever that callback was created. hasPendingPaidRetry mirrors it into
  // render-visible state so the button label/behavior can react to it.
  const pendingPurchaseRef = useRef<Purchase | null>(null);
  const [hasPendingPaidRetry, setHasPendingPaidRetry] = useState(false);

  const runCheck = useCallback(
    async (purchase: Purchase | null, finishTransactionFn: (args: { purchase: Purchase; isConsumable: boolean }) => Promise<void>) => {
      const trimmedVin = vin.trim().toUpperCase();
      const trimmedPlate = plate.trim().toUpperCase();
      if (!trimmedVin) return;
      setChecking(true);
      setPurchasing(false);
      setResult(null);
      setCachedResultAt(null);
      try {
        await recordManualCheck(trimmedPlate, state, trimmedVin);
        const outcome = await runRevCheck(trimmedVin);
        setResult(outcome);
        if (outcome.outcome === "success") {
          await recordRevCheckResult(trimmedPlate, trimmedVin, {
            vehicle: outcome.vehicle,
            securedInterestCount: outcome.securedInterestCount,
            certificateUrl: outcome.certificateUrl,
          });
          // Value actually delivered -- now (and only now) is it honest to consume the purchase.
          if (purchase) {
            await finishTransactionFn({ purchase, isConsumable: true });
          }
          pendingPurchaseRef.current = null;
          setHasPendingPaidRetry(false);
        } else if (purchase) {
          // Paid, but the real check didn't deliver -- keep the transaction open so "Retry" can
          // reuse it for free instead of charging the driver again for a check that never ran.
          pendingPurchaseRef.current = purchase;
          setHasPendingPaidRetry(true);
        }
      } finally {
        setChecking(false);
      }
    },
    [plate, vin, state]
  );

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: (purchase) => {
      runCheck(purchase, finishTransaction);
    },
    onPurchaseError: (error) => {
      setPurchasing(false);
      if (error.code !== ErrorCode.UserCancelled) {
        setResult({ outcome: "error", message: `Payment didn't go through: ${error.message}` });
      }
    },
  });

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: [REV_CHECK_PRODUCT_ID], type: "in-app" });
  }, [connected, fetchProducts]);

  const revCheckProduct = products.find((p) => p.id === REV_CHECK_PRODUCT_ID);
  const priceLabel = revCheckProduct?.displayPrice ?? REV_CHECK_FALLBACK_PRICE_LABEL;

  // A real REV check costs real money (see the cost notice below) -- closing this screen (or the
  // driver just navigating away) must never lose a result they already paid for. Loads whatever
  // was last saved for this exact plate/VIN (see vehicleHistory.ts's recordRevCheckResult) the
  // moment this screen opens with one prefilled, so re-opening a saved vehicle from history shows
  // its last real result immediately instead of a blank form the driver would have to pay to
  // refill.
  useEffect(() => {
    const lookupPlate = params?.plate?.trim().toUpperCase();
    const lookupVin = params?.vin?.trim().toUpperCase();
    if (!lookupPlate && !lookupVin) return;
    let cancelled = false;
    getVehicleHistory().then((history) => {
      if (cancelled) return;
      const match = history.find(
        (e) => (lookupPlate && e.plate === lookupPlate) || (lookupVin && e.vin === lookupVin)
      );
      if (match?.lastResult) {
        setResult({
          outcome: "success",
          message: "Check complete.",
          vehicle: match.lastResult.vehicle,
          securedInterestCount: match.lastResult.securedInterestCount,
          certificateUrl: match.lastResult.certificateUrl,
        });
        setCachedResultAt(match.lastResult.checkedAt);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [params?.plate, params?.vin]);

  const hasVehicleSummary = params?.vehicleLabel !== undefined;
  const speedLabel = useMemo(() => {
    if (params?.speedKmh === undefined || params.speedKmh === null) return "Unknown";
    return params.speedKind === "closing"
      ? `${Math.round(Math.abs(params.speedKmh))} km/h closing`
      : `${Math.max(0, Math.round(params.speedKmh))} km/h`;
  }, [params?.speedKmh, params?.speedKind]);

  const onClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const onStart = useCallback(async () => {
    if (!vin.trim()) return;

    // Already paid for a prior attempt that failed after payment -- retry the same real check
    // for free instead of buying it again.
    if (pendingPurchaseRef.current) {
      runCheck(pendingPurchaseRef.current, finishTransaction);
      return;
    }

    // No provider connected at all means this can only ever return the honest "not connected"
    // placeholder -- charging real money for a check that's guaranteed not to deliver real data
    // would be dishonest, so this path never touches the purchase flow.
    if (!providerConfigured) {
      runCheck(null, finishTransaction);
      return;
    }

    setPurchasing(true);
    try {
      await requestPurchase({
        request: { apple: { sku: REV_CHECK_PRODUCT_ID }, google: { skus: [REV_CHECK_PRODUCT_ID] } },
        type: "in-app",
      });
      // The actual outcome (success/failure) arrives via onPurchaseSuccess/onPurchaseError above,
      // not this promise -- see useIAP's own docs. This just dispatches the native purchase sheet.
    } catch {
      setPurchasing(false);
    }
  }, [vin, providerConfigured, requestPurchase, finishTransaction, runCheck]);

  const onOpenCertificate = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Vehicle REV Check</Text>
          <Text style={styles.subtitle}>
            Stolen / written-off / money-owing status &amp; NEVDIS vehicle data -- Australia only,
            searched by VIN.
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="Close REV check"
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
        >
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {hasVehicleSummary && (
        <View style={styles.summaryCard}>
          <MaterialCommunityIcons name="car-info" size={20} color={colors.accent} />
          <View style={styles.summaryTextWrap}>
            <Text style={styles.summaryTitle}>From live AI detection</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Vehicle</Text>
              <Text style={styles.summaryValue}>{params?.vehicleLabel}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Speed travelling</Text>
              <Text style={styles.summaryValue}>{speedLabel}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Number plate</Text>
              <Text style={[styles.summaryValue, styles.summaryPlate]}>{params?.plate || "—"}</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.formCard}>
        <Text style={styles.fieldLabel}>VIN (required for a real check)</Text>
        <TextInput
          value={vin}
          onChangeText={(t) => setVin(t.toUpperCase())}
          placeholder="e.g. ZAM57YTA0T0000042"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={17}
          style={styles.plateInput}
        />
        <Text style={styles.helperText}>
          The 17-character chassis number -- on the rego papers, or the compliance plate visible
          through the windshield. PPSR searches by VIN, not plate, since a plate can change on
          re-registration.
        </Text>

        <Text style={styles.fieldLabel}>NUMBER PLATE (for your own records)</Text>
        <TextInput
          value={plate}
          onChangeText={(t) => setPlate(t.toUpperCase())}
          placeholder="e.g. ABC12D"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          style={styles.plateInput}
        />

        <Text style={styles.fieldLabel}>STATE / TERRITORY</Text>
        <View style={styles.stateGrid}>
          {AU_STATES.map((s) => {
            const isSelected = state === s.code;
            return (
              <Pressable
                key={s.code}
                onPress={() => setState(s.code)}
                style={({ pressed }) => [
                  styles.stateChip,
                  isSelected && styles.stateChipSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel={s.label}
              >
                <Text style={[styles.stateChipText, isSelected && styles.stateChipTextSelected]}>
                  {s.code}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helperText}>
          Kept with this record for your own reference -- not sent to the PPSR search itself,
          which is a national (not state-based) register.
        </Text>

        {providerConfigured && !hasPendingPaidRetry && (
          <View style={styles.costNotice}>
            <MaterialCommunityIcons name="currency-usd" size={14} color={colors.warning} />
            <Text style={styles.costNoticeText}>
              Running this check costs {priceLabel}, charged securely through the App Store.
            </Text>
          </View>
        )}
        {hasPendingPaidRetry && (
          <View style={styles.costNotice}>
            <MaterialCommunityIcons name="information-outline" size={14} color={colors.warning} />
            <Text style={styles.costNoticeText}>
              Your last check didn't complete after payment -- retrying is free, no second charge.
            </Text>
          </View>
        )}

        <Pressable
          onPress={onStart}
          disabled={!vin.trim() || checking || purchasing}
          style={({ pressed }) => [
            styles.startButton,
            (!vin.trim() || checking || purchasing) && styles.startButtonDisabled,
            pressed && !checking && !purchasing && vin.trim() && { opacity: pressedOpacity },
          ]}
        >
          {checking || purchasing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.startButtonText}>
              {hasPendingPaidRetry
                ? "Retry REV Check (already paid)"
                : providerConfigured
                  ? `Pay ${priceLabel} & Start REV Check`
                  : "Start REV Check"}
            </Text>
          )}
        </Pressable>
      </View>

      {result && result.outcome === "success" && (
        <View style={styles.successCard}>
          <View style={styles.successHeader}>
            <MaterialCommunityIcons name="check-decagram" size={20} color={colors.accent} />
            <Text style={styles.successHeaderText}>
              {cachedResultAt ? `Last checked ${relativeTime(cachedResultAt)}` : "Real result from PPSR/NEVDIS"}
            </Text>
          </View>

          {result.vehicle ? (
            <>
              <View style={styles.detailRowLight}>
                <Text style={styles.detailLabelLight}>Vehicle</Text>
                <Text style={styles.detailValueLight}>
                  {[result.vehicle.year, result.vehicle.make, result.vehicle.model].filter(Boolean).join(" ") || "—"}
                </Text>
              </View>
              <View style={styles.detailRowLight}>
                <Text style={styles.detailLabelLight}>Colour / body</Text>
                <Text style={styles.detailValueLight}>
                  {[result.vehicle.colour, result.vehicle.bodyType].filter(Boolean).join(" · ") || "—"}
                </Text>
              </View>
              <View style={styles.detailRowLight}>
                <Text style={styles.detailLabelLight}>Plate on record</Text>
                <Text style={styles.detailValueLight}>{result.vehicle.registrationPlate ?? "—"}</Text>
              </View>
              <View style={styles.detailRowLight}>
                <Text style={styles.detailLabelLight}>Rego expiry</Text>
                <Text style={styles.detailValueLight}>{result.vehicle.registrationExpiry ?? "—"}</Text>
              </View>
              <View style={styles.detailRowLight}>
                <Text style={styles.detailLabelLight}>Stolen</Text>
                <Text style={[styles.detailValueLight, result.vehicle.stolen && styles.detailValueDanger]}>
                  {result.vehicle.stolen ? "YES" : "No"}
                </Text>
              </View>
              <View style={styles.detailRowLight}>
                <Text style={styles.detailLabelLight}>Written off</Text>
                <Text style={[styles.detailValueLight, result.vehicle.writtenOff && styles.detailValueDanger]}>
                  {result.vehicle.writtenOff ? "YES" : "No"}
                </Text>
              </View>

              {/* Real readings when a connected provider actually returns them (none does today
                  -- see RevCheckVehicle's own comment in revCheck.ts), never a guess. State-aware
                  copy for the "no data" case since odometer coverage is genuinely fragmented by
                  Australian state, not just a gap in this app -- NSW records it via annual
                  roadworthy checks, several other states have no equivalent check to record it
                  from at all. */}
              <View style={styles.odometerSection}>
                <Text style={styles.odometerSectionTitle}>Odometer history</Text>
                {result.vehicle.odometerReadings && result.vehicle.odometerReadings.length > 0 ? (
                  result.vehicle.odometerReadings.map((reading, i) => (
                    <View key={`${reading.date}-${i}`} style={styles.detailRowLight}>
                      <Text style={styles.detailLabelLight}>{reading.date}</Text>
                      <Text style={styles.detailValueLight}>{reading.km.toLocaleString()} km</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.odometerUnavailable}>
                    <MaterialCommunityIcons name="information-outline" size={14} color={colors.textFaint} />
                    <Text style={styles.odometerUnavailableText}>
                      {state === "NSW"
                        ? "Not returned by the connected provider yet. NSW itself records the last 3 annual roadworthy-check readings via Service NSW -- a future data source could surface them here."
                        : `Odometer history isn't available for ${state} through any connected provider yet -- most states don't run a mandatory check that records it.`}
                    </Text>
                  </View>
                )}
              </View>
            </>
          ) : (
            <Text style={styles.resultText}>
              No NEVDIS vehicle data came back for this VIN -- the PPSR security-interest result
              below is still real.
            </Text>
          )}

          <View style={styles.detailRowLight}>
            <Text style={styles.detailLabelLight}>Registered security interests</Text>
            <Text
              style={[
                styles.detailValueLight,
                (result.securedInterestCount ?? 0) > 0 && styles.detailValueDanger,
              ]}
            >
              {result.securedInterestCount ?? 0}
            </Text>
          </View>

          {result.certificateUrl && (
            <Pressable
              onPress={() => onOpenCertificate(result.certificateUrl as string)}
              style={({ pressed }) => [styles.certButton, pressed && { opacity: pressedOpacity }]}
            >
              <MaterialCommunityIcons name="file-certificate-outline" size={16} color={colors.accent} />
              <Text style={styles.certButtonText}>View PPSR certificate</Text>
            </Pressable>
          )}
        </View>
      )}

      {result && result.outcome !== "success" && (
        <View style={[styles.resultCard, result.outcome === "error" ? styles.resultCardError : styles.resultCardWarn]}>
          <MaterialCommunityIcons
            name={result.outcome === "error" ? "alert-circle-outline" : "information-outline"}
            size={20}
            color={result.outcome === "error" ? colors.danger : colors.warning}
          />
          <Text style={styles.resultText}>{result.message}</Text>
        </View>
      )}

      <Pressable
        onPress={() => navigation.navigate("Settings")}
        style={({ pressed }) => [styles.settingsLink, pressed && { opacity: pressedOpacity }]}
      >
        <MaterialCommunityIcons name="key-variant" size={16} color={colors.accent} />
        <Text style={styles.settingsLinkText}>Manage REV check provider keys in Settings</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerTextWrap: { flex: 1, gap: spacing.xs },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  summaryCard: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.low,
  },
  summaryTextWrap: { flex: 1, gap: spacing.xs },
  summaryTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 13, color: colors.textMuted },
  summaryValue: { fontSize: 13, fontWeight: "700", color: colors.text },
  summaryPlate: { fontFamily: "monospace", letterSpacing: 1 },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.low,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  plateInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 52,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: "monospace",
    letterSpacing: 1.5,
    color: colors.text,
  },
  stateGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  stateChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: "transparent",
  },
  stateChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  stateChipText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  stateChipTextSelected: { color: "#FFFFFF" },
  helperText: { fontSize: 12, color: colors.textFaint, lineHeight: 16 },
  costNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "#FEF3C7",
    borderRadius: radius.sm,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  costNoticeText: { flex: 1, fontSize: 12, fontWeight: "600", color: "#92400E" },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    ...shadow.low,
  },
  startButtonDisabled: { backgroundColor: colors.border },
  startButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  resultCard: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "flex-start",
  },
  resultCardWarn: { backgroundColor: "#FEF3C7" },
  resultCardError: { backgroundColor: "#FEE2E2" },
  resultText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadow.low,
  },
  successHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginBottom: spacing.xs,
  },
  successHeaderText: { fontSize: 13, fontWeight: "800", color: colors.text },
  detailRowLight: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailLabelLight: { fontSize: 13, color: colors.textMuted },
  detailValueLight: { fontSize: 13, fontWeight: "700", color: colors.text },
  detailValueDanger: { color: colors.danger },
  odometerSection: { marginTop: spacing.sm },
  odometerSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  odometerUnavailable: {
    flexDirection: "row",
    gap: spacing.xs + 2,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  odometerUnavailableText: { flex: 1, fontSize: 12, color: colors.textFaint, lineHeight: 16 },
  certButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  certButtonText: { fontSize: 13, fontWeight: "700", color: colors.accent },
  settingsLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
  },
  settingsLinkText: { fontSize: 13, fontWeight: "600", color: colors.accent },
});
