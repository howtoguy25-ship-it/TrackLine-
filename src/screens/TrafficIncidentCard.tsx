import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatIncidentAge, incidentStyle, type NearbyIncident } from "@/services/trafficNswModel";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";

// The card shown when a Live Traffic NSW pin is tapped. Everything on it is Transport for NSW's
// own report, lightly tidied -- the category, where, the delay if they give one, their advice,
// and how long ago they last updated it.

interface Props {
  incident: NearbyIncident | null;
  /** True when the incident lies on the route currently being driven. */
  onRoute: boolean;
  distanceText: string;
  /** When the pin was tapped -- "updated 4 min ago" is measured against this. */
  openedAtMs: number;
  onClose: () => void;
}

export function TrafficIncidentCard({ incident, onRoute, distanceText, openedAtMs, onClose }: Props) {
  const insets = useSafeAreaInsets();
  if (!incident) return null;
  const style = incidentStyle(incident);
  const age = formatIncidentAge(incident.updatedAt, openedAtMs);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { marginBottom: insets.bottom + spacing.lg }]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: style.color }]}>
              <Ionicons name={style.icon} size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {style.label}
                {incident.major ? " · Major" : ""}
              </Text>
              {!!incident.where && <Text style={styles.where}>{incident.where}</Text>}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.chips}>
            {onRoute && <Text style={[styles.chip, styles.chipWarn]}>On your route</Text>}
            <Text style={styles.chip}>{distanceText} away</Text>
            {!!incident.delay && <Text style={styles.chip}>Delay: {incident.delay}</Text>}
          </View>

          {!!incident.headline && incident.headline !== incident.category && (
            <Text style={styles.headline}>{incident.headline}</Text>
          )}
          {!!incident.advice && <Text style={styles.advice}>{incident.advice}</Text>}

          <Text style={styles.source}>
            Transport for NSW{age ? ` · updated ${age}` : ""}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end", paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, ...shadow.high },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: colors.text },
  where: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  chipWarn: { color: "#B45309", backgroundColor: "#FEF3C7" },
  headline: { fontSize: 14, fontWeight: "600", color: colors.text },
  advice: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  source: { fontSize: 11, color: colors.textFaint, marginTop: spacing.xs },
});
