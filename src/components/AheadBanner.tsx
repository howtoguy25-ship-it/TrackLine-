import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { AheadGlyph } from "@/components/art/AheadGlyph";
import type { BannerState } from "@/nav/ahead/bannerController";
import { aheadSourceLine, aheadSubtitle } from "@/nav/ahead/aheadText";
import { closingProgress, distanceText, ENTER_MS, LEAVE_MS } from "@/nav/ahead/aheadTiming";
import { AHEAD_BANNER_MARGIN, AHEAD_BANNER_SLIDE, CONTROL_GAP } from "@/nav/navControlsLayout";
import { AHEAD_COLOURS, BLUE, SURFACES } from "@/theme/colors";
import { shadow } from "@/theme/tokens";
import type { DistanceUnit } from "@/utils/navFormat";

// The "ahead" banner while driving (nav/ahead): just under the turn instruction, full width minus
// 12pt, so the bottom of the screen (speedometer, Report, ETA bar) stays clear. A rounded card (20)
// with a stripe and a round icon in the alert's meaning colour, the title (up to 2 lines, never
// running into anything), the live distance in its own pill ("Now" under 30 m), a grey line of real
// detail, the source, and a bar along the bottom edge closing as the spot nears.
//
// Motion runs on the UI thread (Reanimated): first the compass / sound / voice move down out of its
// way (160 ms, `room`), then it slides down 12pt and fades in (220 ms); leaving is the reverse. It
// never overlaps anything at any frame (nav/navControlsLayout.ts, __tests__/nav/aheadLayout.test.ts).
//
// The controller (nav/ahead/bannerController.ts) owns all timing; this only draws its state.
// Tap: pause / resume (or, when stopped, open the full card). Swipe up: away for good.

export const ROOM_MS = 160;
const SWIPE_UP_PX = 30;
const STOPPED_KMH = 10;

interface Props {
  state: BannerState;
  unit: DistanceUnit;
  dark: boolean;
  /** The road the alert is on, when known. */
  road: string | null;
  /** The warning distance it appeared at (the progress bar's full length). */
  warnM: number;
  speedKmh: number | null;
  nowMs: number;
  /** Distance from the screen top to the bottom of the turn instruction. */
  top: number;
  /** Shared with the top controls: how far they've moved down (pt). */
  room: SharedValue<number>;
  onHeight: (h: number) => void;
  onTap: () => void;
  onSwipe: () => void;
  onOpenCard: () => void;
  /** Signed in: Still there / Not there can be counted. */
  canVote: boolean;
  onStillThere: () => void;
  onNotThere: () => void;
  /** A faster route while a jam is ahead: "Faster route · saves 6 min" [Switch] [Keep]. */
  fasterRoute: { savesMin: number; onSwitch: () => void; onKeep: () => void } | null;
}

