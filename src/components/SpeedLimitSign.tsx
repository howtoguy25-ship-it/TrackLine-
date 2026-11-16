import { shadow } from "@/theme/tokens";
import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/AppText";
import { Icon } from "@/components/ui/Icon";
import { INK, SCHOOL_ZONE, WHITE } from "@/theme/colors";
import { signValue, type SignStyle } from "@/speedLimits/resolveLimit";

interface Props {
  kmh: number;
  /** The unit signs use where you are (or the one chosen in Settings). */
  unit?: "km/h" | "mph";
  /** Red ring (Australia, Europe, most of the world) or white rectangle (US, Canada). */
  signStyle?: SignStyle;
  /** While a school zone is in force: a school badge and when it ends ("until 9:30 am"). */
  schoolZone?: { untilLabel: string | null } | null;
}

/** The posted limit as the road's own sign looks. Fixed colours: a real sign doesn't follow the
 *  app's theme. Only real limits reach here (see speedLimits/resolveLimit.ts) -- no guesses. */
export function SpeedLimitSign({ kmh, unit = "km/h", signStyle = "ring", schoolZone = null }: Props) {
  const value = signValue(kmh, unit);
  const label = `${schoolZone ? "School zone, speed limit" : "Speed limit"} ${value} ${unit === "mph" ? "miles per hour" : "kilometres per hour"}${schoolZone?.untilLabel ? `, ${schoolZone.untilLabel}` : ""}`;
  return (
    <View accessibilityLabel={label} accessibilityRole="image" testID="speed-limit-sign">
      {signStyle === "rectangle" ? (
        <View style={styles.rect} testID="speed-limit-rectangle">
          <Text style={styles.rectCaption}>{schoolZone ? "SCHOOL" : "SPEED"}</Text>
          <Text style={styles.rectCaption}>LIMIT</Text>
          <Text style={styles.rectValue}>{value}</Text>
        </View>
      ) : (
        <View style={styles.ring} testID="speed-limit-ring">
          <Text style={styles.value}>{value}</Text>
        </View>
      )}
      {schoolZone && (
        <View style={styles.badge} testID="school-zone-badge">
          <Icon name="school" size={12} color={INK} />
          {schoolZone.untilLabel ? <Text style={styles.badgeText}>{schoolZone.untilLabel}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: WHITE,
    borderWidth: 6,
    borderColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.floating,
  },
  value: { fontSize: 24, fontWeight: "900", lineHeight: 26, color: "#000000" },
  rect: {
    width: 56,
    height: 70,
    borderRadius: 6,
    backgroundColor: WHITE,
    borderWidth: 2.5,
    borderColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 2,
    ...shadow.floating,
  },
  rectCaption: { fontSize: 9, fontWeight: "800", lineHeight: 10, color: "#000000", letterSpacing: 0.3 },
  rectValue: { fontSize: 24, fontWeight: "900", lineHeight: 27, color: "#000000" },
  badge: {
    position: "absolute",
    bottom: -10,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: SCHOOL_ZONE,
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: INK },
});
