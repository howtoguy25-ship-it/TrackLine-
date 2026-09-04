import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking, Keyboard } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useIAP, ErrorCode, type Purchase } from "react-native-iap";
import { recordManualCheck, recordRevCheckResult, recordPlateLookupResult, getVehicleHistory } from "@/services/vehicleHistory";
import { runRevCheck, subscribeRevCheckProviderStatus, type RevCheckResult } from "@/services/revCheck";
import { runPlateLookup, subscribePlateLookupProviderStatus, type PlateLookupResult } from "@/services/plateLookup";
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

  // Real, explicit request: camera capture for plate/VIN (see DocumentScanScreen) navigates
  // back to this exact screen instance with a fresh plate/vin/state in route.params -- unlike
  // the useState initializers right above (mount-only), these keep the visible fields in sync
  // on every later return trip from a scan too, not just the very first time this screen opens.
  useEffect(() => {
    if (params?.plate !== undefined) setPlate(params.plate);
  }, [params?.plate]);
  useEffect(() => {
    if (params?.vin !== undefined) setVin(params.vin);
  }, [params?.vin]);
  useEffect(() => {
    if (params?.state !== undefined) setState(params.state);
  }, [params?.state]);
  const [checking, setChecking] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [result, setResult] = useState<RevCheckResult | null>(null);
  // Real, second result -- the plate+state lookup (make/model/year/body/engine/etc., see
  // plateLookup.ts), kept separate from `result` (the VIN-only PPSR stolen/written-off/finance/
  // odometer check) since they're genuinely different data sources that can each succeed, fail,
  // or simply not have been asked for (no VIN entered) independently of the other.
  const [plateResult, setPlateResult] = useState<PlateLookupResult | null>(null);
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
  const [plateProviderConfigured, setPlateProviderConfigured] = useState(false);
  useEffect(() => subscribePlateLookupProviderStatus(setPlateProviderConfigured), []);

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
      if (!trimmedPlate) return;
      setChecking(true);
      setPurchasing(false);
      setResult(null);
      setPlateResult(null);
      setCachedResultAt(null);
      try {
        await recordManualCheck(trimmedPlate, state, trimmedVin || null);

        // Always runs -- the real plate+state lookup (make/model/year/etc.), per explicit
        // request that a check work from just a plate. Independent of the VIN check below: one
        // can succeed while the other fails/isn't asked for, and each is reported honestly on
        // its own.
        const plateOutcome = await runPlateLookup(trimmedPlate, state);
        setPlateResult(plateOutcome);
        if (plateOutcome.outcome === "success") {
          await recordPlateLookupResult(trimmedPlate, { vehicle: plateOutcome.vehicle });
        }

        // Only runs when a VIN was actually entered -- stolen/written-off/finance/odometer stay
        // real PPSR data, which genuinely requires a VIN (see revCheck.ts's own header), not a
        // guess derived from the plate lookup above.
        let vinOutcome: RevCheckResult | null = null;
        if (trimmedVin) {
          vinOutcome = await runRevCheck(trimmedVin);
          setResult(vinOutcome);
        }

        const delivered = plateOutcome.outcome === "success" || vinOutcome?.outcome === "success";
        if (vinOutcome?.outcome === "success") {
          await recordRevCheckResult(trimmedPlate, trimmedVin, {
            vehicle: vinOutcome.vehicle,
            securedInterestCount: vinOutcome.securedInterestCount,
            certificateUrl: vinOutcome.certificateUrl,
          });
        }
        if (delivered) {
          // Real value actually delivered (from either source) -- now (and only now) is it
          // honest to consume the purchase.
          if (purchase) {
            await finishTransactionFn({ purchase, isConsumable: true });
          }
          pendingPurchaseRef.current = null;
          setHasPendingPaidRetry(false);
        } else if (purchase) {
          // Paid, but neither real check delivered -- keep the transaction open so "Retry" can
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
      if (error.code === ErrorCode.UserCancelled) return;
      // Real, confirmed issue (not a code bug): SkuNotFound/ItemUnavailable means Apple's own
      // App Store Connect doesn't yet have REV_CHECK_PRODUCT_ID (see iap.ts) as a live,
      // purchasable in-app purchase for this app -- that's an App Store Connect configuration
      // step (create the product, complete pricing/metadata, and the Paid Applications
      // Agreement/banking+tax info must be active, or Apple blocks IAP entirely, sandbox
      // included), not something fixable from this app's own code. Honest, distinct message so
      // this doesn't read as a generic "your card was declined"-style failure.
      if (error.code === ErrorCode.SkuNotFound || error.code === ErrorCode.ItemUnavailable) {
        setResult({
          outcome: "error",
          message: "REV Check payments aren't set up yet on the App Store -- try again later.",
        });
        return;
      }
      setResult({ outcome: "error", message: `Payment didn't go through: ${error.message}` });
    },
  });

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: [REV_CHECK_PRODUCT_ID], type: "in-app" });
  }, [connected, fetchProducts]);

  const revCheckProduct = products.find((p) => p.id === REV_CHECK_PRODUCT_ID);
  const priceLabel = revCheckProduct?.displayPrice ?? REV_CHECK_FALLBACK_PRICE_LABEL;
  // Real, confirmed gate: fetchProducts coming back with no match for REV_CHECK_PRODUCT_ID means
  // Apple/Google's own store genuinely doesn't have this SKU live yet (see onPurchaseError's own
  // comment) -- letting the button stay a normal-looking "Pay $14.99" tap that's guaranteed to
  // fail with a cryptic native error is worse than being upfront that payment isn't ready yet.
  // Only gates the PAID path -- the free "not connected" path (see onStart) never needed a real
  // product to begin with.
  const paymentRequired = providerConfigured || plateProviderConfigured;
  const paymentReady = connected && !!revCheckProduct;

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
      if (match?.lastPlateLookup) {
        setPlateResult({ outcome: "success", message: "Lookup complete.", vehicle: match.lastPlateLookup.vehicle });
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
    if (!plate.trim()) return;

    // Already paid for a prior attempt that failed after payment -- retry the same real check
    // for free instead of buying it again.
    if (pendingPurchaseRef.current) {
      runCheck(pendingPurchaseRef.current, finishTransaction);
      return;
    }

    // Neither provider connected at all means this can only ever return the honest "not
    // connected" placeholder from both sources -- charging real money for a check guaranteed
    // not to deliver anything real would be dishonest, so this path never touches the purchase
    // flow. Either one alone is enough to charge for, since it can still deliver real value.
    if (!providerConfigured && !plateProviderConfigured) {
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
  }, [plate, providerConfigured, plateProviderConfigured, requestPurchase, finishTransaction, runCheck]);

  const onOpenCertificate = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      // Real, confirmed gap: this screen had no keyboard-avoidance at all -- opening the
      // keyboard for the plate/VIN fields could cover the state picker and the Run REV Check
      // button below with no automatic scroll to bring them back into view, only a manual drag
      // (easy to miss entirely while focused on typing a plate). automaticallyAdjustKeyboardInsets
      // is RN's own real keyboard-aware inset + auto-scroll-to-focused-input behavior (iOS).
      // keyboardShouldPersistTaps lets tapping a state chip or the close button register in one
      // tap while the keyboard's still up, instead of the first tap only dismissing it.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Vehicle REV Check</Text>
          <Text style={styles.subtitle}>
            Enter a plate + state for real model/spec data. Add a VIN too for stolen /
            written-off / money-owing status -- Australia only.
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
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, styles.fieldLabelWrap]}>NUMBER PLATE (required)</Text>
          <Pressable
            onPress={() => navigation.navigate("DocumentScan", { mode: "plate" })}
            style={({ pressed }) => [styles.scanButton, pressed && { opacity: pressedOpacity }]}
            accessibilityLabel="Scan plate with camera"
          >
            <Ionicons name="camera-outline" size={14} color={colors.accent} />
            <Text style={styles.scanButtonText}>Scan plate</Text>
          </Pressable>
        </View>
        <TextInput
          value={plate}
          onChangeText={(t) => setPlate(t.toUpperCase())}
          placeholder="e.g. ABC12D"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
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
          Real make/model/year/body/engine data comes back from just the plate + state above.
        </Text>

        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, styles.fieldLabelWrap]}>VIN (optional -- unlocks stolen/written-off/finance)</Text>
          <Pressable
            onPress={() => navigation.navigate("DocumentScan", { mode: "vin" })}
            style={({ pressed }) => [styles.scanButton, pressed && { opacity: pressedOpacity }]}
            accessibilityLabel="Scan VIN with camera"
          >
            <Ionicons name="camera-outline" size={14} color={colors.accent} />
            <Text style={styles.scanButtonText}>Scan VIN</Text>
          </Pressable>
        </View>
        <TextInput
          value={vin}
          onChangeText={(t) => setVin(t.toUpperCase())}
          placeholder="e.g. ZAM57YTA0T0000042"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={17}
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          style={styles.plateInput}
        />
        <Text style={styles.helperText}>
          The 17-character chassis number -- on the rego papers, or the compliance plate visible
          through the windshield. Stolen/written-off/money-owing status only ever comes from a
          real PPSR search, which searches by VIN, not plate (a plate can change on
          re-registration) -- leave this blank to just see model/spec data from the plate above.
        </Text>

        {paymentRequired && !hasPendingPaidRetry && paymentReady && (
          <View style={styles.costNotice}>
            <MaterialCommunityIcons name="currency-usd" size={14} color={colors.warning} />
            <Text style={styles.costNoticeText}>
              Running this check costs {priceLabel}, charged securely through the App Store.
            </Text>
          </View>
        )}
        {/* Real, confirmed gate -- see paymentReady's own comment. Honest "not ready yet"
            state instead of a normal-looking price notice for a purchase guaranteed to fail. */}
        {paymentRequired && !hasPendingPaidRetry && !paymentReady && (
          <View style={styles.costNotice}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.warning} />
            <Text style={styles.costNoticeText}>
              REV Check payments aren't available yet -- try again shortly.
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
          disabled={!plate.trim() || checking || purchasing || (paymentRequired && !hasPendingPaidRetry && !paymentReady)}
          style={({ pressed }) => [
            styles.startButton,
            (!plate.trim() || checking || purchasing || (paymentRequired && !hasPendingPaidRetry && !paymentReady)) &&
              styles.startButtonDisabled,
            pressed && !checking && !purchasing && plate.trim() && { opacity: pressedOpacity },
          ]}
        >
          {checking || purchasing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.startButtonText}>
              {hasPendingPaidRetry
                ? "Retry REV Check (already paid)"
                : paymentRequired
                  ? paymentReady
                    ? `Pay ${priceLabel} & Start REV Check`
                    : "Payments unavailable"
                  : "Start REV Check"}
            </Text>
          )}
        </Pressable>
      </View>

      {plateResult && plateResult.outcome === "success" && plateResult.vehicle && (
        <View style={styles.successCard}>
          <View style={styles.successHeader}>
            <MaterialCommunityIcons name="car-info" size={20} color={colors.accent} />
            <Text style={styles.successHeaderText}>Real vehicle data from plate + state</Text>
          </View>
          <View style={styles.detailRowLight}>
            <Text style={styles.detailLabelLight}>Vehicle</Text>
            <Text style={styles.detailValueLight}>
              {[plateResult.vehicle.year, plateResult.vehicle.make, plateResult.vehicle.model]
                .filter(Boolean)
                .join(" ") || "—"}
            </Text>
          </View>
          <View style={styles.detailRowLight}>
            <Text style={styles.detailLabelLight}>Body / engine</Text>
            <Text style={styles.detailValueLight}>
              {[plateResult.vehicle.bodyType, plateResult.vehicle.engineSize].filter(Boolean).join(" · ") || "—"}
            </Text>
          </View>
          <View style={styles.detailRowLight}>
            <Text style={styles.detailLabelLight}>Transmission / fuel</Text>
            <Text style={styles.detailValueLight}>
              {[plateResult.vehicle.transmission, plateResult.vehicle.fuelType].filter(Boolean).join(" · ") || "—"}
            </Text>
          </View>
          <View style={styles.detailRowLight}>
            <Text style={styles.detailLabelLight}>Doors / seats</Text>
            <Text style={styles.detailValueLight}>
              {[plateResult.vehicle.numberOfDoors, plateResult.vehicle.numberOfSeats].filter(Boolean).join(" · ") || "—"}
            </Text>
          </View>
          {!vin.trim() && (
            <Text style={styles.helperText}>
              Add a VIN above and run the check again for stolen/written-off/money-owing status too.
            </Text>
          )}
        </View>
      )}

      {plateResult && plateResult.outcome !== "success" && (
        <View
          style={[styles.resultCard, plateResult.outcome === "error" ? styles.resultCardError : styles.resultCardWarn]}
        >
          <MaterialCommunityIcons
            name={plateResult.outcome === "error" ? "alert-circle-outline" : "information-outline"}
            size={20}
            color={plateResult.outcome === "error" ? colors.danger : colors.warning}
          />
          <Text style={styles.resultText}>{plateResult.message}</Text>
        </View>
      )}

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
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  // Real, confirmed bug (screenshot evidence: "Scan VIN" pushed almost entirely off the right
  // edge of the screen): a Text with no flex/shrink of its own defaults to laying out at its
  // full, unbroken single-line width in a row -- for a label this long ("VIN (OPTIONAL --
  // UNLOCKS STOLEN/WRITTEN-OFF/FINANCE)"), that width alone already exceeds the card, leaving
  // nothing for the button beside it and shoving it straight off-screen instead of the label
  // actually wrapping. flex+shrink lets the label claim only the space actually left after the
  // button, wrapping to 2 lines exactly like it already visually appeared to (the label WAS
  // wrapping -- the button just wasn't getting any room to live inside the card at all).
  fieldLabelWrap: {
    flex: 1,
    flexShrink: 1,
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    flexShrink: 0,
  },
  scanButtonText: { fontSize: 12, fontWeight: "700", color: colors.accent },
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
