// The route-selection screen's own pieces (replaces the old "Choose a route" card): the top
// card with both ends of the trip, the Avoid and Drive pills and their sheets, the two-state
// bottom sheet with Leave later / Go now, and the time bubbles and pins drawn on the map.
// MapScreen owns the state and the map; the rules (which routes, what they're called) are in
// map/routeChoices.ts.
import React, { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, Chip } from "@/components/ui/Button";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, View, useWindowDimensions, type StyleProp, type TextStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Text } from "@/components/AppText";
import { colors, pressedOpacity, scaleFor, shadow } from "@/theme/tokens";
import { TRAVEL_MODE_LABELS, type Route, type TravelMode } from "@/services/directions";
import {
  GO_NOW_COUNTDOWN_MS,
  ROUTE_AVOID_LABELS,
  ROUTE_AVOID_ORDER,
  ROUTE_AVOID_UNSUPPORTED,
  isAvoidSupported,
  type RouteAvoidKey,
  type RouteAvoidPrefs,
  TRAFFIC_LEVEL_LABELS,
  type RouteSummaryParts,
} from "@/map/routeChoices";
import { SELECTED_ROUTE_TIME, TRAFFIC_TEXT } from "@/theme/colors";
import { useUiScheme } from "@/components/ui/uiScheme";

// The Go now fill: the go blue, pressed shade.
const GO_BLUE_DARK = colors.primaryPressed;
const SELECTED_ROW_FILL = "#F4F5F8";

export const TRAVEL_MODE_ORDER: TravelMode[] = ["driving", "walking", "bicycling", "transit"];

export const TRAVEL_MODE_ICONS: Record<TravelMode, IconName> = {
  driving: "car-outline",
  walking: "walk-outline",
  bicycling: "bicycle-outline",
  transit: "bus-outline",
};

// "Drive", not "Driving" -- the pill reads as a verb, like the screen's other pill ("Avoid").
const MODE_PILL_LABELS: Record<TravelMode, string> = {
  driving: "Drive",
  walking: "Walk",
  bicycling: "Bike",
  transit: "Transit",
};

/** "Bus 418", "T2 Train", or "Bus 418 + Bus 333" -- the lines a transit itinerary rides. */
export function transitRouteTitle(route: Route): string {
  const legs = route.transitSummary?.legs;
  if (!legs || legs.length === 0) return TRAVEL_MODE_LABELS.transit;
  const vehicleWord = (type: string) =>
    type === "BUS" || type === "INTERCITY_BUS" || type === "TROLLEYBUS"
      ? "Bus"
      : type === "FERRY"
        ? "Ferry"
        : type.includes("RAIL") || type === "SUBWAY" || type === "TRAM"
          ? "Train"
          : "Transit";
  return legs.map((l) => `${vehicleWord(l.vehicleType)} ${l.lineName}`).join(" + ");
}

// ---------------------------------------------------------------------------------------------
// Top card

interface TopCardProps {
  originLabel: string;
  destinationLabel: string;
  onBack: () => void;
  onEditOrigin: () => void;
  onEditDestination: () => void;
  onSwap: () => void;
  avoidLabel: string;
  avoidActive: boolean;
  onOpenAvoid: () => void;
  travelMode: TravelMode;
  onOpenMode: () => void;
  /** Distance from the top of the screen to the bottom of the pills, for fitting the routes. */
  onHeightChange?: (height: number) => void;
}

