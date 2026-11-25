import React, { useEffect, useMemo, useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { colors, radius, spacing } from "@/theme/tokens";
import { useAppConfig } from "@/remote/useAppConfig";
import { shouldShowWhatsNew, updateState } from "@/remote/appConfig";
import { useAuth } from "@/context/AuthContext";
import { activeAnnouncement, activeBanner, localised, phoneLanguage, reportInboxEvent, subscribeInbox, type InboxMessage } from "@/services/inboxMessages";
import { openDeepLink } from "@/navigation/deepLinks";
import { useHoldPrompts, usePermissionQueue } from "@/services/permissionQueue";

// Everything the owner dashboard can put in front of a user without a new build: a forced or
// soft "update available", maintenance (banner or block), What's New once after updating, a
// dismissible banner, and a full-screen announcement. Mounted once, above the navigator.

const WHATS_NEW_KEY = "@trackline/whatsNewSeen";
const SOFT_UPDATE_KEY = "@trackline/softUpdateDismissed";

export function storeUrl(): string {
  const cfg = Constants.expoConfig as { ios?: { appStoreUrl?: string; bundleIdentifier?: string }; android?: { package?: string } } | null;
  if (Platform.OS === "android") return `market://details?id=${cfg?.android?.package ?? ""}`;
  return cfg?.ios?.appStoreUrl || "itms-apps://apps.apple.com/search?term=TrackLine";
}

export function AppGates() {
  const cfg = useAppConfig();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const version = Application.nativeApplicationVersion ?? null;
  const upd = updateState(cfg, Platform.OS, version);
  const [whatsNewSeen, setWhatsNewSeen] = useState<string | null | undefined>(undefined);
  const [softDismissed, setSoftDismissed] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const lang = phoneLanguage();
  const queue = usePermissionQueue();

  useEffect(() => {
    AsyncStorage.multiGet([WHATS_NEW_KEY, SOFT_UPDATE_KEY])
      .then(([[, w], [, s]]) => {
        setWhatsNewSeen(w);
        setSoftDismissed(s);
      })
      .catch(() => setWhatsNewSeen(null));
  }, []);
  useEffect(() => (user ? subscribeInbox(user.uid, setInbox) : undefined), [user]);

  const banner = useMemo(() => activeBanner(inbox), [inbox]);
  const announcement = useMemo(() => activeAnnouncement(inbox), [inbox]);
  const softKey = `${Platform.OS}:${(cfg.minVersion as Record<string, { soft: string | null } | undefined>)[Platform.OS]?.soft ?? ""}`;

  // One at a time (permissionQueue.ts): a card waits while a permission prompt is on screen or
  // about to be, and while it's up it holds the prompts back. Once up, prompts asked meanwhile
  // wait for it (the queue is held), so the card doesn't flicker away. What's new first, then an
  // announcement.
  const promptTurn = queue.open !== null || (queue.waiting.length > 0 && queue.holds === 0);
  const wantWhatsNew = whatsNewSeen !== undefined && shouldShowWhatsNew(cfg, version, whatsNewSeen);
  const showWhatsNew = wantWhatsNew && !promptTurn;
  const ann = !wantWhatsNew && !promptTurn ? announcement : null;
  useHoldPrompts(showWhatsNew || !!ann);

  if (upd === "force") {
    return (
      <View style={[styles.block, { paddingTop: insets.top + spacing.xxl }]} testID="gate-force-update">
        <Icon name="download-outline" size={56} color={colors.primary} />
        <Text style={styles.blockTitle}>Update TrackLine</Text>
        <Text style={styles.blockText}>This version is no longer supported. Update to keep driving with TrackLine.</Text>
        <Button variant="primary" label="Update" onPress={() => Linking.openURL(storeUrl())} fullWidth size="large" />
      </View>
    );
  }
  if (cfg.maintenance.mode === "block") {
    return (
      <View style={[styles.block, { paddingTop: insets.top + spacing.xxl }]} testID="gate-maintenance-block">
        <Icon name="construct-outline" size={56} color={colors.warning} />
        <Text style={styles.blockTitle}>Back soon</Text>
        <Text style={styles.blockText}>{cfg.maintenance.message}</Text>
      </View>
    );
  }

  const strips: React.ReactNode[] = [];
  if (cfg.maintenance.mode === "banner") {
    strips.push(
      <View key="maint" style={[styles.strip, styles.stripWarn]} testID="gate-maintenance-banner">
        <Text style={styles.stripText}>{cfg.maintenance.message}</Text>
      </View>
    );
  }
  if (upd === "soft" && softDismissed !== softKey) {
    strips.push(
      <View key="soft" style={styles.strip} testID="gate-soft-update">
        <Text style={styles.stripText}>An update is available.</Text>
        <Pressable onPress={() => Linking.openURL(storeUrl())} hitSlop={8}>
          <Text style={styles.stripLink}>Update</Text>
        </Pressable>
        <Pressable onPress={() => (setSoftDismissed(softKey), AsyncStorage.setItem(SOFT_UPDATE_KEY, softKey).catch(() => {}))} hitSlop={8} accessibilityLabel="Dismiss">
          <Icon name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  }
  if (banner) {
    const t = localised(banner, lang);
    strips.push(
      <View key="banner" style={styles.strip} testID="gate-message-banner">
        <Pressable
          style={{ flex: 1 }}
          onPress={() => {
            reportInboxEvent(banner.id, banner.button ? "clicked" : "opened");
            if (banner.button) openDeepLink(banner.button.deepLink);
          }}
        >
          <Text style={styles.stripTitle}>{t.title}</Text>
          <Text style={styles.stripText} numberOfLines={2}>{t.body}</Text>
        </Pressable>
        <Pressable onPress={() => reportInboxEvent(banner.id, "dismissed")} hitSlop={8} accessibilityLabel="Dismiss">
          <Icon name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  }


  const annText = ann ? localised(ann, lang) : null;

  return (
    <>
      {strips.length > 0 && (
        <View pointerEvents="box-none" style={[styles.strips, { top: insets.top + 64 }]}>
          {strips}
        </View>
      )}
      <Modal visible={showWhatsNew} animationType="slide" transparent onRequestClose={() => undefined}>
        <View style={styles.modalBack}>
          <View style={styles.card} testID="gate-whats-new">
            <Text style={styles.blockTitle}>{cfg.whatsNew.title || "What's new"}</Text>
            {cfg.whatsNew.items.map((line) => (
              <Text key={line} style={styles.bullet}>{`• ${line}`}</Text>
            ))}
            <Button
              variant="primary"
              label="Got it"
              fullWidth
              onPress={() => {
                const v = cfg.whatsNew.version;
                setWhatsNewSeen(v);
                if (v) AsyncStorage.setItem(WHATS_NEW_KEY, v).catch(() => {});
              }}
            />
          </View>
        </View>
      </Modal>
      <Modal visible={!!ann} animationType="fade" onRequestClose={() => ann && reportInboxEvent(ann.id, "dismissed")}>
        {ann && annText && (
          <ScrollView contentContainerStyle={[styles.full, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} testID="gate-announcement">
            {ann.imageUrl && <Image source={{ uri: ann.imageUrl }} style={styles.image} resizeMode="cover" />}
            <Text style={styles.blockTitle}>{annText.title}</Text>
            <Text style={styles.blockText}>{annText.body}</Text>
            {ann.button && (
              <Button
                variant="primary"
                label={annText.buttonLabel || ann.button.label}
                fullWidth
                onPress={() => {
                  reportInboxEvent(ann.id, "clicked");
                  openDeepLink(ann.button!.deepLink);
                }}
              />
            )}
            <Button variant="secondary" label="Close" fullWidth onPress={() => reportInboxEvent(ann.id, "opened")} />
          </ScrollView>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  block: { ...StyleSheet.absoluteFill, backgroundColor: colors.surface, alignItems: "center", padding: spacing.xl, gap: spacing.lg, zIndex: 1000 },
  blockTitle: { fontSize: 24, fontWeight: "700", color: colors.text, textAlign: "center" },
  blockText: { fontSize: 16, color: colors.textMuted, textAlign: "center" },
  strips: { position: "absolute", left: spacing.md, right: spacing.md, gap: spacing.sm, zIndex: 900 },
  strip: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, minHeight: 48 },
  stripWarn: { borderColor: colors.warning },
  stripTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  stripText: { flex: 1, fontSize: 14, color: colors.text },
  stripLink: { fontSize: 14, fontWeight: "700", color: colors.accent },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  card: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: spacing.xl, gap: spacing.md },
  bullet: { fontSize: 16, color: colors.text },
  full: { padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.surface, flexGrow: 1 },
  image: { width: "100%", height: 200, borderRadius: radius.md },
});
