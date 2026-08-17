import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface Props {
  kmh: number;
  // Real posted limit for the road currently being driven, when known -- used only to flag the
  // dial red the moment the driver's own live speed exceeds it (the same "you're over the limit"
  // convention every speed-camera-alert app, including the reference app this was modeled on,
  // uses its own speed readout for). Purely a visual flag, never blocks or alters navigation.
  overLimit?: boolean;
}

/** Live current speed, read straight from GPS (never estimated/smoothed elsewhere) -- a plain
 *  dark circular dial sitting beside SpeedLimitSign, matching the real-world "your speed vs. the
 *  posted limit" pairing every dedicated speed-alert app (the explicit visual reference for this)
 *  shows during active navigation. Turns red only once overLimit is true; otherwise a neutral
 *  dark fill so it doesn't compete with the red speed-limit sign next to it. */
export function CurrentSpeedDial({ kmh, overLimit = false }: Props) {
  return (
    <View
      style={[styles.dial, overLimit && styles.dialOver]}
      accessibilityLabel={`Current speed ${kmh} kilometers per hour${overLimit ? ", over the speed limit" : ""}`}
    >
      <Text style={styles.value}>{Math.max(0, Math.round(kmh))}</Text>
      <Text style={styles.unit}>km/h</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dial: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#111827",
    borderWidth: 3,
    borderColor: "#374151",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  dialOver: {
    backgroundColor: "#DC2626",
    borderColor: "#FCA5A5",
  },
  value: {
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 22,
    color: "#FFFFFF",
  },
  unit: {
    fontSize: 9,
    fontWeight: "700",
    color: "#D1D5DB",
    marginTop: -1,
  },
});
