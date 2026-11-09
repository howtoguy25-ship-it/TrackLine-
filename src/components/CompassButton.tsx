import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  onPress: () => void;
  style?: object;
}

// Waze-style round white Compass button, directly under the Menu button -- tap resets the map
// to north-up (see MapScreen.tsx's onPress handler, a real animateCamera({ heading: 0 }) call).
// Visibility is gated by Settings > Map shortcuts > Show compass at the call site, not here.
//
// Deliberately a static glyph, not a live-rotating needle -- react-native-maps' MapView never
// exposes the map's own current camera bearing back to JS as a readable live value (only
// Camera.heading from a one-shot getCamera() call, or whatever this screen last SET it to via
// animateCamera -- not what a two-finger rotate gesture sets it to), so an animated needle here
// would have to guess the real on-screen rotation rather than reflect it. Real tap-to-reset
// behaviour without a fabricated rotation reading.
export function CompassButton({ onPress, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel="Reset map to north"
    >
      <Ionicons name="compass" size={22} color="#DC2626" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.medium,
  },
});
