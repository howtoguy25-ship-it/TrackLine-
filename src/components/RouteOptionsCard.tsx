import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Route, RouteProfileKey, TravelMode } from "@/services/directions";
import { ROUTE_PROFILE_LABELS, TRAVEL_MODE_LABELS } from "@/services/directions";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

const PROFILE_ICONS: Record<RouteProfileKey, keyof typeof Ionicons.glyphMap> = {
  normal: "navigate-outline",
  fastest: "flash-outline",
  safest: "shield-checkmark-outline",
};

const PROFILE_SUBTITLES: Record<RouteProfileKey, string> = {
  normal: "No rush, Google's own best route",
  fastest: "Quickest right now, live traffic checked",
  safest: "Skips tolls, considers every road",
};

const PROFILE_ORDER: RouteProfileKey[] = ["normal", "fastest", "safest"];

const TRAVEL_MODE_ORDER: TravelMode[] = ["driving", "walking", "bicycling", "transit"];

const TRAVEL_MODE_ICONS: Record<TravelMode, keyof typeof Ionicons.glyphMap> = {
  driving: "car-outline",
  walking: "walk-outline",
  bicycling: "bicycle-outline",
  transit: "bus-outline",
};

// Real vehicle icon per Google transit `vehicle.type` -- falls back to the generic bus icon
// for anything not explicitly a train/tram/ferry (Google's type list is longer than what's
// worth a distinct icon here).
const TRANSIT_VEHICLE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  BUS: "bus-outline",
  INTERCITY_BUS: "bus-outline",
  TROLLEYBUS: "bus-outline",
  HEAVY_RAIL: "train-outline",
  RAIL: "train-outline",
  COMMUTER_TRAIN: "train-outline",
  HIGH_SPEED_TRAIN: "train-outline",
  METRO_RAIL: "subway-outline",
  SUBWAY: "subway-outline",
  TRAM: "subway-outline",
  LIGHT_RAIL: "subway-outline",
  FERRY: "boat-outline",
};

interface Props {
  options: Record<RouteProfileKey, Route> | null;
  // Real single-route result for walking/bicycling/transit -- see MapScreen's fetchRouteOptions.
  // Always mirrors whichever entry of modeRouteOptions is currently selected.
  modeRoute: Route | null;
  // Every real alternative Google returned for the current walk/bike/transit trip -- rendered
  // as a picker list once there's more than one; a single result still uses the plain summary
  // row so the common transit case (exactly one real itinerary) looks the same as before.
  modeRouteOptions: Route[];
  selectedModeRouteIndex: number;
  onSelectModeRoute: (index: number) => void;
  travelMode: TravelMode;
  onSelectTravelMode: (mode: TravelMode) => void;
  loading: boolean;
  errorText?: string | null;
  selected: RouteProfileKey;
  onSelect: (key: RouteProfileKey) => void;
  onStart: () => void;
  onCancel: () => void;
  onAddStop: () => void;
  hasStop: boolean;
  // Real measured card height, so the caller can fit the previewed route's polyline above it
  // instead of guessing a fixed bottom padding that this card -- 3 route options, a mode row,
  // and Add stop/Start -- reliably grows taller than.
  onHeightChange?: (height: number) => void;
  // "My Location" or a real picked place -- shown so it's always clear what these routes/times
  // are actually FROM, and tappable (onChangeOrigin) to change it without backing all the way
  // out to the destination search, same as real map apps let you edit either end of a trip from
  // the route list screen.
  originLabel?: string;
  onChangeOrigin?: () => void;
}