export function AheadBanner(p: Props) {
  const { state } = p;
  const shown = useSharedValue(0);
  const pulse = useSharedValue(1);
  const height = useRef(0);
  const room = p.room;

  // Phase -> motion, on the UI thread. Re-runs only when the phase or the banner changes.
  const critical = !!state.alert?.critical;
  useEffect(() => {
    const target = (height.current || 88) + CONTROL_GAP;
    if (state.phase === "entering" || state.phase === "shown") {
      const raised = room.get() >= target - 1;
      room.set(withTiming(target, { duration: raised ? 0 : ROOM_MS }));
      shown.set(withDelay(raised ? 0 : ROOM_MS, withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) })));
      if (state.phase === "entering" && critical) pulse.set(withDelay(ROOM_MS, withSequence(withTiming(1.15, { duration: 160 }), withTiming(1, { duration: 200 }))));
    } else if (state.phase === "leaving") {
      shown.set(withTiming(0, { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) }));
      room.set(withDelay(LEAVE_MS, withTiming(0, { duration: ROOM_MS })));
    } else {
      shown.set(0);
      room.set(withTiming(0, { duration: ROOM_MS }));
    }
  }, [state.phase, state.seq, critical, room, shown, pulse]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: -(1 - shown.get()) * AHEAD_BANNER_SLIDE }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));

  // The bar along the bottom edge glides to each new distance (one GPS fix a second).
  const progress = useSharedValue(0);
  const closing = state.alert ? closingProgress(Math.max(0, state.aheadM), p.warnM) : 0;
  useEffect(() => {
    progress.set(withTiming(closing, { duration: 900, easing: Easing.linear }));
  }, [closing, progress]);
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  const touchY = useRef<number | null>(null);
  const swiped = useRef(false);

  const a = state.alert;
  if (!a) return null;
  const colour = AHEAD_COLOURS[a.kind] ?? AHEAD_COLOURS.roadFeature;
  const surface = p.dark ? SURFACES.dark : SURFACES.light;
  const subtitle = aheadSubtitle(a, p.road, p.unit, p.nowMs);
  const stopped = (p.speedKmh ?? 0) < STOPPED_KMH;
  const askStillThere = p.canVote && a.source === "community" && !!a.alertId && (state.aheadM < 0 || stopped);
  const offer = p.fasterRoute && (a.kind === "heavyTraffic" || a.kind === "standstill" || !!a.mergedTraffic) ? p.fasterRoute : null;
  const dist = distanceText(Math.max(0, state.aheadM), p.unit, a.source);

  return (
    <Animated.View
      pointerEvents={state.phase === "leaving" ? "none" : "box-none"}
      style={[styles.wrap, { top: p.top + CONTROL_GAP }, cardStyle]}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
        p.onHeight(e.nativeEvent.layout.height);
      }}
      testID="ahead-banner"
    >
      <Pressable
        onTouchStart={(e) => {
          touchY.current = e.nativeEvent.pageY;
          swiped.current = false;
        }}
        onTouchEnd={(e) => {
          const start = touchY.current;
          touchY.current = null;
          if (start !== null && start - e.nativeEvent.pageY > SWIPE_UP_PX) {
            swiped.current = true;
            p.onSwipe();
          }
        }}
        onPress={() => {
          if (swiped.current) return;
          if (stopped) p.onOpenCard();
          else p.onTap();
        }}
        accessibilityRole="button"
        accessibilityLabel={[a.title, dist, subtitle].filter(Boolean).join(", ")}
        accessibilityHint={stopped ? "Opens the full details. Swipe up to close." : "Tap to keep it open. Swipe up to close."}
        style={[styles.card, { backgroundColor: surface.raised }]}
        testID={`ahead-banner-${a.kind}`}
      >
        <View style={[styles.stripe, { backgroundColor: colour.fill }]} />
        <View style={styles.row}>
          <Animated.View style={[styles.icon, { backgroundColor: colour.fill }, iconStyle]}>
            <AheadGlyph kind={a.kind} size={26} color={colour.glyph} />
          </Animated.View>
          <View style={styles.textCol}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: surface.text }]} numberOfLines={2} testID="ahead-title">
                {a.title}
              </Text>
              <View style={[styles.distPill, { backgroundColor: surface.muted }]}>
                <Text style={[styles.distance, { color: surface.text }]} numberOfLines={1} testID="ahead-distance">
                  {dist}
                </Text>
              </View>
            </View>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: surface.textMuted }]} numberOfLines={1} testID="ahead-subtitle">
                {subtitle}
              </Text>
            ) : null}
            <Text style={[styles.source, { color: surface.textMuted }]} numberOfLines={1} testID="ahead-source">
              {aheadSourceLine(a)}
              {state.paused ? " · kept open" : ""}
            </Text>
          </View>
        </View>
        {askStillThere ? (
          <View style={styles.actions}>
            <Button variant="primary" icon="thumbs-up" label="Still there" onPress={p.onStillThere} style={styles.action} testID="ahead-still-there" />
            <Button variant="secondary" label="Not there" onPress={p.onNotThere} style={styles.action} testID="ahead-not-there" />
          </View>
        ) : offer ? (
          <View style={styles.actions}>
            <Text style={[styles.offer, { color: surface.text }]} numberOfLines={1}>{`Faster route · saves ${offer.savesMin} min`}</Text>
            <Button variant="primary" label="Switch" onPress={offer.onSwitch} testID="ahead-switch" />
            <Button variant="secondary" label="Keep" onPress={offer.onKeep} testID="ahead-keep" />
          </View>
        ) : null}
        <View style={[styles.track, { backgroundColor: surface.muted }]}>
          <Animated.View style={[styles.bar, { backgroundColor: colour.fill }, barStyle]} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: AHEAD_BANNER_MARGIN, right: AHEAD_BANNER_MARGIN },
  card: { borderRadius: 20, overflow: "hidden", paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 14, ...shadow.floating },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 6 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginTop: 2 },
  textCol: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: "700", lineHeight: 22 },
  distPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 0 },
  subtitle: { fontSize: 14, lineHeight: 18 },
  source: { fontSize: 12, lineHeight: 15 },
  distance: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  action: { flex: 1 },
  offer: { flex: 1, fontSize: 15, fontWeight: "600" },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4 },
  bar: { height: 4 },
});

/**
 * Fix pass 5 §5: a faster route when no jam alert is up -- the same banner (same place under the
 * instruction bar, same card) instead of a separate floating card: "Faster route · saves 2 min"
 * with the road / arrival line, [Switch] [Keep]; MapScreen keeps the current route after 10 s.
 */
export function FasterRouteBanner(p: { top: number; savesMin: number; detail: string | null; scheme: "light" | "dark"; onSwitch: () => void; onKeep: () => void; onHeight?: (h: number) => void }) {
  const surface = SURFACES[p.scheme];
  return (
    <View style={[styles.wrap, { top: p.top + CONTROL_GAP }]} onLayout={(e) => p.onHeight?.(e.nativeEvent.layout.height)} testID="faster-route-banner">
      <View style={[styles.card, { backgroundColor: surface.raised }]} accessibilityLabel={`Faster route, saves ${p.savesMin} minutes. ${p.detail ?? ""}`}>
        <View style={[styles.stripe, { backgroundColor: BLUE }]} />
        <View style={styles.row}>
          <View style={styles.textCol}>
            <Text style={[styles.title, { color: surface.text }]} numberOfLines={1} testID="faster-route-title">{`Faster route · saves ${p.savesMin} min`}</Text>
            {p.detail ? (
              <Text style={[styles.subtitle, { color: surface.textMuted }]} numberOfLines={2} testID="faster-route-detail">
                {p.detail}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.actions}>
          <Button variant="primary" label="Switch" onPress={p.onSwitch} style={styles.action} testID="faster-switch" />
          <Button variant="secondary" label="Keep" onPress={p.onKeep} style={styles.action} testID="faster-keep" />
        </View>
      </View>
    </View>
  );
}
