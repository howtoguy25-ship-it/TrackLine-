// Startup §2: the white pill that slides up above the "Where to?" sheet with one real message at
// a time -- our Tracky and "1,250 Trackys around you" (or "3 reports near you"). It rides the
// sheet's edge above the Report / street-pill row, stays 5 s, and slides away. Tap: the map
// zooms out a little to show the Trackys nearby.
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { Tracky } from "@/components/trackys/Tracky";
import { Icon } from "@/components/ui/Icon";
import { FLOATING_GAP } from "@/map/homeMapLogic";
import type { PillMessage } from "@/map/homePill";
import { SURFACES, type Scheme } from "@/theme/colors";
import { shadow } from "@/theme/tokens";

/** Above the Report button row: one 56pt button and a 12pt gap over the sheet's edge. */
export const PILL_ABOVE_SHEET = FLOATING_GAP + 56 + 12;

export function HomeInfoPill({ message, sheetVisibleHeight, scheme, onPress }: { message: PillMessage; sheetVisibleHeight: SharedValue<number>; scheme: Scheme; onPress: () => void }) {
  const s = SURFACES[scheme];
  const pos = useAnimatedStyle(() => ({ bottom: sheetVisibleHeight.value + PILL_ABOVE_SHEET }));
  return (
    <Animated.View pointerEvents="box-none" style={[styles.row, pos]} entering={SlideInDown.duration(280)} exiting={SlideOutDown.duration(240)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={message.text}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, { backgroundColor: s.sheet, opacity: pressed ? 0.92 : 1 }]}
        testID={`home-pill-${message.kind}`}
      >
        <View style={styles.icon}>
          {message.kind === "trackys" ? <Tracky mood="happy" size={30} animated={false} reactOnTap={false} /> : <Icon name="warning" size={20} color={s.text} />}
        </View>
        <Text style={[styles.text, { color: s.text }]} numberOfLines={1}>
          {message.text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingLeft: 8, paddingRight: 16, borderRadius: 22, ...shadow.floating },
  icon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 15, fontWeight: "600" },
});
