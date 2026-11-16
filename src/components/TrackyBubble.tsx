import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { Tracky } from "@/components/trackys/Tracky";
import { TRACKY_MOODS } from "@/components/trackys/moods";
import type { PresenceDoc } from "@/services/presence";
import { colors, radius, shadow, spacing } from "@/theme/tokens";

// Tap a Tracky on the map: a small bubble with who it is (their name only if they chose to show
// it), their mood, how fresh the position is, a Wave, and "More" for the full card (block,
// report). It never shows anything the presence doc doesn't already carry.

export function presenceAgeText(updatedAtMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - updatedAtMs) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function TrackyBubble({
  presence,
  nowMs,
  onWave,
  onMore,
  onClose,
  top,
}: {
  presence: PresenceDoc;
  nowMs: number;
  onWave: () => Promise<string>;
  onMore: () => void;
  onClose: () => void;
  top: number;
}) {
  const [waveNote, setWaveNote] = useState<string | null>(null);
  const name = presence.displayName?.trim() || "A Tracky";
  const mood = presence.look ? null : TRACKY_MOODS[presence.mood]?.label;
  return (
    <View style={[styles.bubble, { top }]} testID="tracky-bubble" accessibilityLabel={`${name}${mood ? `, ${mood}` : ""}, ${presenceAgeText(presence.updatedAt, nowMs)}`}>
      <View style={styles.row}>
        {presence.look ? (
          <Tracky customization={presence.look} size={40} animated={false} reactOnTap={false} />
        ) : (
          <Tracky mood={presence.mood} size={40} animated={false} reactOnTap={false} />
        )}
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sub}>{[mood, presenceAgeText(presence.updatedAt, nowMs)].filter(Boolean).join(" · ")}</Text>
        </View>
        <Button variant="ghost" icon="close" onPress={onClose} accessibilityLabel="Close" />
      </View>
      {waveNote && <Text style={styles.note}>{waveNote}</Text>}
      <View style={styles.actions}>
        <Button variant="primary" label="Wave" icon="hand-left" onPress={() => onWave().then(setWaveNote)} accessibilityLabel={`Wave to ${name}`} testID="tracky-wave" />
        <Button variant="secondary" label="More" onPress={onMore} accessibilityLabel="More about this driver" testID="tracky-more" />
      </View>
      <View style={styles.pointer} />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { position: "absolute", left: spacing.lg, right: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...shadow.medium },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted },
  note: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: "row", gap: spacing.sm },
  pointer: { position: "absolute", bottom: -8, alignSelf: "center", width: 16, height: 16, backgroundColor: colors.surface, transform: [{ rotate: "45deg" }] },
});