export function RouteSelectionTopCard({
  originLabel,
  destinationLabel,
  onBack,
  onEditOrigin,
  onEditDestination,
  onSwap,
  avoidLabel,
  avoidActive,
  onOpenAvoid,
  travelMode,
  onOpenMode,
  onHeightChange,
}: TopCardProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const k = scaleFor(width);
  return (
    <View
      style={[styles.topWrap, { top: insets.top + 8 * k, left: 12 * k, right: 12 * k }]}
      pointerEvents="box-none"
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
    >
      <View style={[styles.topCard, { borderRadius: 32 * k, padding: 10 * k, gap: 6 * k }]}>
        <Button variant="ghost" icon="chevron-back" iconColor={colors.text} onPress={onBack} accessibilityLabel="Back" />
        <View style={[styles.field, { borderRadius: 22 * k, paddingHorizontal: 14 * k }]}>
          <Pressable
            onPress={onEditOrigin}
            style={({ pressed }) => [styles.fieldRow, { height: 48 * k }, pressed && { opacity: pressedOpacity }]}
            accessibilityRole="button"
            accessibilityLabel={`Starting from ${originLabel}. Tap to change.`}
          >
            <Icon name="radio-button-on" size={20 * k} color={colors.accent} />
            <Text style={[styles.fieldText, { fontSize: 18 * k }]} numberOfLines={1}>
              {originLabel}
            </Text>
          </Pressable>
          <View style={styles.fieldDivider} />
          <Pressable
            onPress={onEditDestination}
            style={({ pressed }) => [styles.fieldRow, { height: 48 * k }, pressed && { opacity: pressedOpacity }]}
            accessibilityRole="button"
            accessibilityLabel={`Going to ${destinationLabel}. Tap to change.`}
          >
            <Icon name="location" size={20 * k} color={colors.dangerFill} />
            <Text style={[styles.fieldText, { fontSize: 18 * k }]} numberOfLines={1}>
              {destinationLabel}
            </Text>
          </Pressable>
          <Button
            variant="ghost"
            icon="swap-vertical"
            iconColor={colors.text}
            onPress={onSwap}
            accessibilityLabel={`Swap: start from ${destinationLabel} and go to ${originLabel}`}
            style={[styles.swapButton, { right: 4 * k, top: 48 * k - 22 }]}
          />
        </View>
      </View>
      <View style={[styles.pillRow, { gap: 8 * k, marginTop: 8 * k }]} pointerEvents="box-none">
        <Chip
          onMap
          selected={avoidActive}
          label={avoidLabel}
          trailingIcon="chevron-down"
          onPress={onOpenAvoid}
          accessibilityLabel={`${avoidLabel}. Choose what routes avoid.`}
        />
        <Chip
          onMap
          icon={TRAVEL_MODE_ICONS[travelMode]}
          label={MODE_PILL_LABELS[travelMode]}
          trailingIcon="chevron-down"
          onPress={onOpenMode}
          accessibilityLabel={`${TRAVEL_MODE_LABELS[travelMode]}. Change how you're getting there.`}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Avoid sheet and travel-mode sheet

function SheetFrame({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Button variant="ghost" label="Done" onPress={onClose} />
        </View>
        {children}
      </View>
    </Modal>
  );
}

export function AvoidSheet({
  visible,
  prefs,
  onToggle,
  onClose,
  note,
}: {
  visible: boolean;
  prefs: RouteAvoidPrefs;
  onToggle: (key: RouteAvoidKey, value: boolean) => void;
  onClose: () => void;
  /** e.g. "Every route here has a U-turn" -- shown under the list when set. */
  note?: string | null;
}) {
  return (
    <SheetFrame visible={visible} title="Avoid" onClose={onClose}>
      {ROUTE_AVOID_ORDER.map((key, i) => {
        const supported = isAvoidSupported(key);
        return (
          <View key={key} style={[styles.avoidRow, i > 0 && styles.rowDivider]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.avoidLabel, !supported && { color: colors.textFaint }]}>{ROUTE_AVOID_LABELS[key]}</Text>
              {!supported && <Text style={styles.avoidHint}>{ROUTE_AVOID_UNSUPPORTED[key]}</Text>}
            </View>
            <Switch
              value={supported && prefs[key]}
              disabled={!supported}
              onValueChange={(v) => onToggle(key, v)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={`Avoid ${ROUTE_AVOID_LABELS[key].toLowerCase()}`}
            />
          </View>
        );
      })}
      {note ? <Text style={styles.avoidNote}>{note}</Text> : null}
    </SheetFrame>
  );
}

export function TravelModeSheet({
  visible,
  mode,
  onSelect,
  onClose,
}: {
  visible: boolean;
  mode: TravelMode;
  onSelect: (mode: TravelMode) => void;
  onClose: () => void;
}) {
  return (
    <SheetFrame visible={visible} title="Getting there" onClose={onClose}>
      {TRAVEL_MODE_ORDER.map((m, i) => {
        const active = m === mode;
        return (
          <Pressable
            key={m}
            onPress={() => onSelect(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.modeRow, i > 0 && styles.rowDivider, pressed && { opacity: pressedOpacity }]}
          >
            <Icon name={TRAVEL_MODE_ICONS[m]} size={24} color={active ? colors.accent : colors.textMuted} />
            <Text style={[styles.avoidLabel, { flex: 1 }, active && { color: colors.accent }]}>{MODE_PILL_LABELS[m]}</Text>
            {active && <Icon name="checkmark" size={22} color={colors.accent} />}
          </Pressable>
        );
      })}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------------------------
// Bottom sheet

export interface RouteChoiceRow {
  key: string;
  timeText: string;
  distanceText: string;
  /** "Via M2", or for transit the lines ridden; null when Google didn't say. */
  title: string | null;
  /** "Best route, Typical traffic · Toll". */
  subtitle: string;
  /** The same line in pieces, for driving routes, so the traffic words take their colour. */
  subtitleParts?: RouteSummaryParts;
}

/** The grey line under a route, with "Light / Typical / Heavy traffic" in green / grey / red. */
function RouteSubtitle({ row, style }: { row: RouteChoiceRow; style: StyleProp<TextStyle> }) {
  const scheme = useUiScheme();
  const p = row.subtitleParts;
  if (!p) {
    return (
      <Text style={style} numberOfLines={1}>
        {row.subtitle}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={1}>
      {p.lead}
      {p.traffic && (
        <>
          {", "}
          <Text style={{ color: TRAFFIC_TEXT[scheme][p.traffic] }}>{TRAFFIC_LEVEL_LABELS[p.traffic]}</Text>
        </>
      )}
      {p.tail}
    </Text>
  );
}

interface SheetProps {
  rows: RouteChoiceRow[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  loading: boolean;
  errorText?: string | null;
  loadingText: string;
  onLeaveLater?: () => void;
  onGoNow: () => void;
  /** Whether the Go now fill is running. Turning it off resets the fill. */
  countdownRunning: boolean;
  onCountdownDone: () => void;
  onAddStop?: () => void;
  hasStop: boolean;
  /** Height of the collapsed sheet (from the bottom of the screen), for fitting the routes. */
  onCollapsedHeightChange?: (height: number) => void;
}

export function RouteSelectionSheet({
  rows,
  selectedIndex,
  onSelect,
  loading,
  errorText,
  loadingText,
  onLeaveLater,
  onGoNow,
  countdownRunning,
  onCountdownDone,
  onAddStop,
  hasStop,
  onCollapsedHeightChange,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const k = scaleFor(width);
  const scheme = useUiScheme();
  const [expanded, setExpanded] = useState(false);
  const [summaryHeight, setSummaryHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const selected = rows[selectedIndex] ?? rows[0];

  // A new set of routes (new destination, mode or avoid options) starts collapsed again.
  const rowsKey = rows.map((r) => r.key).join("|");
  const [lastRowsKey, setLastRowsKey] = useState(rowsKey);
  if (rowsKey !== lastRowsKey) {
    setLastRowsKey(rowsKey);
    setExpanded(false);
  }

  const collapsedHeight = summaryHeight + footerHeight;
  // Reported only while collapsed: pulling the list up covers the map, it doesn't re-fit it.
  useEffect(() => {
    if (!expanded && collapsedHeight > 0) onCollapsedHeightChange?.(collapsedHeight);
  }, [expanded, collapsedHeight, onCollapsedHeightChange]);

  const swipe = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onEnd((e) => {
      if (e.translationY < -30) runOnJS(setExpanded)(true);
      else if (e.translationY > 30) runOnJS(setExpanded)(false);
    });

  // Go now fill: 0 -> 1 over ten seconds, then navigation starts. Any touch stops it (the map
  // screen sets countdownRunning false), and the fill empties.
  const progress = useSharedValue(0);
  useEffect(() => {
    if (countdownRunning) {
      progress.set(0);
      progress.set(
        withTiming(1, { duration: GO_NOW_COUNTDOWN_MS, easing: Easing.linear }, (finished) => {
          if (finished) runOnJS(onCountdownDone)();
        })
      );
    } else {
      cancelAnimation(progress);
      progress.set(0);
    }
    return () => cancelAnimation(progress);
  }, [countdownRunning, onCountdownDone, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  const hasRoutes = rows.length > 0 && !loading && !errorText;
  const listMaxHeight = windowHeight * 0.5;

  return (
    <View style={[styles.sheet, { borderTopLeftRadius: 28 * k, borderTopRightRadius: 28 * k }]}>
      <GestureDetector gesture={swipe}>
        <View onLayout={(e) => setSummaryHeight(e.nativeEvent.layout.height)}>
          <Pressable
            onPress={() => hasRoutes && setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Show less" : "Show all routes"}
            style={styles.grabberHit}
          >
            <View style={styles.grabber} />
          </Pressable>
          {errorText ? (
            <View style={[styles.statusRow, { paddingHorizontal: 20 * k }]}>
              <Icon name="alert-circle" size={22} color={colors.danger} />
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          ) : !hasRoutes ? (
            <View style={[styles.statusRow, { paddingHorizontal: 20 * k }]}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.statusText}>{loadingText}</Text>
            </View>
          ) : !expanded && selected ? (
            <Pressable onPress={() => setExpanded(true)} style={{ paddingHorizontal: 20 * k, paddingBottom: 12 * k }}>
              <View style={styles.summaryTop}>
                <Text style={[styles.summaryTime, { fontSize: 34 * k }]}>{selected.timeText}</Text>
                <Text style={[styles.summaryDistance, { fontSize: 18 * k }]}>{selected.distanceText}</Text>
              </View>
              {selected.title && (
                <Text style={[styles.summaryVia, { fontSize: 20 * k }]} numberOfLines={1}>
                  {selected.title}
                </Text>
              )}
              <RouteSubtitle row={selected} style={[styles.summarySub, { fontSize: 17 * k }]} />
            </Pressable>
          ) : (
            <View style={{ height: 4 }} />
          )}
        </View>
      </GestureDetector>

      {hasRoutes && expanded && (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: listMaxHeight }} bounces={false}>
          {rows.map((row, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Pressable
                key={row.key}
                onPress={() => onSelect(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${row.timeText}, ${row.distanceText}. ${row.title ?? ""} ${row.subtitle}`}
                style={[
                  styles.listRow,
                  { paddingHorizontal: 20 * k, paddingVertical: 14 * k },
                  i > 0 && styles.rowDivider,
                  isSelected && { backgroundColor: SELECTED_ROW_FILL },
                ]}
              >
                {isSelected && <View style={styles.selectedBar} />}
                <View style={styles.summaryTop}>
                  <Text style={[styles.listTime, { fontSize: 24 * k }, isSelected && { color: SELECTED_ROUTE_TIME[scheme] }]}>{row.timeText}</Text>
                  <Text style={[styles.summaryDistance, { fontSize: 17 * k }]}>{row.distanceText}</Text>
                </View>
                {row.title && (
                  <Text style={[styles.summaryVia, { fontSize: 18 * k }]} numberOfLines={1}>
                    {row.title}
                  </Text>
                )}
                <RouteSubtitle row={row} style={[styles.summarySub, { fontSize: 16 * k }]} />
              </Pressable>
            );
          })}
          {onAddStop && (
            <Pressable
              onPress={onAddStop}
              accessibilityRole="button"
              style={({ pressed }) => [styles.addStop, styles.rowDivider, { paddingHorizontal: 20 * k }, pressed && { opacity: pressedOpacity }]}
            >
              <Icon name="add" size={20 * k} color={colors.accent} />
              <Text style={[styles.addStopText, { fontSize: 17 * k }]}>{hasStop ? "Change stop" : "Add a stop"}</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      <View
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        style={[styles.footer, { gap: 12 * k, paddingHorizontal: 16 * k, paddingTop: 10 * k, paddingBottom: insets.bottom + 12 * k }]}
      >
        {onLeaveLater && (
          <Button variant="secondary" size="large" label="Leave later" onPress={onLeaveLater} disabled={!hasRoutes} style={styles.footerButton} />
        )}
        <Button
          variant="primary"
          size="large"
          label="Go now"
          onPress={onGoNow}
          disabled={!hasRoutes}
          accessibilityHint={countdownRunning ? "Starts by itself in a few seconds. Touch the screen to stop it." : undefined}
          style={styles.footerButton}
          underlay={<Animated.View style={[styles.goFill, fillStyle]} pointerEvents="none" />}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Map pieces

/** A route's time bubble, with a tail pointing at its line. */
export function RouteTimeBubble({ timeText, tag, selected }: { timeText: string; tag: string | null; selected: boolean }) {
  const bg = selected ? colors.bestTag : "#FFFFFF";
  return (
    <View style={styles.bubbleWrap}>
      <View style={[styles.bubble, { backgroundColor: bg }, !selected && styles.bubbleBorder]}>
        <Text style={[styles.bubbleTime, { color: selected ? "#FFFFFF" : colors.text }]}>{timeText}</Text>
        {selected && tag ? <Text style={styles.bubbleTag}>{tag}</Text> : null}
      </View>
      <View style={[styles.bubbleTail, { borderTopColor: bg }]} />
    </View>
  );
}

/** Where the trip starts: a blue dot in a grey accuracy circle. */
export function StartDot() {
  return (
    <View style={styles.startHalo}>
      <View style={styles.startDot} />
    </View>
  );
}

/** Where the trip ends: a round pin with a checkered flag (original artwork). */
export function CheckeredFlagPin({ size = 44 }: { size?: number }) {
  const s = size;
  return (
    <Svg width={s} height={s * 1.25} viewBox="0 0 44 55">
      <Path d="M22 55 L15 40 H29 Z" fill="#1F2125" />
      <Circle cx="22" cy="22" r="21" fill="#1F2125" />
      <Circle cx="22" cy="22" r="18" fill="#FFFFFF" />
      {/* Flag pole */}
      <Rect x="13" y="10" width="2.4" height="24" rx="1.2" fill="#1F2125" />
      {/* 4 x 3 checkered flag */}
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) =>
          (row + col) % 2 === 0 ? (
            <Rect key={`${row}-${col}`} x={15.4 + col * 4} y={10 + row * 4} width="4" height="4" fill="#1F2125" />
          ) : null
        )
      )}
      <Rect x="15.4" y="10" width="16" height="12" fill="none" stroke="#1F2125" strokeWidth="1" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  topWrap: { position: "absolute" },
  topCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    ...shadow.floating,
  },
  field: { flex: 1, backgroundColor: colors.surfaceMuted },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 44 },
  fieldText: { flex: 1, fontWeight: "500", color: colors.text },
  fieldDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.chipBorder, marginLeft: 32 },
  swapButton: { position: "absolute" },
  pillRow: { flexDirection: "row" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  modalTitle: { fontSize: 22, fontWeight: "700", color: colors.text },
  avoidRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 8 },
  avoidLabel: { fontSize: 18, fontWeight: "500", color: colors.text },
  avoidHint: { fontSize: 14, color: colors.textFaint, marginTop: 2 },
  avoidNote: { fontSize: 15, color: colors.textMuted, marginTop: 8 },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    ...shadow.high,
  },
  grabberHit: { alignItems: "center", paddingTop: 8, paddingBottom: 10 },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.grabber, alignSelf: "center", marginTop: 8 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 18 },
  statusText: { fontSize: 17, color: colors.textMuted },
  errorText: { flex: 1, fontSize: 16, color: colors.danger },
  summaryTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  summaryTime: { fontWeight: "700", color: colors.text },
  summaryDistance: { fontWeight: "400", color: colors.textMuted },
  summaryVia: { fontWeight: "500", color: colors.text, marginTop: 2 },
  summarySub: { fontWeight: "400", color: colors.textMuted, marginTop: 2 },
  listRow: { position: "relative" },
  listTime: { fontWeight: "700", color: colors.text },
  selectedBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.primary },
  addStop: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 52 },
  addStopText: { fontWeight: "500", color: colors.accent },
  footer: { flexDirection: "row" },
  footerButton: { flex: 1 },
  goFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: GO_BLUE_DARK },

  bubbleWrap: { alignItems: "center" },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", ...shadow.low },
  bubbleBorder: { borderWidth: 1, borderColor: colors.chipBorder },
  bubbleTime: { fontSize: 17, fontWeight: "700" },
  bubbleTag: { fontSize: 14, fontWeight: "500", color: "#FFFFFF" },
  bubbleTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  startHalo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(110, 116, 128, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  startDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
});
