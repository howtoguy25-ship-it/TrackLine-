// Startup §2: the white pill that slides up above the "Where to?" sheet with one real message at
// a time -- our Tracky and "1,250 Trackys around you" (or "3 reports near you"). It rides the
// sheet's edge above the Report / street-pill row, stays 5 s, and slides away. Tap: the map
// zooms out a little to show the Trackys nearby.
import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { SlideInDown, SlideOutDown, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Text } from "@/components/AppText";
import { Tracky } from "@/components/trackys/Tracky";
import { Icon } from "@/components/ui/Icon";
import { FLOATING_GAP, streetPillMaxWidth } from "@/map/homeMapLogic";
import type { PillMessage } from "@/map/homePill";
import { SURFACES, type Scheme } from "@/theme/colors";
import { shadow } from "@/theme/tokens";

/**
 * In the street pill's slot (on the Report button's baseline), which it takes over while it shows:
 * above that row it would cover the arrow, now at ~72% of the screen. Never wider than the gap
 * between Report and the left edge (streetPillMaxWidth).
 */
export const PILL_ABOVE_SHEET = FLOATING_GAP;

export function HomeInfoPill({ message, sheetVisibleHeight, scheme, onPress }: { message: PillMessage; sheetVisibleHeight: SharedValue<number>; scheme: Scheme; onPress: () => void }) {
  const s = SURFACES[scheme];
  const { width } = useWindowDimensions();
  const pos = useAnimatedStyle(() => ({ bottom: sheetVisibleHeight.value + PILL_ABOVE_SHEET }));
  return (
    <Animated.View pointerEvents="box-none" style={[styles.row, pos]} entering={SlideInDown.duration(280)} exiting={SlideOutDown.duration(240)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={message.text}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, { backgroundColor: s.sheet, opacity: pressed ? 0.92 : 1, maxWidth: streetPillMaxWidth(width, 56) }]}
        testID={`home-pill-${message.kind}`}
      >
        <View style={styles.icon}>
          {message.kind === "trackys" ? <Tracky mood="happy" size={30} animated={false} reactOnTap={false} /> : <Icon name="warning" size={20} color={s.text} />}
        </View>
        <Text style={[styles.text, { color: s.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
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
  text: { flexShrink: 1, fontSize: 15, fontWeight: "600" },
});
