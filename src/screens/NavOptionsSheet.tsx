import React, { forwardRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import { formatArrivalClock, formatDistance, formatDurationText, type DistanceUnit } from "@/utils/navFormat";
import { quickestSlot, type LeavePrediction, type RouteEvent } from "@/travel/etaSheet";

interface Props {
  arrivalClockText: string;
  etaText: string;
  distanceText: string;
  distanceUnit: DistanceUnit;
  /** Where the drive ends; null when the trip has no named place (a dropped pin). */
  destinationName: string | null;
  destinationAddress?: string | null;
  /** Google's road summary for this route, e.g. "M1". */
  viaText?: string;
  /** Reports and live incidents on the road still ahead, in driving order. */
  events: RouteEvent[];
  /** Asked once each time the sheet opens: predicted drive times for leaving now and later. */
  loadLeaveTimes: () => Promise<LeavePrediction[]>;
  onShareDrive: () => void;
  onReportAlert: () => void;
  onOpenDetection: () => void;
  // Satellite, 3D buildings, alerts and the nearby-place lists while driving.
  onOpenMapTools: () => void;
  onEndNavigation: () => void;
  onClose: () => void;
  onSheetChange?: (index: number) => void;
  // Advisory only, never disables the row.
  detectionBatteryLow?: boolean;
}

type LeaveState = { status: "idle" } | { status: "loading" } | { status: "done"; predictions: LeavePrediction[] } | { status: "failed"; reason: string };

// The ETA sheet: tap the arrival time on the bottom bar while driving. The arrival time and
// distance, where you're going and which way, what's reported on the road ahead, how long the
// drive would take if you left at the next quarter hours (Google's own predictions), the trip's
// actions, and Stop / Go now.
export const NavOptionsSheet = forwardRef<BottomSheet, Props>(function NavOptionsSheet(
  {
    arrivalClockText,
    etaText,
    distanceText,
    distanceUnit,
    destinationName,
    destinationAddress,
    viaText,
    events,
    loadLeaveTimes,
    onShareDrive,
    onReportAlert,
    onOpenDetection,
    onOpenMapTools,
    onEndNavigation,
    onClose,
    onSheetChange,
    detectionBatteryLow,
  },
  ref
) {
  const insets = useSafeAreaInsets();
  const [leave, setLeave] = useState<LeaveState>({ status: "idle" });

  const fetchLeaveTimes = () => {
    setLeave({ status: "loading" });
    loadLeaveTimes()
      .then((predictions) =>
        predictions.some((p) => p.durationSeconds != null)
          ? setLeave({ status: "done", predictions })
          : setLeave({ status: "failed", reason: "no drive times came back" })
      )
      .catch((err: unknown) => setLeave({ status: "failed", reason: err instanceof Error ? err.message : "request failed" }));
  };

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={(index) => {
        if (index >= 0 && leave.status !== "loading") fetchLeaveTimes();
        onSheetChange?.(index);
      }}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <View style={styles.headerText} accessible accessibilityLabel={`Arrive at ${arrivalClockText}. ${etaText}, ${distanceText} to go`}>
            <Text style={styles.arrival} testID="eta-sheet-arrival">
              {arrivalClockText}
            </Text>
            <Text style={styles.etaLine}>
              {etaText} • {distanceText}
            </Text>
          </View>
          <Button variant="ghost" icon="close" iconColor={colors.textMuted} onPress={onClose} accessibilityLabel="Close" />
        </View>

        <View style={styles.card}>
          <View style={styles.toRow}>
            <Text style={styles.toLabel}>To</Text>
            <View style={styles.toText}>
              <Text style={styles.toName} numberOfLines={1} testID="eta-sheet-to">
                {destinationName ?? "Dropped pin"}
              </Text>
              {destinationAddress && destinationAddress !== destinationName ? (
                <Text style={styles.toSub} numberOfLines={1}>
                  {destinationAddress}
                </Text>
              ) : null}
            </View>
          </View>
          {viaText ? (
            <View style={styles.toRow}>
              <Text style={styles.toLabel}>Via</Text>
              <Text style={[styles.toName, styles.toText]} numberOfLines={1} testID="eta-sheet-via">
                {viaText}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>On your route</Text>
        <RouteEventsBar events={events} unit={distanceUnit} />

        <Text style={styles.sectionLabel}>Best time to leave</Text>
        <LeaveTimesChart state={leave} onRetry={fetchLeaveTimes} />

        <View style={styles.card}>
          <OptionRow icon="share-outline" label="Share drive" onPress={onShareDrive} testID="eta-sheet-share" />
          <OptionRow icon="warning" label="Report" onPress={onReportAlert} testID="eta-sheet-report" />
          <OptionRow
            icon="videocam-outline"
            label="Dashcam"
            subtitle={detectionBatteryLow ? "Battery below 50%. Still works, may run slower" : undefined}
            onPress={onOpenDetection}
            testID="eta-sheet-dashcam"
          />
          <OptionRow icon="layers-outline" label="Map display" subtitle="Satellite, 3D buildings, alerts, places nearby" onPress={onOpenMapTools} testID="eta-sheet-map" last />
        </View>

        <View style={styles.actions}>
          <Button variant="destructive" label="Stop" size="large" onPress={onEndNavigation} accessibilityLabel="Stop navigation" style={styles.actionBtn} testID="eta-sheet-stop" />
          <Button variant="primary" label="Go now" size="large" onPress={onClose} accessibilityLabel="Go now, keep driving" style={styles.actionBtn} testID="eta-sheet-go" />
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

const SNAP_POINTS = ["72%"];

function RouteEventsBar({ events, unit }: { events: RouteEvent[]; unit: DistanceUnit }) {
  if (events.length === 0) {
    return (
      <Text style={styles.quiet} testID="eta-sheet-no-events">
        Nothing reported on the road ahead
      </Text>
    );
  }
  return (
    <View testID="eta-sheet-events">
      <View style={styles.track}>
        {events.map((e) => (
          <View
            key={e.id}
            style={[styles.trackDot, { left: `${Math.min(97, e.fraction * 100)}%`, backgroundColor: e.kind === "incident" ? colors.danger : colors.warning }]}
          />
        ))}
      </View>
      {events.slice(0, 4).map((e) => (
        <View key={e.id} style={styles.eventRow} accessible accessibilityLabel={`${e.label} in ${formatDistance(e.alongMeters, unit)}`}>
          <View style={[styles.eventDot, { backgroundColor: e.kind === "incident" ? colors.danger : colors.warning }]} />
          <Text style={styles.eventLabel} numberOfLines={1}>
            {e.label}
          </Text>
          <Text style={styles.eventDist}>{formatDistance(e.alongMeters, unit)}</Text>
        </View>
      ))}
      {events.length > 4 ? <Text style={styles.quiet}>and {events.length - 4} more ahead</Text> : null}
    </View>
  );
}

const CHART_HEIGHT = 72;

function LeaveTimesChart({ state, onRetry }: { state: LeaveState; onRetry: () => void }) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <View style={styles.chart} testID="eta-sheet-leave-loading" accessibilityLabel="Loading drive times">
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={styles.chartCol}>
            <View style={[styles.bar, styles.skeleton, { height: CHART_HEIGHT * 0.5 }]} />
            <View style={[styles.skeleton, styles.skeletonLabel]} />
          </View>
        ))}
      </View>
    );
  }
  if (state.status === "failed") {
    return (
      <Pressable onPress={onRetry} accessibilityRole="button" testID="eta-sheet-leave-error">
        <Text style={styles.errorText}>Couldn&apos;t load drive times: {state.reason}. Tap to try again.</Text>
      </Pressable>
    );
  }
  const known = state.predictions.filter((p) => p.durationSeconds != null).map((p) => p.durationSeconds as number);
  const max = Math.max(...known);
  const min = Math.min(...known);
  const best = quickestSlot(state.predictions);
  return (
    <View testID="eta-sheet-leave">
      <View style={styles.chart}>
        {state.predictions.map((p, i) => {
          const label = i === 0 ? "Now" : formatArrivalClock(p.departMs);
          if (p.durationSeconds == null) {
            return (
              <View key={p.departMs} style={styles.chartCol} accessible accessibilityLabel={`Leave ${label}: no prediction`}>
                <View style={[styles.bar, styles.barMissing, { height: 8 }]} />
                <Text style={styles.chartLabel}>{label}</Text>
              </View>
            );
          }
          // Taller bar = longer drive. Scaled between the shortest and longest so small
          // differences still show.
          const h = max === min ? CHART_HEIGHT * 0.6 : CHART_HEIGHT * (0.3 + (0.7 * (p.durationSeconds - min)) / (max - min));
          const isBest = best?.departMs === p.departMs;
          return (
            <View
              key={p.departMs}
              style={styles.chartCol}
              accessible
              accessibilityLabel={`Leave ${label}: ${formatDurationText(p.durationSeconds)}${isBest ? ", quickest" : ""}`}
              testID={isBest ? "eta-sheet-leave-best" : undefined}
            >
              <Text style={styles.chartValue}>{Math.round(p.durationSeconds / 60)}</Text>
              <View style={[styles.bar, { height: h, backgroundColor: isBest ? colors.good : colors.routePurple }]} />
              <Text style={[styles.chartLabel, isBest && styles.chartLabelBest]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.quiet}>Minutes of driving if you leave then. Predictions from Google traffic data.</Text>
    </View>
  );
}

function OptionRow({
  icon,
  label,
  subtitle,
  onPress,
  testID,
  last,
}: {
  icon: IconName;
  label: string;
  subtitle?: string;
  onPress: () => void;
  testID?: string;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && { opacity: pressedOpacity }]}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${label}. ${subtitle}` : label}
      testID={testID}
    >
      <Icon name={icon} size={22} color={colors.text} />
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  handleIndicator: { backgroundColor: colors.surfaceMuted, width: 40 },
  container: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  headerText: { flex: 1 },
  arrival: { fontSize: 30, fontWeight: "800", color: colors.text },
  etaLine: { fontSize: 15, color: colors.textMuted, marginTop: 2 },
  card: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  toRow: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: spacing.md },
  toLabel: { width: 32, fontSize: 13, fontWeight: "700", color: colors.textMuted },
  toText: { flex: 1 },
  toName: { fontSize: 16, fontWeight: "700", color: colors.text },
  toSub: { fontSize: 13, color: colors.textMuted },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: spacing.sm, textTransform: "uppercase", letterSpacing: 0.4 },
  quiet: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  errorText: { fontSize: 14, color: colors.danger, paddingVertical: spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.routePurple, marginVertical: spacing.sm, justifyContent: "center" },
  trackDot: { position: "absolute", width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.surface, marginLeft: -7 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 32 },
  eventDot: { width: 10, height: 10, borderRadius: 5 },
  eventLabel: { flex: 1, fontSize: 15, color: colors.text },
  eventDist: { fontSize: 15, fontWeight: "700", color: colors.text },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: CHART_HEIGHT + 40, gap: 6 },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "70%", borderRadius: 6 },
  barMissing: { backgroundColor: colors.border },
  skeleton: { backgroundColor: colors.surfaceMuted },
  skeletonLabel: { width: 32, height: 10, borderRadius: 4, marginTop: 6 },
  chartValue: { fontSize: 12, fontWeight: "700", color: colors.text, marginBottom: 2 },
  chartLabel: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  chartLabelBest: { color: colors.goodText, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTextWrap: { flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});
