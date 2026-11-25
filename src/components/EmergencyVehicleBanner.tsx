import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { SURFACES, WHITE } from "@/theme/colors";
import { shadow } from "@/theme/tokens";
import { CLOSENESS_LABEL, TYPE_LABEL, type Closeness, type SirenType } from "@/services/sirenTracker";
import { SirenArt } from "@/components/art/SirenArt";
import { useReduceMotion } from "@/hooks/useReduceMotion";

// "Emergency vehicle nearby" (siren radar): at the top, under the status bar or the turn
// instruction, never over the controls. A red / blue stripe, our own siren icon with a gentle
// pulse, the type the model heard and whether it's getting closer, and what to do. Shown while the
// siren is heard; MapScreen hides it when the tracker says it's ended (8 s after the last siren).

export const SIREN_RED = "#D93025";
export const SIREN_BLUE = "#1E6BD6";

export function EmergencyVehicleBanner({
  top,
  type,
  closeness,
  dark,
  onHeight,
}: {
  top: number;
  type: SirenType;
  closeness: Closeness;
  dark: boolean;
  onHeight?: (h: number) => void;
}) {
  const pulse = useSharedValue(1);
  const reduceMotion = useReduceMotion();
  // The siren icon pulses while the siren is heard (the one other loop in the app); still with Reduce Motion.
  const pulsing = !reduceMotion;
  useEffect(() => {
    pulse.set(pulsing ? withRepeat(withSequence(withTiming(1.12, { duration: 450 }), withTiming(1, { duration: 450 })), -1) : 1);
  }, [pulse, pulsing]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  const surface = dark ? SURFACES.dark : SURFACES.light;
  const subtitle = `${TYPE_LABEL[type]} · ${CLOSENESS_LABEL[closeness]}`;
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top }]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`Emergency vehicle nearby. ${subtitle}. Slow down and make way when safe.`}
      testID="emergency-banner"
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
    >
      <View style={[styles.card, { backgroundColor: surface.raised }]}>
        <View style={styles.stripe}>
          <View style={[styles.half, { backgroundColor: SIREN_RED }]} />
          <View style={[styles.half, { backgroundColor: SIREN_BLUE }]} />
        </View>
        <Animated.View style={[styles.icon, iconStyle]}>
          <SirenArt size={28} />
        </Animated.View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: surface.text }]}>Emergency vehicle nearby</Text>
          <Text style={[styles.subtitle, { color: surface.text }]} testID="emergency-banner-subtitle">
            {subtitle}
          </Text>
          <Text style={[styles.safety, { color: surface.textMuted }]}>Slow down and make way when safe</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12 },
  card: { borderRadius: 20, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 18, paddingRight: 14, ...shadow.floating },
  stripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 6 },
  half: { flex: 1 },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: SIREN_RED, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: WHITE },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 18, fontWeight: "700", lineHeight: 22 },
  subtitle: { fontSize: 15, fontWeight: "600" },
  safety: { fontSize: 13 },
});
