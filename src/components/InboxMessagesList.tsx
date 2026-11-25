import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { colors, pressedOpacity, radius, spacing } from "@/theme/tokens";
import { useAuth } from "@/context/AuthContext";
import { localised, phoneLanguage, reportInboxEvent, subscribeInbox, type InboxMessage } from "@/services/inboxMessages";
import { openDeepLink } from "@/navigation/deepLinks";

// Inbox > Messages from TrackLine (dashboard messages and support replies). Opening one is
// counted once on the dashboard's message results.
export function InboxMessagesList() {
  const { user } = useAuth();
  const [list, setList] = useState<InboxMessage[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => (user ? subscribeInbox(user.uid, setList) : undefined), [user]);
  if (!list.length) return null;
  const lang = phoneLanguage();
  return (
    <View style={styles.wrap} testID="inbox-messages">
      <Text style={styles.section}>Messages from TrackLine</Text>
      {list.map((m) => {
        const t = localised(m, lang);
        const open = openId === m.id;
        return (
          <Pressable
            key={m.id}
            onPress={() => {
              setOpenId(open ? null : m.id);
              if (!m.openedAtMs) reportInboxEvent(m.id, "opened");
            }}
            style={({ pressed }) => [styles.card, pressed && { opacity: pressedOpacity }]}
            accessibilityRole="button"
          >
            <View style={styles.row}>
              {!m.openedAtMs && <View style={styles.dot} />}
              <Text style={styles.title} numberOfLines={open ? undefined : 1}>{t.title}</Text>
            </View>
            <Text style={styles.body} numberOfLines={open ? undefined : 2}>{t.body}</Text>
            <Text style={styles.from}>{`${m.from} · ${new Date(m.createdAtMs).toLocaleDateString()}`}</Text>
            {open && m.button && (
              <Pressable onPress={() => (reportInboxEvent(m.id, "clicked"), openDeepLink(m.button!.deepLink))} hitSlop={8}>
                <Text style={styles.link}>{t.buttonLabel || m.button.label}</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}
      <Text style={styles.section}>Alerts near you</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  body: { fontSize: 14, color: colors.text },
  from: { fontSize: 12, color: colors.textMuted },
  link: { fontSize: 15, fontWeight: "700", color: colors.accent, marginTop: spacing.xs },
});
