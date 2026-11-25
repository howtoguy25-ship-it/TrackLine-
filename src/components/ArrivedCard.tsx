import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { SurfaceScheme } from "@/components/ui/surfaceScheme";
import { SURFACES, WHITE } from "@/theme/colors";
import { formatArrivalClock } from "@/utils/navFormat";
import { ChequeredFlag } from "@/components/art/ChequeredFlag";
import type { ArrivalInfo } from "@/nav/endDrive";

// "You've arrived": where, and when, with Rate drive (opens Help to send feedback), Park here
// (saves this spot as your parking spot, the P pin) and Done. After parking at a car park picked
// on the way (nav/arrivalFlow.ts), "Walk 180 m" walks you the rest of the way. Up for 5 s or until
// tapped, then the drive ends (MapScreen's exitNavigation("arrived")). Our own flag art.

export function ArrivedCard({
  arrival,
  bottom,
  onRate,
  onPark,
  onDone,
  walk = null,
}: {
  arrival: ArrivalInfo;
  bottom: number;
  onRate: () => void;
  onPark: (() => void) | null;
  onDone: () => void;
  /** The walk left to where you were going, after parking at a car park on the way. */
  walk?: { label: string; onPress: () => void } | null;
}) {
  return (
    <SurfaceScheme value="dark">
      <View style={[styles.card, { bottom }]} testID="arrived-card" accessibilityLiveRegion="polite">
        <View style={styles.top}>
          <ChequeredFlag size={40} />
          <View style={styles.flex}>
            <Text style={styles.title} accessibilityRole="header">
              You&apos;ve arrived
            </Text>
            <Text style={styles.place} numberOfLines={1}>
              {arrival.name}
            </Text>
            <Text style={styles.time}>Arrived {formatArrivalClock(arrival.arrivedAtMs)}</Text>
          </View>
        </View>
        {walk ? <Button variant="primary" label={walk.label} icon="walk" onPress={walk.onPress} testID="arrived-walk" /> : null}
        <View style={styles.actions}>
          <Button variant="secondary" label="Rate drive" onPress={onRate} style={styles.flex} testID="arrived-rate" />
          {onPark ? <Button variant="secondary" label="Park here" onPress={onPark} style={styles.flex} testID="arrived-park" /> : null}
          <Button variant="primary" label="Done" onPress={onDone} style={styles.flex} testID="arrived-done" />
        </View>
      </View>
    </SurfaceScheme>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 20,
    padding: 16,
    gap: 14,
    backgroundColor: SURFACES.dark.sheet,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: "800", color: WHITE },
  place: { fontSize: 16, fontWeight: "600", color: WHITE, marginTop: 2 },
  time: { fontSize: 14, color: SURFACES.dark.textMuted, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8 },
});
