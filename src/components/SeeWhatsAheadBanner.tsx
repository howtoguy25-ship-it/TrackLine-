import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "@/components/ui/Button";

// Shown under the top bar for the first few seconds of a drive: how many reports and live
// incidents are on the route, and a tap opens the ETA sheet's list of them.
export function SeeWhatsAheadBanner({ top, count, onPress }: { top: number; count: number; onPress: () => void }) {
  // Only shown when something is on the route (MapScreen hides it otherwise).
  const detail = `${count} ${count === 1 ? "report" : "reports"} on your route`;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top }]}>
      <Chip
        label={`See what's ahead · ${detail}`}
        icon="eye"
        onMap
        onPress={onPress}
        accessibilityLabel={`See what's ahead. ${detail}`}
        testID="see-whats-ahead"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
});
