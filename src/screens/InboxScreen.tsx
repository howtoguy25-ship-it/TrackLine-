import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "@/context/LocationContext";
import { useSettings } from "@/context/SettingsContext";
import { subscribeVisibleAlerts, hideAlertForUser, unhideAlertForUser, markInboxViewedNow } from "@/services/alerts";
import { haversineMeters } from "@/services/places";
import type { AlertDoc, AlertType } from "@/types/alert";
import { ALERT_LABELS, ALERT_ICONS, ALERT_COLORS } from "@/types/alert";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { Tracky } from "@/components/trackys/Tracky";

// Real, explicit request (Waze-style redesign Phase 4 -- main menu's Inbox row). A live feed of
// every real community alert currently visible to this driver (same subscribeVisibleAlerts
// subscription/visibleRegions scoping MapScreen's own map layer already uses -- not a separate
// or mocked data source), newest first, with distance from the driver's own current position
// when a fix is available. "Delete" hides the alert for THIS driver only (hideAlertForUser --
// the same real, already-existing, genuinely reversible 1-hour self-hide AlertDetailSheet's own
// Hide button uses), with a real Undo that reverses it outright (unhideAlertForUser) rather than
// just waiting out whatever's left of the hour -- this is a personal "remove from my inbox"
// action, not the separate owner-only permanent delete AlertDetailSheet also offers on the map
// itself, which stays exactly as it was.
function timeAgo(timestampMs: number): string {
  const diffMin = Math.max(0, Math.round((Date.now() - timestampMs) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  return `${hours} hr${hours === 1 ? "" : "s"} ago`;
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

// Real distinction, not cosmetic -- police/emergency-vehicle reports are the "official" category
// the device-test checklist calls out separately from the plain road-condition reports
// (hazard/crash/camera/traffic_light), shown with a small "Official" tag so they read as a
// different kind of alert at a glance.
const OFFICIAL_TYPES = new Set<AlertType>(["police", "emergency_vehicle"]);

function alertIconGlyph(type: AlertType): { name: string; set: "mci" | "mi" } {
  // Mirrors AlertTypeGlyph's own special-case: MaterialCommunityIcons has no dedicated crash
  // icon, MaterialIcons' "car-crash" is the real one already used elsewhere in this app.
  if (type === "crash") return { name: "car-crash", set: "mi" };
  return { name: ALERT_ICONS[type], set: "mci" };
}

export function InboxScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const { location } = useLocation();
  const { settings } = useSettings();

  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [undoState, setUndoState] = useState<{ alert: AlertDoc; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    markInboxViewedNow();
  }, []);

  useEffect(() => {
    if (!user) return;
    return subscribeVisibleAlerts(settings.visibleRegions, user.uid, setAlerts);
  }, [user, settings.visibleRegions]);

  // Undo-pending alert stays hidden from Firestore's own real-time list the instant Delete is
  // tapped (hideAlertForUser already wrote it), but kept visible here, greyed out, for the real
  // Undo window -- without this the row would just vanish immediately with nothing left to undo.
  const displayedAlerts = useMemo(() => {
    if (!undoState || alerts.some((a) => a.id === undoState.alert.id)) return alerts;
    return [undoState.alert, ...alerts].sort((a, b) => b.createdAt - a.createdAt);
  }, [alerts, undoState]);

  const onDelete = async (alert: AlertDoc) => {
    if (!user) return;
    if (undoState) clearTimeout(undoState.timer);
    await hideAlertForUser(alert.id, user.uid);
    const timer = setTimeout(() => setUndoState(null), 5000);
    setUndoState({ alert, timer });
  };

  const onUndo = async () => {
    if (!undoState || !user) return;
    clearTimeout(undoState.timer);
    await unhideAlertForUser(undoState.alert.id, user.uid);
    setUndoState(null);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close inbox"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <FlatList
        data={displayedAlerts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xxl }]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Tracky mood="sleepy" size={56} animated={false} reactOnTap={false} />
            <Text style={styles.emptyText}>No alerts right now.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isPendingUndo = undoState?.alert.id === item.id;
          const glyph = alertIconGlyph(item.type);
          const distanceText = location
            ? formatDistance(haversineMeters(location.coords, { latitude: item.lat, longitude: item.lng }))
            : null;
          return (
            <View style={[styles.row, isPendingUndo && styles.rowPendingUndo]}>
              <View style={[styles.iconWrap, { backgroundColor: ALERT_COLORS[item.type] }]}>
                {glyph.set === "mi" ? (
                  <MaterialIcons name={glyph.name as any} size={20} color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name={glyph.name as any} size={20} color="#FFFFFF" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle}>{ALERT_LABELS[item.type]}</Text>
                  {OFFICIAL_TYPES.has(item.type) && (
                    <View style={styles.officialTag}>
                      <Text style={styles.officialTagText}>Official</Text>
                    </View>
                  )}
                </View>
                {!!item.comment && (
                  <Text style={styles.rowComment} numberOfLines={1}>
                    {item.comment}
                  </Text>
                )}
                <Text style={styles.rowMeta}>
                  {timeAgo(item.createdAt)}
                  {distanceText ? ` · ${distanceText} away` : ""}
                </Text>
              </View>
              {isPendingUndo ? (
                <Pressable onPress={onUndo} hitSlop={8} style={styles.undoButton}>
                  <Text style={styles.undoButtonText}>Undo</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => onDelete(item)} hitSlop={8} accessibilityLabel="Delete">
                  <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
                </Pressable>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: { gap: spacing.xs },
  emptyState: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxl * 2 },
  emptyText: { fontSize: 14, color: colors.textMuted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPendingUndo: { opacity: 0.45 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  officialTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  officialTagText: { fontSize: 10, fontWeight: "800", color: colors.accent },
  rowComment: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  rowMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  undoButton: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  undoButtonText: { fontSize: 12, fontWeight: "800", color: colors.accent },
});
