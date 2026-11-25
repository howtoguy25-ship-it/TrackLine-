import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PressableScale } from "@/components/ui/PressableScale";
import { DRIVE_TILE, WHITE, type DriveTileKind } from "@/theme/colors";

// A round, coloured action tile with its label underneath, for the in-drive sheets (quick
// actions in the ETA sheet, categories in Search along route): big, high-contrast targets a
// driver can hit at a glance. Our own palette and line icons (theme/colors.ts DRIVE_TILE).

export const DRIVE_TILE_SIZE = 56;

export function DriveTile({
  kind,
  icon,
  label,
  selected,
  onPress,
  testID,
  accessibilityLabel,
}: {
  kind: DriveTileKind;
  icon: IconName;
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const c = DRIVE_TILE[kind];
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={selected != null ? { selected } : undefined}
      style={styles.wrap}
      testID={testID}
    >
      <View style={[styles.disc, { backgroundColor: c.fill }, selected && styles.selected]}>
        <Icon name={icon} size={26} color={c.glyph} />
      </View>
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", minWidth: 64, gap: 6 },
  disc: { width: DRIVE_TILE_SIZE, height: DRIVE_TILE_SIZE, borderRadius: DRIVE_TILE_SIZE / 2, alignItems: "center", justifyContent: "center" },
  // A white ring marks the chosen category (on the dark sheet).
  selected: { borderWidth: 3, borderColor: WHITE },
  label: { fontSize: 13, fontWeight: "600", color: WHITE },
  labelSelected: { fontWeight: "800" },
});
