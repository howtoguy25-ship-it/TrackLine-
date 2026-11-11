import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Animated } from "react-native";
import { Text } from "@/components/AppText";
import { useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SpeedLimitSign } from "@/components/SpeedLimitSign";

// Real, explicit request -- shown exactly once, ever, the first time the chime actually fires
// on this device, so a driver who's never seen this before understands what the buzz means.
// Persisted (not just a this-session flag) since "the first time it ever triggers" means
// exactly that, not "the first time per app launch."
const EXPLAINER_SEEN_KEY = "@trackline/speedChimeExplainerSeen";
const EXPLAINER_TEXT = "Speed reminder: you're 3+ km/h over the limit. Toggle off in Settings.";
const EXPLAINER_VISIBLE_MS = 5000;

interface Props {
  speedKmh: number;
  speedLimitKmh: number | null;
  // True when speedLimitKmh came from the Australian road-type default table, not a real posted
  // OSM maxspeed tag -- shown as a small grey dot on the sign rather than presented as a
  // confirmed sign (see osmTrafficData.ts's own SpeedLimitResult.estimated).
  estimated: boolean;
  // Whether this should be on screen at all right now -- Home view only shows it while moving
  // above 3km/h or during navigation (MapScreen decides which; this component just fades
  // in/out on whatever it's told).
  visible: boolean;
  chimeEnabled: boolean;
  // Real, confirmed bug this fixes -- see the call site's own comment. Overrides the default
  // bottom-24 position so the caller can shift this dial up out from under NavBottomBar's own
  // real measured height whenever that bar is also on screen. undefined keeps the original
  // fixed offset (the Home, not-navigating view, where no such bar exists).
  bottom?: number;
}

const AMBER_OVER_KMH = 1;
const RED_OVER_KMH = 6;
const CHIME_TRIGGER_OVER_KMH = 3;
const CHIME_COOLDOWN_MS = 30_000;

/** Real, explicit request -- bottom-left floating live speed + posted speed-limit sign, shown on
 *  the Home map view (not just during active navigation the way the old nav-card-embedded
 *  CurrentSpeedDial/SpeedLimitSign pair was). White at/under the limit, amber 1-5 km/h over, red
 *  with a gentle pulse 6+ km/h over -- plus an optional soft chime (real, synthesized two-tone
 *  WAV asset, not a placeholder) the first time the driver crosses 3+ km/h over, at most once
 *  every 30s. */
export function LiveSpeedometer({ speedKmh, speedLimitKmh, estimated, visible, chimeEnabled, bottom }: Props) {
  const overBy = speedLimitKmh != null ? speedKmh - speedLimitKmh : 0;
  const isAmber = speedLimitKmh != null && overBy >= AMBER_OVER_KMH && overBy < RED_OVER_KMH;
  const isRed = speedLimitKmh != null && overBy >= RED_OVER_KMH;

  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isRed) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 420, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 420, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRed, pulse]);

  const chimePlayer = useAudioPlayer(require("../../assets/sounds/speed_warning_chime.wav"));
  const lastChimeAtRef = useRef(0);
  // Real, confirmed bug this replaces: the old check only looked at the CURRENT overBy value, so
  // it kept re-firing every single time the 30s cooldown elapsed for as long as the driver
  // stayed over the limit -- a continuous 5-minute stretch over the limit chimed roughly 10
  // times, not once. wasOverRef makes this edge-triggered instead: it only counts as a new
  // "event" the moment overBy actually CROSSES up into over-limit, so staying over continuously
  // chimes exactly once per crossing, and the 30s cooldown below is now purely a safety cap
  // against GPS noise flickering right at the threshold (drop under, bounce back over, repeat).
  const wasOverRef = useRef(false);
  const [explainerVisible, setExplainerVisible] = useState(false);
  useEffect(() => {
    if (!chimeEnabled || speedLimitKmh == null) {
      wasOverRef.current = false;
      return;
    }
    const isOverNow = overBy >= CHIME_TRIGGER_OVER_KMH;
    if (isOverNow && !wasOverRef.current) {
      const now = Date.now();
      if (now - lastChimeAtRef.current >= CHIME_COOLDOWN_MS) {
        lastChimeAtRef.current = now;
        chimePlayer.seekTo(0).then(() => chimePlayer.play());
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        AsyncStorage.getItem(EXPLAINER_SEEN_KEY)
          .then((seen) => {
            if (seen) return;
            return AsyncStorage.setItem(EXPLAINER_SEEN_KEY, "true").then(() => {
              setExplainerVisible(true);
              setTimeout(() => setExplainerVisible(false), EXPLAINER_VISIBLE_MS);
            });
          })
          .catch(() => {});
      }
    }
    wasOverRef.current = isOverNow;
    // Only speedKmh/speedLimitKmh/chimeEnabled should re-trigger this -- chimePlayer/overBy are
    // derived every render and would otherwise fire the effect (and re-read the cooldown ref)
    // far more often than the real speed actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedKmh, speedLimitKmh, chimeEnabled]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity }, bottom != null && { bottom }]}
      accessibilityLabel={`Current speed ${speedKmh} kilometers per hour${
        speedLimitKmh != null ? `, speed limit ${speedLimitKmh}` : ""
      }`}
    >
      <Animated.View
        style={[
          styles.dial,
          isAmber && styles.dialAmber,
          isRed && styles.dialRed,
          { transform: [{ scale: pulse }] },
        ]}
      >
        <Text style={[styles.dialValue, (isAmber || isRed) && styles.dialValueDark]}>{Math.round(speedKmh)}</Text>
        <Text style={[styles.dialUnit, (isAmber || isRed) && styles.dialValueDark]}>km/h</Text>
      </Animated.View>
      {speedLimitKmh != null && <SpeedLimitSign kmh={speedLimitKmh} estimated={estimated} />}
      {explainerVisible && (
        <Animated.View style={styles.explainerBubble}>
          <Text style={styles.explainerText}>{EXPLAINER_TEXT}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

// Real, explicit request -- Waze-style redesign: smaller, cleaner dial than this app's original
// (was 84px/3px border/heavy shadow). Every other measurement below (font sizes, border width,
// shadow) scales down with it, not just this one constant, for a genuinely lighter look rather
// than the same chunky dial just resized.
const DIAL_SIZE = 64;

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    bottom: 24,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  dial: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_SIZE / 2,
    backgroundColor: "rgba(17, 24, 39, 0.88)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  dialAmber: {
    backgroundColor: "#F59E0B",
    borderColor: "#FDE68A",
  },
  dialRed: {
    backgroundColor: "#DC2626",
    borderColor: "#FCA5A5",
  },
  dialValue: {
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 22,
    color: "#FFFFFF",
  },
  dialValueDark: {
    color: "#111827",
  },
  dialUnit: {
    fontSize: 9,
    fontWeight: "700",
    color: "#D1D5DB",
    marginTop: -2,
  },
  explainerBubble: {
    position: "absolute",
    left: 0,
    bottom: DIAL_SIZE + 14,
    maxWidth: 220,
    backgroundColor: "rgba(17, 24, 39, 0.92)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  explainerText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
});
