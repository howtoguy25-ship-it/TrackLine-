// Fix pass 7 §1: "Is the exit on <road> open?" -- a small card above the ETA bar, our own gate
// icon, [Open] [Closed]. Shown only while stopped or under 10 km/h (nav/exitGates.ts canAskNow).
// No answer in 8 s = keep the route.
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { ASK_SECONDS } from "@/nav/exitGates";
import { SURFACES } from "@/theme/colors";
import { radius, shadow, spacing } from "@/theme/tokens";

/** TrackLine's gate: a post with a striped barrier arm. */
export function GateIcon({ size = 36, color = "#E0A53A" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" testID="gate-icon">
      <Rect x={5} y={10} width={5} height={22} rx={1.5} fill="#5B6472" />
      <Circle cx={7.5} cy={12} r={3.2} fill="#5B6472" />
      <Rect x={8} y={9.5} width={25} height={5} rx={2.5} fill="#FFFFFF" stroke={color} strokeWidth={1.4} />
      {[12, 18, 24, 30].map((x) => (
        <Line key={x} x1={x} y1={9.8} x2={x + 2.6} y2={14.2} stroke={color} strokeWidth={2.4} />
      ))}
      <Rect x={3} y={31} width={30} height={2} rx={1} fill="#9AA3AF" />
    </Svg>
  );
}

interface Props {
  question: string;
  bottom: number;
  scheme: "light" | "dark";
  onOpen: () => void;
  onClosed: () => void;
  /** No answer within 8 s: keep the route. */
  onTimeout: () => void;
}

export function ExitGateCard({ question, bottom, scheme, onOpen, onClosed, onTimeout }: Props) {
  const s = SURFACES[scheme];
  useEffect(() => {
    const t = setTimeout(onTimeout, ASK_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [onTimeout]);
  return (
    <View style={[styles.card, { bottom, backgroundColor: s.sheet }]} testID="exit-gate-card" accessibilityRole="alert">
      <View style={styles.row}>
        <GateIcon />
        <Text style={[styles.text, { color: s.text }]} numberOfLines={2}>
          {question}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button variant="secondary" label="Open" onPress={onOpen} style={styles.btn} testID="exit-gate-open" />
        <Button variant="primary" label="Closed" onPress={onClosed} style={styles.btn} testID="exit-gate-closed" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute", left: spacing.md, right: spacing.md, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...shadow.medium },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  text: { flex: 1, fontSize: 16, fontWeight: "700" },
  actions: { flexDirection: "row", gap: spacing.sm },
  btn: { flex: 1 },
});
