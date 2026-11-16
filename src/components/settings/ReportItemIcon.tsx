import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { REPORT_ITEM_BY_ID, type ReportItemId } from "@/settings/reportCatalog";

// Each Reports item's own icon: a rounded tile in the item's colour with its main glyph, plus a
// small round badge (or two) in the corner when the item combines two things -- a camera with a
// speedometer, a camera with a traffic light, a camera with a stop sign. Our own composition of
// MaterialCommunityIcons glyphs (Apache 2.0, already used across the app).

export function ReportItemIcon({ id, size = 40 }: { id: ReportItemId; size?: number }) {
  const { icon } = REPORT_ITEM_BY_ID[id];
  const badge = size * 0.46;
  return (
    <View style={{ width: size, height: size }} testID={`report-icon-${id}`}>
      <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: icon.colour }]}>
        <MaterialCommunityIcons name={icon.glyph as never} size={size * 0.6} color="#FFFFFF" />
      </View>
      {icon.badge && (
        <View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2, right: -badge * 0.2, bottom: -badge * 0.2 }]}>
          <MaterialCommunityIcons name={icon.badge as never} size={badge * 0.7} color={icon.colour} />
        </View>
      )}
      {icon.badge2 && (
        <View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2, left: -badge * 0.2, bottom: -badge * 0.2 }]}>
          <MaterialCommunityIcons name={icon.badge2 as never} size={badge * 0.7} color={icon.colour} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  badge: { position: "absolute", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E3E6EB" },
});
