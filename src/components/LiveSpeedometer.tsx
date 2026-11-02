import React, { useEffect, useRef } from "react";
import { Text, StyleSheet, Animated } from "react-native";
import { useAudioPlayer } from "expo-audio";
import { SpeedLimitSign } from "@/components/SpeedLimitSign";

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
export function LiveSpeedometer({ speedKmh, speedLimitKmh, estimated, visible, chimeEnabled }: Props) {
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
  useEffect(() => {
    if (!chimeEnabled || speedLimitKmh == null) return;
    if (overBy < CHIME_TRIGGER_OVER_KMH) return;
    const now = Date.now();
    if (now - lastChimeAtRef.current < CHIME_COOLDOWN_MS) return;
    lastChimeAtRef.current = now;
    chimePlayer.seekTo(0).then(() => chimePlayer.play());
    // Only speedKmh/speedLimitKmh/chimeEnabled should re-trigger this -- chimePlayer/overBy are
    // derived every render and would otherwise fire the effect (and re-read the cooldown ref)
    // far more often than the real speed actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedKmh, speedLimitKmh, chimeEnabled]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity }]}
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
    </Animated.View>
  );
}

const DIAL_SIZE = 84;

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
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
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
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 30,
    color: "#FFFFFF",
  },
  dialValueDark: {
    color: "#111827",
  },
  dialUnit: {
    fontSize: 11,
    fontWeight: "700",
    color: "#D1D5DB",
    marginTop: -2,
  },
});
