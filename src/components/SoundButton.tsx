import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { shadow, pressedOpacity } from "@/theme/tokens";

interface Props {
  muted: boolean;
  onPress: () => void;
  style?: object;
}

// Waze-style round white Sound button, right side mid-screen on the home map -- opens SoundSheet
// (Spoken directions / Current voice). Shows a muted speaker glyph whenever spoken directions
// are actually off, a real reflection of settings.spokenDirections, never just a static icon.
export function SoundButton({ muted, onPress, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={muted ? "Sound, currently off" : "Sound"}
    >
      <Ionicons name={muted ? "volume-mute" : "volume-high"} size={30} color="#111827" />
    </Pressable>
  );
}

// Real, explicit request (Waze-style redesign, Phase 1B section 6/9) -- literal 72pt, same
// reasoning as Menu/Compass -- this button doesn't share a row with other controls.
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
});