// "Bus 418", "T2 Train", or for a multi-leg trip "Bus 418 + Bus 333" -- the real line(s) this
// itinerary actually rides, straight from transitSummary (see services/directions.ts). Distinct
// from just showing the mode icon: this is what actually answers "which bus/train is this."
function transitTitle(route: Route): string {
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

export function RouteOptionsCard({
  options,
  modeRoute,
  modeRouteOptions,
  selectedModeRouteIndex,
  onSelectModeRoute,
  travelMode,
  onSelectTravelMode,
  loading,
  errorText,
  selected,
  onSelect,
  onStart,
  onCancel,
  onAddStop,
  hasStop,
  onHeightChange,
  originLabel,
  onChangeOrigin,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const isDriving = travelMode === "driving";
  const hasResult = isDriving ? !!options : !!modeRoute;
  // Up to 5 shown at once with a real "Show more" to reveal the rest, per spec -- resets back
  // to collapsed whenever a fresh set of alternatives comes in (new destination/mode), rather
  // than staying expanded from a previous search.
  const [showAllModeRoutes, setShowAllModeRoutes] = useState(false);
  useEffect(() => setShowAllModeRoutes(false), [modeRouteOptions]);
  const visibleModeRouteOptions = showAllModeRoutes ? modeRouteOptions : modeRouteOptions.slice(0, 5);

  // Previously, picking a route profile also slid this whole card partway down ("peek", to
  // show more of the map) and back up a few seconds later. Removed entirely -- that slide-back-
  // up animation firing while a driver was mid-scroll toward the Start button (easy to do,
  // since selecting a route is exactly what makes someone want to scroll down to it) visually
  // fought the scroll gesture and could read as "I scroll down and it flings back up." The
  // ScrollView below is what actually needs to guarantee Start stays reachable; the peek was a
  // nice-to-have that kept causing real reachability bugs across several rounds of fixes, so
  // it's gone rather than tuned again.
  const onLayout = (e: LayoutChangeEvent) => {
    onHeightChange?.(e.nativeEvent.layout.height);
  };

  return (
    <View style={[styles.card, { bottom: insets.bottom + spacing.xl }]} onLayout={onLayout}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose a route</Text>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityLabel="Cancel route selection">
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {originLabel && onChangeOrigin && (
        <Pressable
          style={({ pressed }) => [styles.originRow, pressed && { opacity: pressedOpacity }]}
          onPress={onChangeOrigin}
          accessibilityLabel={`Starting from ${originLabel}. Tap to change.`}
        >
          <Ionicons name="ellipse" size={9} color={colors.accent} />
          <Text style={styles.originText} numberOfLines={1}>
            From {originLabel}
          </Text>
          <Ionicons name="pencil" size={13} color={colors.textFaint} />
        </Pressable>
      )}

      {/* Scrollable, and Start now lives INSIDE this ScrollView as its last item (not a fixed
          element after it) -- previously a route pick's "peek" (below) could still translate
          the whole card down far enough to push a fixed Start button off-screen with nothing
          left to scroll, since the ScrollView's own maxHeight box moved with it. With Start
          as real scrollable content, whatever sliver of this box is still on-screen can always
          be scrolled to reach it, peeked or not. */}
      <ScrollView
        style={{ maxHeight: windowHeight * 0.5 }}
        contentContainerStyle={styles.scrollArea}
        showsVerticalScrollIndicator={false}
      >
      {/* Real, independently-fetched Google Directions results per mode -- see
          MapScreen's fetchRouteOptions/getDirectionsForMode -- not driving-time estimates
          scaled by a guessed walking/cycling speed. */}
      <View style={styles.modeRow}>
        {TRAVEL_MODE_ORDER.map((mode) => {
          const isActive = mode === travelMode;
          return (
            <Pressable
              key={mode}
              onPress={() => onSelectTravelMode(mode)}
              style={({ pressed }) => [
                styles.modeButton,
                isActive && styles.modeButtonActive,
                pressed && { opacity: pressedOpacity },
              ]}
              accessibilityLabel={`${TRAVEL_MODE_LABELS[mode]} directions`}
            >
              <Ionicons name={TRAVEL_MODE_ICONS[mode]} size={18} color={isActive ? "#FFFFFF" : colors.textMuted} />
              <Text style={[styles.modeButtonText, isActive && styles.modeButtonTextActive]}>
                {TRAVEL_MODE_LABELS[mode]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {errorText ? (
        <View style={styles.loadingRow}>
          <Ionicons name="alert-circle" size={20} color={colors.danger} />
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      ) : loading || !hasResult ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>
            {isDriving ? "Finding the best routes…" : `Finding a ${TRAVEL_MODE_LABELS[travelMode].toLowerCase()} route…`}
          </Text>
        </View>
      ) : (
        <>
          {isDriving
            ? PROFILE_ORDER.map((key) => {
                const route = options![key];
                const isSelected = key === selected;
                const usingTraffic = route.etaInTrafficText != null;
                return (
                  <Pressable
                    key={key}
                    onPress={() => onSelect(key)}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected && styles.optionSelected,
                      pressed && { opacity: pressedOpacity },
                    ]}
                  >
                    <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                      <Ionicons
                        name={PROFILE_ICONS[key]}
                        size={20}
                        color={isSelected ? "#FFFFFF" : colors.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.optionTitleRow}>
                        <Text style={styles.optionTitle}>{ROUTE_PROFILE_LABELS[key]}</Text>
                        {route.hasTrafficDelay && (
                          <View style={styles.trafficBadge}>
                            <Text style={styles.trafficBadgeText}>Traffic</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.optionSubtitle}>{PROFILE_SUBTITLES[key]}</Text>
                    </View>
                    <View style={styles.optionStats}>
                      <Text style={styles.optionEta}>
                        {usingTraffic ? route.etaInTrafficText : route.etaText}
                      </Text>
                      <Text style={styles.optionDistance}>{route.distanceText}</Text>
                    </View>
                  </Pressable>
                );
              })
            : modeRouteOptions.length > 1
            ? // Real multiple alternatives -- a walk can have 2-3 genuinely different paths,
              // and a transit trip can have several genuinely different services (different
              // bus routes, a bus vs a train). Each row shows the real line(s) for transit
              // (see transitTitle) or a plain ordinal for walk/bike, since Google doesn't
              // name road-based alternates the way it names transit lines.
              visibleModeRouteOptions.map((r, index) => {
                const isSelected = index === selectedModeRouteIndex;
                const firstLegIcon =
                  travelMode === "transit" && r.transitSummary
                    ? TRANSIT_VEHICLE_ICONS[r.transitSummary.legs[0].vehicleType] ?? TRAVEL_MODE_ICONS.transit
                    : TRAVEL_MODE_ICONS[travelMode];
                const title = travelMode === "transit" ? transitTitle(r) : `Route ${index + 1}`;
                const firstLeg = r.transitSummary?.legs[0];
                const subtitle =
                  travelMode === "transit" && firstLeg
                    ? `${firstLeg.departureText ? `Departs ${firstLeg.departureText}` : "Real-time estimate"}${
                        r.transitSummary && r.transitSummary.transfers > 0
                          ? ` · ${r.transitSummary.transfers} transfer${r.transitSummary.transfers > 1 ? "s" : ""}`
                          : ""
                      }`
                    : index === 0
                    ? "Real-time Google Directions estimate"
                    : "Alternate route";
                return (
                  <Pressable
                    key={index}
                    onPress={() => onSelectModeRoute(index)}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected && styles.optionSelected,
                      pressed && { opacity: pressedOpacity },
                    ]}
                  >
                    <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                      <Ionicons name={firstLegIcon} size={20} color={isSelected ? "#FFFFFF" : colors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{title}</Text>
                      <Text style={styles.optionSubtitle}>{subtitle}</Text>
                    </View>
                    <View style={styles.optionStats}>
                      <Text style={styles.optionEta}>{r.etaText}</Text>
                      <Text style={styles.optionDistance}>{r.distanceText}</Text>
                    </View>
                  </Pressable>
                );
              })
            : modeRoute && (
                // A single mode has exactly one meaningful route in most cases (transit
                // especially, once deduped -- it's governed by real timetables, not alternative
                // road choices), so this is a summary row instead of a picker list.
                <View style={[styles.option, styles.optionSelected]}>
                  <View style={[styles.iconWrap, styles.iconWrapSelected]}>
                    <Ionicons
                      name={
                        travelMode === "transit" && modeRoute.transitSummary
                          ? TRANSIT_VEHICLE_ICONS[modeRoute.transitSummary.legs[0].vehicleType] ?? TRAVEL_MODE_ICONS.transit
                          : TRAVEL_MODE_ICONS[travelMode]
                      }
                      size={20}
                      color="#FFFFFF"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>
                      {travelMode === "transit" ? transitTitle(modeRoute) : TRAVEL_MODE_LABELS[travelMode]}
                    </Text>
                    <Text style={styles.optionSubtitle}>
                      {travelMode === "transit" && modeRoute.transitSummary?.legs[0]?.departureText
                        ? `Departs ${modeRoute.transitSummary.legs[0].departureText}`
                        : "Real-time Google Directions estimate"}
                    </Text>
                  </View>
                  <View style={styles.optionStats}>
                    <Text style={styles.optionEta}>{modeRoute.etaText}</Text>
                    <Text style={styles.optionDistance}>{modeRoute.distanceText}</Text>
                  </View>
                </View>
              )}

          {!showAllModeRoutes && modeRouteOptions.length > 5 && (
            <Pressable
              onPress={() => setShowAllModeRoutes(true)}
              style={({ pressed }) => [styles.showMoreRow, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={styles.showMoreText}>Show {modeRouteOptions.length - 5} more</Text>
              <Ionicons name="chevron-down" size={16} color={colors.accent} />
            </Pressable>
          )}

          {/* Transit doesn't support an arbitrary mid-trip waypoint the way a driving/walking/
              cycling route does (Google's Directions API has no real notion of "stop by here"
              on a fixed-timetable transit trip) -- hidden rather than shown and silently
              failing/ignored. */}
          {travelMode !== "transit" && (
            <Pressable
              onPress={onAddStop}
              style={({ pressed }) => [styles.addStopRow, pressed && { opacity: pressedOpacity }]}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.addStopText}>{hasStop ? "Change stop" : "Add a stop on the way"}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onStart}
            style={({ pressed }) => [styles.startButton, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={styles.startButtonText}>Start</Text>
          </Pressable>
        </>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.high,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  scrollArea: {
    gap: spacing.sm,
  },
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  originText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.xs + 2,
    marginBottom: spacing.xs,
  },
  modeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
  },
  modeButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
  },
  modeButtonTextActive: {
    color: "#FFFFFF",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 14,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.md,
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: "#EFF6FF",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapSelected: {
    backgroundColor: colors.accent,
  },
  optionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  optionSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  trafficBadge: {
    backgroundColor: "#FEF3C7",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  trafficBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#92400E",
  },
  optionStats: {
    alignItems: "flex-end",
  },
  optionEta: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  optionDistance: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  showMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.sm,
  },
  showMoreText: {
    color: colors.accent,
    fontWeight: "600",
    fontSize: 13,
  },
  addStopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  addStopText: {
    color: colors.accent,
    fontWeight: "600",
    fontSize: 13,
  },
  // Real, deliberate use of the new accentGlow shadow (theme/tokens.ts) -- this is the single
  // most central action on the whole map screen (committing to a route), so it's one of the few
  // places this app's own new signature "soft blue glow" treatment is worth using rather than a
  // flat shadow, per explicit request for a bold, unique upgrade.
  startButton: {
    marginTop: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg - 2,
    alignItems: "center",
    ...shadow.accentGlow,
  },
  startButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
});
