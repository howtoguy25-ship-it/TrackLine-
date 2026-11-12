import React from "react";
import { StyleSheet, View } from "react-native";
import { LaneArrow } from "@/components/nav/LaneArrow";
import type { Lane } from "@/nav/lanes";
import { BLUE, WHITE } from "@/theme/colors";

// One rounded tile per lane, left to right, under the top instruction. Lanes for this route are
// white arrows on go-blue tiles, a little larger; the others are grey arrows on dark tiles.

export const LANE_TILE = { valid: { fill: BLUE, arrow: WHITE }, other: { fill: "#2A2C30", arrow: "#9AA0A8" } } as const;

export function LaneStrip({ lanes, scale = 1 }: { lanes: Lane[]; scale?: number }) {
  const base = 34 * scale;
  return (
    <View
      style={[styles.row, { gap: 5 * scale }]}
      accessibilityRole="image"
      accessibilityLabel={laneAccessibilityLabel(lanes)}
      testID="lane-strip"
    >
      {lanes.map((lane, i) => {
        const size = lane.valid ? (lane.active ? base * 1.12 : base * 1.04) : base;
        const tile = lane.valid ? LANE_TILE.valid : LANE_TILE.other;
        return (
          <View
            key={i}
            testID={lane.valid ? "lane-valid" : "lane-other"}
            style={[styles.tile, { width: size, height: size + 4 * scale, borderRadius: 9 * scale, backgroundColor: tile.fill }]}
          >
            <LaneArrow
              indications={lane.indications}
              highlight={lane.valid ? lane.validIndication ?? lane.indications[0] : undefined}
              color={tile.arrow}
              dimColor={lane.valid ? "rgba(255,255,255,0.45)" : tile.arrow}
              size={size * 0.72}
            />
          </View>
        );
      })}
    </View>
  );
}

/** "Lanes: 1 and 2 of 4" for screen readers. */
export function laneAccessibilityLabel(lanes: Lane[]): string {
  const valid = lanes.map((l, i) => (l.valid ? i + 1 : 0)).filter(Boolean);
  if (valid.length === 0) return `${lanes.length} lanes`;
  const list = valid.length === 1 ? String(valid[0]) : `${valid.slice(0, -1).join(", ")} and ${valid[valid.length - 1]}`;
  return `Use lane${valid.length > 1 ? "s" : ""} ${list} of ${lanes.length}, counting from the left`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", paddingTop: 8 },
  tile: { alignItems: "center", justifyContent: "center" },
});
