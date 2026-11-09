import React from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  onPress: () => void;
  style?: object;
}

// Waze-style round white Compass button, directly under the Menu button -- tap resets the map
// to north-up (see MapScreen.tsx's onPress handler, a real animateCamera({ heading: 0 }) call).
// Visibility is gated by Settings > Map shortcuts > Show compass at the call site, not here.
// A real red (north half) / grey (south half) split needle per the brief, built from two
// stacked caret glyphs rather than a single generic compass icon.
//
// Deliberately a static needle, not a live-rotating one -- react-native-maps' MapView never
// exposes the map's own current camera bearing back to JS as a readable live value (only
// Camera.heading from a one-shot getCamera() call, or whatever this screen last SET it to via
// animateCamera -- not what a two-finger rotate gesture sets it to), so animating this to a
// bearing this screen can't actually read back would be a fabricated rotation. Real tap-to-
// reset behaviour without a fabricated rotation reading -- the Mapbox engine (once real tokens
// exist, see NOTES.md) exposes a genuine live onCameraChanged bearing this can switch to.
export function CompassButton({ onPress, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel="Reset map to north"
    >
      <View style={styles.needle}>
        <Ionicons name="caret-up" size={22} color="#DC2626" style={styles.needleTop} />
        <Ionicons name="caret-down" size={22} color="#6B7280" style={styles.needleBottom} />
      </View>
    </Pressable>
  );
}

// Real, explicit request (Waze-style redesign, Phase 1B section 6/9) -- literal 72pt. This
// button floats on its own (no shared row with other controls), so the literal spec size is
// used as-is.
const styles = StyleSheet.create({
  button: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.medium,
  },
  needle: {
    alignItems: "center",
  },
  needleTop: {
    marginBottom: -4,
  },
  needleBottom: {
    marginTop: -4,
  },
});
