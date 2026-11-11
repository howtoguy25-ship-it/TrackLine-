import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet, ScrollView, Share, Alert, ActivityIndicator } from "react-native";
import { Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { Tracky } from "@/components/trackys/Tracky";
import { useTrackyAppearance } from "@/hooks/useTrackyAppearance";
import { subscribeVisibleAlerts, getInboxLastViewedAt } from "@/services/alerts";
import type { AlertDoc } from "@/types/alert";
import {
  getUpcomingEventsWithLocation,
  getCalendarPermissionStatus,
  requestCalendarAccess,
  type UpcomingDriveEvent,
} from "@/services/calendarEvents";
import { searchPlaces, getPlaceDetails } from "@/services/places";

// Waze-style main menu, opened from the Menu button on the home map (see MapScreen.tsx). The
// full designed panel per Phase 4: a real Tracky mascot greeting, a "Plan a drive" card, real
// upcoming calendar events with a location, a real Inbox row with an unread badge, Invite a
// friend (native Share), and Help -- alongside the already-existing Sign in/Account and
// Settings rows.
export function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const { settings } = useSettings();
  const isSignedIn = !!user && !user.isAnonymous;
  const isGhostMode = settings.visibility === "ghost";
  const appearance = useTrackyAppearance(isGhostMode);
  const firstName = (user?.displayName ?? "").split(" ")[0];

  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    let lastViewedAt = 0;
    getInboxLastViewedAt().then((v) => (lastViewedAt = v));
    return subscribeVisibleAlerts(settings.visibleRegions, user.uid, (alerts: AlertDoc[]) => {
      setUnreadCount(alerts.filter((a) => a.createdAt > lastViewedAt).length);
    });
  }, [user, settings.visibleRegions]);

  const [calendarStatus, setCalendarStatus] = useState<"granted" | "denied" | "undetermined" | null>(null);
  const [events, setEvents] = useState<UpcomingDriveEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  useEffect(() => {
    getCalendarPermissionStatus().then((status) => {
      setCalendarStatus(status);
      if (status === "granted") {
        setEventsLoading(true);
        getUpcomingEventsWithLocation()
          .then(setEvents)
          .finally(() => setEventsLoading(false));
      }
    });
  }, []);

  const onConnectCalendar = async () => {
    const granted = await requestCalendarAccess();
    setCalendarStatus(granted ? "granted" : "denied");
    if (granted) {
      setEventsLoading(true);
      getUpcomingEventsWithLocation()
        .then(setEvents)
        .finally(() => setEventsLoading(false));
    }
  };

  const [drivingToEventId, setDrivingToEventId] = useState<string | null>(null);
  const onDriveToEvent = async (event: UpcomingDriveEvent) => {
    setDrivingToEventId(event.id);
    try {
      const predictions = await searchPlaces(event.location);
      if (predictions.length === 0) {
        Alert.alert("Couldn't find that address", `No match found for "${event.location}".`);
        return;
      }
      const place = await getPlaceDetails(predictions[0].placeId);
      navigation.navigate("Map", { planADriveDestination: place });
    } catch {
      Alert.alert("Couldn't look up that address", "Check your connection and try again.");
    } finally {
      setDrivingToEventId(null);
    }
  };

  const onInviteFriend = () => {
    Share.share({
      message: "Drive smarter with TrackLine -- real-time police, hazard and camera alerts from other drivers. Get it here: https://tracklinemaps.com",
    }).catch(() => {});
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: pressedOpacity }]}
          accessibilityLabel="Close menu"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.mascotRow}>
          {appearance.mode === "custom" ? (
            <Tracky customization={appearance.customization} size={96} />
          ) : (
            <Tracky mood={appearance.displayMood} size={96} />
          )}
          <View style={styles.speechBubble}>
            <View style={styles.speechBubbleTail} />
            <Text style={styles.mascotGreeting}>{firstName ? `Hey ${firstName}!` : "Hey there!"}</Text>
            <Pressable onPress={() => navigation.navigate("TrackyProfile")} hitSlop={6}>
              <Text style={styles.viewProfileLink}>View profile</Text>
            </Pressable>
          </View>
        </View>

        {/* Real, explicit request -- "Pill on Menu header ... 'Visible to other drivers' <->
            'Ghost mode'." Tapping it jumps straight to the full Privacy picker (same one the
            Menu button's own long-press sheet offers) rather than duplicating a quick-toggle
            here too. */}
        <Pressable
          style={({ pressed }) => [
            styles.visibilityPill,
            isGhostMode && styles.visibilityPillGhost,
            pressed && { opacity: pressedOpacity },
          ]}
          onPress={() => navigation.navigate("Settings", { category: "privacy" })}
          accessibilityLabel={isGhostMode ? "Ghost mode. Tap to change" : "Visible to other drivers. Tap to change"}
        >
          <Ionicons name={isGhostMode ? "eye-off" : "eye"} size={14} color={isGhostMode ? colors.textMuted : colors.accent} />
          <Text style={[styles.visibilityPillText, isGhostMode && styles.visibilityPillTextGhost]}>
            {isGhostMode ? "Ghost mode" : "Visible to other drivers"}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.planCard, pressed && { opacity: pressedOpacity }]}
          onPress={() => navigation.navigate("PlanADrive")}
          accessibilityLabel="Plan a drive"
        >
          <View style={styles.planCardIconWrap}>
            <Ionicons name="calendar" size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.planCardTitle}>Plan a drive</Text>
            <Text style={styles.planCardSubtitle}>Pick a destination and check your ETA</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </Pressable>

        <MenuRow
          icon="person-circle-outline"
          label={isSignedIn ? `Signed in as ${user!.email ?? user!.displayName ?? "you"}` : "Sign in"}
          onPress={() => (isSignedIn ? navigation.navigate("Settings", { category: "account" }) : navigation.navigate("SignIn"))}
        />
        <MenuRow
          icon="mail-outline"
          label="Inbox"
          badge={unreadCount > 0 ? unreadCount : undefined}
          onPress={() => navigation.navigate("Inbox")}
        />
        <MenuRow icon="settings-outline" label="Settings" onPress={() => navigation.navigate("SettingsCategories")} />
        <MenuRow icon="person-add-outline" label="Invite a friend" onPress={onInviteFriend} />
        <MenuRow icon="help-circle-outline" label="Help" onPress={() => navigation.navigate("Help")} />

        <Text style={styles.sectionLabel}>Upcoming events</Text>
        {calendarStatus !== "granted" ? (
          <Pressable
            style={({ pressed }) => [styles.connectCalendarRow, pressed && { opacity: pressedOpacity }]}
            onPress={onConnectCalendar}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={styles.connectCalendarText}>Connect your calendar to see events with a location here</Text>
          </Pressable>
        ) : eventsLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
        ) : events.length === 0 ? (
          <Text style={styles.emptyEventsText}>No upcoming events with a location in the next 7 days.</Text>
        ) : (
          events.map((event) => (
            <Pressable
              key={event.id}
              style={({ pressed }) => [styles.eventRow, pressed && { opacity: pressedOpacity }]}
              onPress={() => onDriveToEvent(event)}
              disabled={drivingToEventId === event.id}
            >
              <View style={styles.eventIconWrap}>
                <Ionicons name="location" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event.title}
                </Text>
                <Text style={styles.eventLocation} numberOfLines={1}>
                  {event.location}
                </Text>
              </View>
              {drivingToEventId === event.id ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="navigate-outline" size={18} color={colors.accent} />
              )}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
      accessibilityLabel={label}
    >
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      {!!badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  mascotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  speechBubble: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    position: "relative",
  },
  speechBubbleTail: {
    position: "absolute",
    left: -6,
    top: "50%",
    marginTop: -6,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderRightWidth: 8,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderRightColor: colors.surfaceMuted,
  },
  mascotGreeting: { fontSize: 15, fontWeight: "800", color: colors.text },
  viewProfileLink: { fontSize: 12, fontWeight: "700", color: colors.accent, marginTop: 2 },
  visibilityPill: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    marginBottom: spacing.md,
  },
  visibilityPillGhost: { backgroundColor: colors.surfaceMuted },
  visibilityPillText: { fontSize: 12, fontWeight: "700", color: colors.accent },
  visibilityPillTextGhost: { color: colors.textMuted },
  planCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.medium,
  },
  planCardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  planCardTitle: { fontSize: 15, fontWeight: "800", color: "#FFFFFF" },
  planCardSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.low,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800", color: "#FFFFFF" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs },
  connectCalendarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  connectCalendarText: { flex: 1, fontSize: 13, color: colors.textMuted },
  emptyEventsText: { fontSize: 13, color: colors.textFaint, paddingVertical: spacing.sm },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  eventIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  eventTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  eventLocation: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
});
