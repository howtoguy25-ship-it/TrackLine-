import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Image, StyleSheet, Switch, ScrollView, Pressable, Modal, TextInput, Alert, ActivityIndicator } from "react-native";
import Slider from "@react-native-community/slider";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { usePowerState } from "expo-battery";
import { useIAP } from "react-native-iap";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { syncVisibleRegionsToProfile } from "@/services/userProfile";
import { setVoiceEnabled } from "@/services/voice";
import {
  signOutUser,
  deleteAccount,
  currentUserProviderId,
  reauthenticateWithAppleCredential,
  reauthenticateWithGoogleCredential,
} from "@/services/firebase";
import { env } from "@/config/env";
import { Sentry } from "@/services/sentry";
import { REV_CHECK_PRODUCT_ID } from "@/services/iap";
import { getRevCheckProviderConfig, saveRevCheckProviderConfig } from "@/services/revCheckAdmin";
import { isOwnerEmail } from "@/config/admin";
import { BUSINESS_INFO } from "@/config/business";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import { ALL_ALERT_TYPES } from "@/services/settings";
import { ALERT_LABELS, type AlertType } from "@/types/alert";
import { AU_STATES, type AuRegionCode } from "@/utils/auStates";
import { MAP_THEME_LABELS, type MapThemeKey } from "@/utils/mapStyle";
import { NAV_CARD_THEME_LABELS, NAV_CARD_THEMES, type NavCardThemeKey } from "@/utils/navCardTheme";
import { MAP_MARKER_STYLE_LABELS, MAP_MARKER_STYLE_ICONS, type MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { ALERT_ICON_THEME_LABELS, type AlertIconThemeKey } from "@/utils/alertIconThemes";
import { AlertTypeGlyph } from "@/components/AlertTypeGlyph";
import { TRAFFIC_LIGHT_MARKER, SPEED_CAMERA_MARKER } from "@/utils/osmMarkerStyle";
import type { RootStackParamList } from "@/navigation/RootNavigator";

function sensitivityLabel(value: number): string {
  if (value <= 0.4) return "Low";
  if (value <= 0.7) return "Medium";
  return "High";
}

// Real, applied durations -- selecting one of these (or a custom hour/minute value below)
// writes straight into settings.alertExpiryMs, which services/alerts.ts's reportAlert then
// uses as the real Firestore expiresAt for any alert this device reports, replacing the app's
// own per-type default (types/alert.ts's ALERT_TTL_MS) for as long as it's set. "Default"
// (null) reverts to that original per-type behavior.
const EXPIRY_PRESETS: { label: string; ms: number | null }[] = [
  { label: "Default", ms: null },
  { label: "12 hours", ms: 12 * 60 * 60 * 1000 },
  { label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
];

function formatExpiryMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// Small background/highway-accent pair per theme, just for the picker swatches below -- the
// real, full styling lives in utils/mapStyle.ts; this is only a preview.
const MAP_THEME_ORDER: MapThemeKey[] = ["normal", "purpleBlue", "blueGrey", "greenYellow"];
const MAP_THEME_SWATCH_COLORS: Record<MapThemeKey, [string, string]> = {
  normal: ["#14201a", "#34d976"],
  purpleBlue: ["#1a1033", "#8b7cf6"],
  blueGrey: ["#232a35", "#5b9bf0"],
  greenYellow: ["#0f2417", "#facc15"],
};

const NAV_CARD_THEME_ORDER: NavCardThemeKey[] = ["dark", "light", "transparentDark", "midnight", "sunset", "forest"];
const MAP_MARKER_STYLE_ORDER: MapMarkerStyleKey[] = [
  "default",
  "car",
  "taxi",
  "policeCar",
  "ambulance",
  "fireTruck",
  "bus",
  "truck",
  "motorbike",
  "sportsCar",
  "helicopter",
  "tank",
];
const ALERT_ICON_THEME_ORDER: AlertIconThemeKey[] = ["default", "outline", "bold", "shield", "vivid", "night"];
// A representative sample (not every AlertType) for the alert-icon-theme preview tiles below --
// enough to show a pack's own distinct glyph/color identity without a 6-icon-wide tile.
const ALERT_ICON_PREVIEW_TYPES: AlertType[] = ["police", "crash", "hazard", "traffic_light"];

export function SettingsScreen() {
  const { settings, updateSettings } = useSettings();
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Every device is signed in anonymously from launch (see firebase.ts's ensureSignedIn) --
  // isAnonymous is the real signal for "hasn't actually signed in with an identity yet",
  // not just user being null/non-null.
  const isSignedIn = !!user && !user.isAnonymous;
  // Gates the REV check provider-key section below -- per explicit request, that section (a
  // real, paid business API credential) must only ever be visible to the app's owner, never any
  // other signed-in user. This is only the UI gate; firestore.rules' own isAdmin() check is what
  // actually stops a non-owner from reading/writing the underlying document even if they somehow
  // got this UI to render (defense in depth, not the only line of defense).
  const isOwner = isOwnerEmail(user?.email);

  useEffect(() => {
    if (!env.googleIosClientId) return;
    GoogleSignin.configure({ iosClientId: env.googleIosClientId });
  }, []);

  // Real, in-place fix for "Couldn't delete account -- sign out and back in, try again right
  // away" not actually working: that message asked the driver to manually sign out, run the
  // native Apple/Google sheet again, and race back here before Firebase's recency window
  // closed -- easy to fail even when followed exactly. Firebase's own fix for
  // auth/requires-recent-login is reauthenticateWithCredential: re-run the SAME native sign-in
  // flow the driver already used (same rawNonce/hashedNonce pattern as SignInScreen's Apple
  // flow) to get a fresh credential, hand it to Firebase to prove "this is really you, right
  // now," then retry the delete immediately after -- no sign-out round trip needed at all.
  // Email/password accounts fall back to the old message since re-prompting for a password here
  // would need its own dedicated UI.
  const reauthenticateCurrentUser = useCallback(async (): Promise<boolean> => {
    const providerId = currentUserProviderId();
    if (providerId === "apple.com") {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) return false;
      await reauthenticateWithAppleCredential(credential.identityToken, rawNonce);
      return true;
    }
    if (providerId === "google.com") {
      if (!env.googleIosClientId) return false;
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (response.type !== "success" || !response.data.idToken) return false;
      await reauthenticateWithGoogleCredential(response.data.idToken);
      return true;
    }
    return false;
  }, []);

  // Real account deletion -- see firebase.ts's deleteAccount for exactly what this does and
  // doesn't remove. Confirmed with a real destructive-action dialog first (Alert.alert), same
  // as any other irreversible action in this app.
  const [deletingAccount, setDeletingAccount] = useState(false);
  const onDeleteAccount = useCallback(() => {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your signed-in account. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingAccount(true);
            try {
              try {
                await deleteAccount();
              } catch (err) {
                const code = err instanceof Object && "code" in err ? String((err as any).code) : null;
                if (code !== "auth/requires-recent-login") throw err;
                const reauthed = await reauthenticateCurrentUser().catch((reauthErr) => {
                  // A cancelled native sheet (ERR_REQUEST_CANCELED / SIGN_IN_CANCELLED) is a
                  // real, expected outcome, not a failure worth logging as one.
                  const reauthCode =
                    reauthErr instanceof Object && "code" in reauthErr ? String((reauthErr as any).code) : null;
                  if (reauthCode !== "ERR_REQUEST_CANCELED" && reauthCode !== statusCodes.SIGN_IN_CANCELLED) {
                    Sentry.logger.error("settings: delete-account reauth failed", { error: String(reauthErr) });
                  }
                  return false;
                });
                if (!reauthed) throw err;
                await deleteAccount();
              }
            } catch (err) {
              const code = err instanceof Object && "code" in err ? String((err as any).code) : null;
              Alert.alert(
                "Couldn't delete account",
                code === "auth/requires-recent-login"
                  ? "For your security, sign out and sign back in, then try deleting your account again right away."
                  : "Something went wrong -- check your connection and try again."
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  }, []);

  // Real "Restore Purchases" -- required by App Store review whenever an app has any IAP, even
  // though the app's one product (a REV check, see iap.ts) is a Consumable, which Apple's own
  // restore mechanism doesn't restore by design (a consumable is meant to be used once, not
  // re-granted). getAvailablePurchases still surfaces one real, useful case for a consumable
  // though: a purchase that was PAID for but never finished/consumed (see RevCheckScreen's own
  // pendingPurchaseRef -- e.g. the app was killed right after payment, before a check result
  // could be delivered) shows up here as an unfinished transaction. Tapping this can't finish
  // that purchase itself (finishing it requires actually running the check it paid for, which
  // needs the VIN, only entered on RevCheckScreen) -- it just gives an honest answer either way
  // instead of a button that silently does nothing for the one real IAP this app has.
  const [restoringPurchases, setRestoringPurchases] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const restoreRequestedRef = useRef(false);
  const { getAvailablePurchases, availablePurchases } = useIAP({
    onError: () => {
      if (!restoreRequestedRef.current) return;
      restoreRequestedRef.current = false;
      setRestoringPurchases(false);
      setRestoreMessage("Couldn't check for purchases -- check your connection and try again.");
    },
  });
  useEffect(() => {
    if (!restoreRequestedRef.current) return;
    restoreRequestedRef.current = false;
    setRestoringPurchases(false);
    const hasPendingRevCheck = availablePurchases.some((p) => p.productId === REV_CHECK_PRODUCT_ID);
    setRestoreMessage(
      hasPendingRevCheck
        ? "Found a paid REV check that wasn't completed -- open Vehicle REV Check and run a check with the same VIN to finish it, free."
        : "No purchases to restore."
    );
  }, [availablePurchases]);
  const onRestorePurchases = useCallback(() => {
    setRestoringPurchases(true);
    setRestoreMessage(null);
    restoreRequestedRef.current = true;
    getAvailablePurchases().catch(() => {
      // onError above already handles the user-facing message for this.
    });
  }, [getAvailablePurchases]);

  // Real Australian state/territory multi-select -- replaces the old 1-200km radius slider,
  // per explicit request. Toggling a region on/off adds/removes it from the set the alert
  // subscription queries by (see MapScreen.tsx's subscribeVisibleAlerts call).
  const onRegionToggle = useCallback(
    async (code: AuRegionCode, value: boolean) => {
      const next = value
        ? [...settings.visibleRegions, code]
        : settings.visibleRegions.filter((r) => r !== code);
      await updateSettings({ visibleRegions: next });
      if (user) await syncVisibleRegionsToProfile(user.uid, next);
    },
    [updateSettings, user, settings.visibleRegions]
  );

  // Off = no alerts shown/received at all, regardless of which regions are toggled on.
  const onAlertsEnabledToggle = useCallback(
    async (value: boolean) => {
      await updateSettings({ alertsEnabled: value });
    },
    [updateSettings]
  );

  const onAlertTypeToggle = useCallback(
    (type: AlertType, value: boolean) => {
      updateSettings({
        visibleAlertTypes: value
          ? [...settings.visibleAlertTypes, type]
          : settings.visibleAlertTypes.filter((t) => t !== type),
      });
    },
    [updateSettings, settings.visibleAlertTypes]
  );

  const onExpiryPresetSelect = useCallback(
    (ms: number | null) => {
      setCustomExpiryOpen(false);
      updateSettings({ alertExpiryMs: ms });
    },
    [updateSettings]
  );

  const [customExpiryOpen, setCustomExpiryOpen] = useState(false);
  const [customHoursText, setCustomHoursText] = useState("");
  const [customMinutesText, setCustomMinutesText] = useState("");
  const onApplyCustomExpiry = useCallback(() => {
    const hours = Math.max(0, parseInt(customHoursText, 10) || 0);
    const minutes = Math.max(0, Math.min(59, parseInt(customMinutesText, 10) || 0));
    const ms = (hours * 60 + minutes) * 60 * 1000;
    if (ms <= 0) return;
    updateSettings({ alertExpiryMs: ms });
    setCustomExpiryOpen(false);
  }, [customHoursText, customMinutesText, updateSettings]);

  const onShowTrafficLightsToggle = useCallback(
    (value: boolean) => updateSettings({ showTrafficLights: value }),
    [updateSettings]
  );

  const onShowSpeedCamerasToggle = useCallback(
    (value: boolean) => updateSettings({ showSpeedCameras: value }),
    [updateSettings]
  );

  const onShowLiveCamerasToggle = useCallback(
    (value: boolean) => updateSettings({ showLiveCameras: value }),
    [updateSettings]
  );

  const onOsmRadiusChange = useCallback(
    (value: number) => updateSettings({ osmLayerRadiusKm: Math.round(value) }),
    [updateSettings]
  );

  const onSensitivityChange = useCallback(
    (value: number) => {
      updateSettings({ sirenSensitivity: Math.round(value * 20) / 20 });
    },
    [updateSettings]
  );

  const onAutoShareToggle = useCallback(
    (value: boolean) => {
      updateSettings({ autoShareDetections: value });
    },
    [updateSettings]
  );

  const onDefaultVoiceToggle = useCallback(
    async (value: boolean) => {
      await updateSettings({ defaultVoiceEnabled: value });
      await setVoiceEnabled(value);
    },
    [updateSettings]
  );

  const onMapThemeSelect = useCallback(
    (theme: MapThemeKey) => updateSettings({ mapTheme: theme }),
    [updateSettings]
  );

  const onNavCardThemeSelect = useCallback(
    (theme: NavCardThemeKey) => updateSettings({ navCardTheme: theme }),
    [updateSettings]
  );

  const onMapMarkerStyleSelect = useCallback(
    (style: MapMarkerStyleKey) => updateSettings({ mapMarkerStyle: style }),
    [updateSettings]
  );

  const onAlertIconThemeSelect = useCallback(
    (theme: AlertIconThemeKey) => updateSettings({ alertIconTheme: theme }),
    [updateSettings]
  );

  // Real, shared provider credentials now -- Firestore (config/revCheckProvider), not a local
  // device setting, so the owner only ever has to paste these once and EVERY paying user's
  // check actually works, not just the owner's own device (see revCheckAdmin.ts/revCheck.ts's
  // own history for why local-only storage meant a real paying user's check could never
  // succeed). Only fetched at all when isOwner -- no point reading (or trying to, since rules
  // would reject it) a document nobody else can see.
  const [ppsrKeyDraft, setPpsrKeyDraft] = useState("");
  const [nevdisKeyDraft, setNevdisKeyDraft] = useState("");
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [keysSavedFlash, setKeysSavedFlash] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    getRevCheckProviderConfig()
      .then((config) => {
        if (cancelled) return;
        setPpsrKeyDraft(config.ppsrApiKey);
        setNevdisKeyDraft(config.nevdisApiKey);
      })
      .catch((err) => console.warn("[settings] failed to load REV check provider config", err))
      .finally(() => {
        if (!cancelled) setKeysLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);
  const onSaveRevCheckKeys = useCallback(async () => {
    setSavingKeys(true);
    try {
      await saveRevCheckProviderConfig({ ppsrApiKey: ppsrKeyDraft, nevdisApiKey: nevdisKeyDraft });
      setKeysSavedFlash(true);
      setTimeout(() => setKeysSavedFlash(false), 2000);
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSavingKeys(false);
    }
  }, [ppsrKeyDraft, nevdisKeyDraft]);

  // Real, live battery reading (not a static disclaimer) -- AI Vehicle Detection runs a real
  // camera + on-device AI analysis several times a second, which is genuinely one of the
  // heaviest things this app does. Both iOS and Android automatically slow the processor down
  // once battery gets low (and more aggressively in Low Power/Battery Saver mode) to save
  // power, which directly explains detection feeling slower/laggier on a low battery -- the
  // phone doing exactly what it's designed to do, not a bug. batteryLevel is -1 when the
  // platform can't report it (e.g. iOS simulator) -- treated as "unknown", never shown as 0%.
  const { batteryLevel, lowPowerMode } = usePowerState();
  const batteryPercent = batteryLevel >= 0 ? Math.round(batteryLevel * 100) : null;
  const batteryLow = batteryPercent !== null && batteryPercent < 50;
  const [batteryInfoOpen, setBatteryInfoOpen] = useState(false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="Account">
        {isSignedIn ? (
          <>
            <Text style={styles.rowLabel}>Signed in as {user.email ?? user.displayName ?? "you"}</Text>
            <Pressable
              style={({ pressed }) => [styles.signOutButton, pressed && { opacity: pressedOpacity }]}
              onPress={() => signOutUser()}
            >
              <Text style={styles.signOutButtonText}>Sign out</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.deleteAccountButton, pressed && { opacity: pressedOpacity }]}
              onPress={onDeleteAccount}
              disabled={deletingAccount}
              accessibilityLabel="Delete account"
            >
              {deletingAccount ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <Text style={styles.deleteAccountButtonText}>Delete account</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.helperText}>
              Not signed in -- everything still works. Sign in to make your reports and settings
              recoverable if you get a new phone.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.signInButton, pressed && { opacity: pressedOpacity }]}
              onPress={() => navigation.navigate("SignIn")}
            >
              <Text style={styles.signInButtonText}>Sign in</Text>
            </Pressable>
          </>
        )}
      </Section>

      <Section title="Purchases">
        <Text style={styles.helperText}>
          Restore any in-app purchase tied to your App Store / Google account on this device.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && { opacity: pressedOpacity }]}
          onPress={onRestorePurchases}
          disabled={restoringPurchases}
          accessibilityLabel="Restore purchases"
        >
          {restoringPurchases ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.restorePurchasesButtonText}>Restore purchases</Text>
          )}
        </Pressable>
        {restoreMessage && <Text style={styles.helperText}>{restoreMessage}</Text>}
      </Section>

      <Section title="Live alerts">
        <Row label="Receive alerts">
          <Switch
            value={settings.alertsEnabled}
            onValueChange={onAlertsEnabledToggle}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </Row>
        <Text style={styles.helperText}>
          Off — you won't see or receive any community alerts.
        </Text>

        <Text style={styles.rowLabel}>Regions</Text>
        <Text style={styles.helperText}>
          Toggle on whichever real Australian states/territories you want to see alerts from --
          you'll see every alert in every region toggled on, regardless of how far away it is.
        </Text>
        <View style={styles.alertTypeGrid}>
          {AU_STATES.map((state) => (
            <View key={state.code} style={styles.alertTypeRow}>
              <Text style={styles.alertTypeLabel}>{state.label}</Text>
              <Switch
                value={settings.visibleRegions.includes(state.code as AuRegionCode)}
                onValueChange={(value) => onRegionToggle(state.code as AuRegionCode, value)}
                disabled={!settings.alertsEnabled}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>
          ))}
        </View>

        <View style={styles.alertTypeGrid}>
          {ALL_ALERT_TYPES.map((type) => (
            <View key={type} style={styles.alertTypeRow}>
              <Text style={styles.alertTypeLabel}>{ALERT_LABELS[type]}</Text>
              <Switch
                value={settings.visibleAlertTypes.includes(type)}
                onValueChange={(value) => onAlertTypeToggle(type, value)}
                disabled={!settings.alertsEnabled}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>
          ))}
        </View>

        {/* Real, applied override for how long an alert THIS device reports stays live before
            it auto-expires and disappears for everyone -- see EXPIRY_PRESETS' own comment. */}
        <Text style={styles.rowLabel}>
          Alert lifetime —{" "}
          {settings.alertExpiryMs === null ? "Default" : formatExpiryMs(settings.alertExpiryMs)}
        </Text>
        <Text style={styles.helperText}>
          How long an alert or incident YOU report stays visible before it auto-disappears for
          everyone. "Default" uses this app's own per-type timing (45 min for police/emergency
          vehicle, 2 hours for hazards/crashes/traffic lights, 24 hours for speed cameras).
        </Text>
        <View style={styles.expiryChipRow}>
          {EXPIRY_PRESETS.map((preset) => {
            const isSelected = settings.alertExpiryMs === preset.ms;
            return (
              <Pressable
                key={preset.label}
                onPress={() => onExpiryPresetSelect(preset.ms)}
                style={({ pressed }) => [
                  styles.expiryChip,
                  isSelected && styles.expiryChipSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
              >
                <Text style={[styles.expiryChipText, isSelected && styles.expiryChipTextSelected]}>
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setCustomExpiryOpen((v) => !v)}
            style={({ pressed }) => [
              styles.expiryChip,
              customExpiryOpen && styles.expiryChipSelected,
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <Text style={[styles.expiryChipText, customExpiryOpen && styles.expiryChipTextSelected]}>
              Custom
            </Text>
          </Pressable>
        </View>

        {customExpiryOpen && (
          <View style={styles.customExpiryRow}>
            <TextInput
              value={customHoursText}
              onChangeText={setCustomHoursText}
              placeholder="Hours"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              style={styles.customExpiryInput}
            />
            <TextInput
              value={customMinutesText}
              onChangeText={setCustomMinutesText}
              placeholder="Minutes"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              style={styles.customExpiryInput}
            />
            <Pressable
              onPress={onApplyCustomExpiry}
              style={({ pressed }) => [styles.customExpiryApply, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={styles.customExpiryApplyText}>Apply</Text>
            </Pressable>
          </View>
        )}
      </Section>

      <Section title="Map appearance">
        <Text style={styles.helperText}>
          Recolors the whole map -- land, water, roads, and highways together -- not just a
          tint. Every theme keeps road labels high-contrast against the road surface so street
          names stay easy to read while driving.
        </Text>
        <View style={styles.themeGrid}>
          {MAP_THEME_ORDER.map((theme) => {
            const isSelected = settings.mapTheme === theme;
            const [bg, accent] = MAP_THEME_SWATCH_COLORS[theme];
            return (
              <Pressable
                key={theme}
                onPress={() => onMapThemeSelect(theme)}
                style={({ pressed }) => [
                  styles.themeTile,
                  isSelected && styles.themeTileSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel={`${MAP_THEME_LABELS[theme]} map theme`}
              >
                <View style={styles.themeSwatchShadowWrap}>
                  <View style={[styles.themeSwatch, { backgroundColor: bg }]}>
                    <View style={[styles.themeSwatchAccent, { backgroundColor: accent }]} />
                  </View>
                </View>
                <Text style={[styles.themeTileLabel, isSelected && styles.themeTileLabelSelected]}>
                  {MAP_THEME_LABELS[theme]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Navigation card colors">
        <Text style={styles.helperText}>
          Colors for the turn-by-turn card during navigation only -- the map itself keeps
          whichever theme is picked above.
        </Text>
        <View style={styles.themeGrid}>
          {NAV_CARD_THEME_ORDER.map((theme) => {
            const isSelected = settings.navCardTheme === theme;
            const themeColors = NAV_CARD_THEMES[theme];
            return (
              <Pressable
                key={theme}
                onPress={() => onNavCardThemeSelect(theme)}
                style={({ pressed }) => [
                  styles.themeTile,
                  isSelected && styles.themeTileSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel={`${NAV_CARD_THEME_LABELS[theme]} navigation card theme`}
              >
                <View style={styles.themeSwatchShadowWrap}>
                  <View style={[styles.themeSwatch, { backgroundColor: themeColors.background }]}>
                    <Text style={[styles.navCardSwatchText, { color: themeColors.text }]}>Aa</Text>
                  </View>
                </View>
                <Text style={[styles.themeTileLabel, isSelected && styles.themeTileLabelSelected]}>
                  {NAV_CARD_THEME_LABELS[theme]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Your map marker">
        <Text style={styles.helperText}>
          How you appear on the map -- the arrow rotates live to show your direction of travel no
          matter which one you pick.
        </Text>
        <View style={styles.themeGrid}>
          {MAP_MARKER_STYLE_ORDER.map((style) => {
            const isSelected = settings.mapMarkerStyle === style;
            const iconSpec = style !== "default" ? MAP_MARKER_STYLE_ICONS[style] : null;
            return (
              <Pressable
                key={style}
                onPress={() => onMapMarkerStyleSelect(style)}
                style={({ pressed }) => [
                  styles.themeTile,
                  isSelected && styles.themeTileSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel={`${MAP_MARKER_STYLE_LABELS[style]} map marker`}
              >
                <View style={styles.themeSwatchShadowWrap}>
                  <View style={[styles.themeSwatch, styles.iconSwatch, iconSpec && { backgroundColor: iconSpec.color }]}>
                    {iconSpec ? (
                      <MaterialCommunityIcons name={iconSpec.name as any} size={22} color="#FFFFFF" />
                    ) : (
                      <Ionicons name="navigate" size={22} color={colors.accent} />
                    )}
                  </View>
                </View>
                <Text style={[styles.themeTileLabel, isSelected && styles.themeTileLabelSelected]}>
                  {MAP_MARKER_STYLE_LABELS[style]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Alert icons">
        <Text style={styles.helperText}>
          How police/crash/hazard/camera/traffic-light alerts look on the map -- every pack uses
          real, distinct icons and colors, previewed below with a sample of the alert types.
        </Text>
        <View style={styles.themeGrid}>
          {ALERT_ICON_THEME_ORDER.map((theme) => {
            const isSelected = settings.alertIconTheme === theme;
            return (
              <Pressable
                key={theme}
                onPress={() => onAlertIconThemeSelect(theme)}
                style={({ pressed }) => [
                  styles.themeTile,
                  isSelected && styles.themeTileSelected,
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel={`${ALERT_ICON_THEME_LABELS[theme]} alert icon pack`}
              >
                <View style={styles.themeSwatchShadowWrap}>
                  <View style={[styles.themeSwatch, styles.iconSwatch, styles.alertPreviewSwatch]}>
                    {ALERT_ICON_PREVIEW_TYPES.map((type) => (
                      <AlertTypeGlyph key={type} type={type} size={18} color={colors.text} themeOverride={theme} />
                    ))}
                  </View>
                </View>
                <Text style={[styles.themeTileLabel, isSelected && styles.themeTileLabelSelected]}>
                  {ALERT_ICON_THEME_LABELS[theme]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Map layers">
        <Row
          label="Traffic lights"
          icon={<OsmLayerIcon marker={TRAFFIC_LIGHT_MARKER} enabled={settings.showTrafficLights} />}
        >
          <Switch
            value={settings.showTrafficLights}
            onValueChange={onShowTrafficLightsToggle}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </Row>
        <Row
          label="Speed cameras"
          icon={<OsmLayerIcon marker={SPEED_CAMERA_MARKER} enabled={settings.showSpeedCameras} />}
        >
          <Switch
            value={settings.showSpeedCameras}
            onValueChange={onShowSpeedCamerasToggle}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </Row>
        <Row label={`Traffic light & speed camera radius — ${settings.osmLayerRadiusKm} km`}>
          <Slider
            minimumValue={1}
            maximumValue={200}
            step={1}
            value={settings.osmLayerRadiusKm}
            onSlidingComplete={onOsmRadiusChange}
            disabled={!settings.showTrafficLights && !settings.showSpeedCameras}
            minimumTrackTintColor={colors.accent}
          />
        </Row>
        <Text style={styles.helperText}>
          Every known traffic light and fixed speed camera location, mapped by OpenStreetMap's
          community — shown independently on the map, whether or not "Live alerts" is on, out to
          however far from your own location the radius above is set (1-200 km).
        </Text>
        {/* Boxed off from the OSM layer rows above -- per explicit request, a real, visually
            distinct rectangle rather than just another inline row, since this is genuinely a
            separate dataset/feature (a live government camera feed, not the mapped
            traffic-light/speed-camera locations) and blended in with those rows it read as more
            of the same thing. */}
        <View style={styles.liveCameraBox}>
          <Row
            label="Live traffic cameras (NSW)"
            icon={<MaterialCommunityIcons name="cctv" size={18} color={settings.showLiveCameras ? colors.accent : colors.textMuted} />}
          >
            <Switch
              value={settings.showLiveCameras}
              onValueChange={onShowLiveCamerasToggle}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          </Row>
          <Text style={styles.helperText}>
            Real, live-refreshing government road camera images (Transport for NSW's open
            dataset) — separate from the mapped OSM layer above. NSW only for now; tap a camera
            pin on the map to see its actual current image.
          </Text>
        </View>
      </Section>

      <Section title="AI Vehicle Detection">
        <Pressable
          onPress={() => setBatteryInfoOpen(true)}
          style={({ pressed }) => [
            batteryLow ? styles.warningBox : styles.infoBox,
            pressed && { opacity: pressedOpacity },
          ]}
          accessibilityLabel="Why battery level matters for AI Vehicle Detection"
        >
          <MaterialCommunityIcons
            name={batteryLow ? "battery-alert" : "battery-heart-variant"}
            size={18}
            color={batteryLow ? colors.warning : colors.textMuted}
          />
          <Text style={batteryLow ? styles.warningText : styles.infoText}>
            {batteryPercent !== null
              ? `Battery is at ${batteryPercent}%${lowPowerMode ? " (Low Power Mode on)" : ""} — AI Vehicle Detection works best above 50%.`
              : "AI Vehicle Detection works best with your battery above 50%."}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </Section>

      <Section title="Vehicle REV Checks">
        <Text style={styles.helperText}>
          Look up a vehicle's 5-year registration &amp; odometer history and stolen/written-off/
          money-owing status -- Australia only. Vehicles the AI detector fully identifies (a
          confirmed plate read) are saved here automatically; you can also enter any plate by
          hand.
        </Text>
        <Pressable
          onPress={() => navigation.navigate("VehicleHistory")}
          style={({ pressed }) => [styles.revCheckLinkRow, pressed && { opacity: pressedOpacity }]}
        >
          <MaterialCommunityIcons name="car-search" size={20} color={colors.accent} />
          <Text style={styles.revCheckLinkText}>View vehicle history & run a REV check</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>

        {/* Owner-only, per explicit request -- a real, paid business API credential, not
            something any other signed-in user should ever be able to see or edit. Stored in
            Firestore now (config/revCheckProvider), shared across every user's own real check
            instead of a per-device local setting -- see revCheckAdmin.ts's own header. */}
        {isOwner && (
          <>
            <Text style={styles.rowLabel}>Provider keys (owner only)</Text>
            <Text style={styles.helperText}>
              Real vehicle history isn't free -- PPSR (stolen/written-off/money-owing) and NEVDIS
              (registration + odometer history) both require your own signed-up broker account.
              Paste your keys below once you have them; every user's check stays clearly marked
              "not connected" until then -- nothing here is ever fabricated. Saved to Firestore,
              never bundled into the app itself, and only ever readable by your own signed-in
              account or the server-side check function -- no other user's device can read it.
            </Text>
            {!keysLoaded ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <>
                <TextInput
                  value={ppsrKeyDraft}
                  onChangeText={setPpsrKeyDraft}
                  placeholder="PPSR provider API key"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  style={styles.customExpiryInput}
                />
                <TextInput
                  value={nevdisKeyDraft}
                  onChangeText={setNevdisKeyDraft}
                  placeholder="NEVDIS provider API key"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  style={styles.customExpiryInput}
                />
                <Pressable
                  onPress={onSaveRevCheckKeys}
                  disabled={savingKeys}
                  style={({ pressed }) => [
                    styles.customExpiryApply,
                    { alignItems: "center" },
                    pressed && !savingKeys && { opacity: pressedOpacity },
                  ]}
                >
                  {savingKeys ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.customExpiryApplyText}>{keysSavedFlash ? "Saved" : "Save keys"}</Text>
                  )}
                </Pressable>
              </>
            )}
          </>
        )}
      </Section>

      <Modal
        visible={batteryInfoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBatteryInfoOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setBatteryInfoOpen(false)}>
          {/* Swallows the tap so pressing inside the card doesn't fall through to the
              backdrop's own onPress and close the modal immediately. */}
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Why battery matters here</Text>
              <Pressable
                onPress={() => setBatteryInfoOpen(false)}
                hitSlop={12}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.modalBody}>
              AI Vehicle Detection runs a real, live camera feed through on-device AI several
              times a second — genuinely one of the heaviest things this app does. Both iOS and
              Android automatically slow the phone's processor down once battery gets low (and
              more aggressively in Low Power/Battery Saver mode) to save power. That same
              slowdown affects any app doing heavy real-time processing, not just this one.
            </Text>
            <Text style={styles.modalBody}>
              For the smoothest experience, keep your phone above 50% battery (or plugged in)
              and Low Power Mode off while using it. Below that, detection still works — it may
              just run slower, which is your phone protecting its battery, not a malfunction.
            </Text>
            {batteryPercent !== null && (
              <Text style={styles.modalMeta}>
                Your battery right now: {batteryPercent}%
                {lowPowerMode ? " — Low Power Mode is on" : ""}
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Section title="Public transit">
        <View style={styles.warningBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.warningText}>
            Live, real-time bus/train tracking is limited to NSW, Australia.
          </Text>
        </View>
        <Text style={styles.helperText}>
          Everywhere else — and for anything NSW's live feed doesn't cover — tapping Transit
          still finds real nearby buses and trains to wherever you're headed, using published
          timetables (the real line, real stop, and real scheduled departure time, just not a
          live-tracked vehicle position).
        </Text>
      </Section>

      <Section title="EV Radar (siren detection)">
        <Row label="Auto-share detections">
          <Switch
            value={settings.autoShareDetections}
            onValueChange={onAutoShareToggle}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </Row>
        <Text style={styles.helperText}>
          When on, a confirmed siren detection automatically posts an "Emergency Vehicle" alert
          at your location for nearby drivers. Off by default — your location is never shared
          from an audio detection without this opt-in.
        </Text>

        <Row label={`Detection sensitivity — ${sensitivityLabel(settings.sirenSensitivity)}`}>
          {/* Per explicit request: a clear boundary for where the range actually ends, not just
              the slider trailing off into plain white with no marker -- "Low"/"High" anchors
              plus an explicit maximumTrackTintColor (not left to whatever the platform default
              happens to render as, which can read as "empty/disabled" rather than "this is the
              real end of the range") make it obvious at a glance where max sensitivity is. */}
          <Slider
            minimumValue={0.3}
            maximumValue={0.9}
            step={0.05}
            value={settings.sirenSensitivity}
            onSlidingComplete={onSensitivityChange}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
          />
          <View style={styles.sliderEndLabels}>
            <Text style={styles.sliderEndLabelText}>Low</Text>
            <Text style={styles.sliderEndLabelText}>High</Text>
          </View>
        </Row>
      </Section>

      <Section title="Voice guidance">
        <Row label="Voice guidance on by default">
          <Switch
            value={settings.defaultVoiceEnabled}
            onValueChange={onDefaultVoiceToggle}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </Row>
      </Section>

      <View style={styles.about}>
        <Image source={require("../../assets/icon.png")} style={styles.aboutLogo} />
        <Text style={styles.aboutName}>{Constants.expoConfig?.name ?? "TrackLine"}</Text>
        {/* expo-application's nativeApplicationVersion/nativeBuildVersion read the ACTUAL
            running binary's Info.plist (real, verifiable), not just this JS bundle's static
            config -- the build number specifically is what changes on every single TestFlight
            update (EAS auto-increments it remotely, see app.config.js's own comment), so
            showing it here is the real, honest way to confirm a given device actually picked up
            a new build, not just the marketing version (which intentionally stays the same
            across many builds until a real feature milestone). Falls back to expoConfig's
            static version only if the native field is unavailable (e.g. Expo Go, never how this
            app ships). */}
        <Text style={styles.aboutVersion}>
          Version {Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "1.0.0"}
          {Application.nativeBuildVersion ? ` (build ${Application.nativeBuildVersion})` : ""}
        </Text>
        {BUSINESS_INFO.businessName ? (
          <Text style={styles.aboutMeta}>{BUSINESS_INFO.businessName}</Text>
        ) : null}
        {BUSINESS_INFO.abn ? <Text style={styles.aboutMeta}>ABN {BUSINESS_INFO.abn}</Text> : null}
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        {icon}
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

// Same icon/color the map pin itself uses (see osmMarkerStyle.ts) -- muted to grey while the
// layer is off, full color once it's on, so the toggle visually previews what you're about to
// see on the map instead of a plain, unrelated on/off switch.
function OsmLayerIcon({
  marker,
  enabled,
}: {
  marker: { icon: string; color: string; badgeSize: number; glyphSize: number };
  enabled: boolean;
}) {
  const size = Math.max(marker.badgeSize, 22);
  // Real, confirmed cause of the traffic-light row icon looking blank: marker.glyphSize (9px)
  // is calibrated for TRAFFIC_LIGHT_MARKER's own tiny 14px on-map badge, not this row's 22px
  // floor -- speed cameras' 30px badge/18px glyph never hit that floor so it happened to look
  // fine, but traffic lights' 14px badge did, leaving a 9px glyph adrift in a 22px circle
  // (effectively invisible, especially against the muted grey "off" background). Scaling the
  // glyph by the marker's own real badge-to-glyph ratio instead of reusing glyphSize verbatim
  // keeps speed cameras pixel-identical to before while actually fixing traffic lights.
  const glyphSize = size * (marker.glyphSize / marker.badgeSize);
  // Real, second confirmed cause (beyond the size floor above): the glyph was hardcoded white
  // regardless of enabled state, which is fine against the marker's own real color when ON but
  // near-invisible white-on-light-grey against colors.border when OFF -- not just small, actually
  // low enough contrast to read as a blank circle. Dark when off, matching the same "muted until
  // enabled" intent the background color already has.
  const glyphColor = enabled ? "#FFFFFF" : colors.textMuted;
  return (
    <View
      style={[
        styles.rowIconBadge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: enabled ? marker.color : colors.border },
      ]}
    >
      <MaterialCommunityIcons name={marker.icon as any} size={glyphSize} color={glyphColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  content: { padding: spacing.xl, gap: spacing.xxl },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md + 2,
    ...shadow.low,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    gap: spacing.sm,
  },
  rowLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowIconBadge: {
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.text,
  },
  sliderEndLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  sliderEndLabelText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textFaint,
  },
  liveCameraBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  helperText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: "#FEF3C7",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
    lineHeight: 18,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: colors.textMuted,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.high,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  modalBody: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  modalMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  revCheckLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  revCheckLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  signInButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 2,
    alignItems: "center",
  },
  signInButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  signOutButton: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 2,
    alignItems: "center",
  },
  signOutButtonText: {
    color: colors.danger,
    fontWeight: "700",
    fontSize: 14,
  },
  restorePurchasesButtonText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 14,
  },
  deleteAccountButton: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  deleteAccountButtonText: {
    color: colors.danger,
    fontWeight: "600",
    fontSize: 13,
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  themeTile: {
    width: "47%",
    alignItems: "center",
    gap: spacing.xs + 2,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  themeTileSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceMuted,
  },
  // Real elevation, per explicit request for a "more realistic" picker -- a plain flat-color
  // swatch read as a cheap placeholder rather than a genuine preview of the actual marker/card
  // it represents. Wrapped in its own View (see the render call sites) since the swatch itself
  // has overflow:hidden (needed to clip the icon/accent bar to its rounded corners), and RN
  // shadows don't render through a clipped parent.
  themeSwatchShadowWrap: {
    width: "100%",
    borderRadius: radius.sm,
    ...shadow.medium,
  },
  themeSwatch: {
    width: "100%",
    height: 44,
    borderRadius: radius.sm,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  iconSwatch: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  alertPreviewSwatch: {
    flexDirection: "row",
    gap: spacing.xs + 2,
  },
  themeSwatchAccent: {
    height: 12,
    width: "60%",
    alignSelf: "center",
    marginBottom: 8,
    borderRadius: 3,
  },
  navCardSwatchText: {
    alignSelf: "center",
    fontSize: 20,
    fontWeight: "800",
  },
  themeTileLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  themeTileLabelSelected: {
    color: colors.accent,
    fontWeight: "700",
  },
  alertTypeGrid: {
    gap: spacing.sm,
  },
  alertTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  alertTypeLabel: {
    fontSize: 14,
    color: colors.text,
  },
  expiryChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs + 2,
  },
  expiryChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: "transparent",
  },
  expiryChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  expiryChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
  },
  expiryChipTextSelected: {
    color: "#FFFFFF",
  },
  customExpiryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  customExpiryInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm - 2,
    paddingHorizontal: spacing.sm + 2,
    fontSize: 14,
    color: colors.text,
  },
  customExpiryApply: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  customExpiryApplyText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  about: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  aboutLogo: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    ...shadow.low,
  },
  aboutName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  aboutVersion: {
    fontSize: 12,
    color: colors.textFaint,
  },
  aboutMeta: {
    fontSize: 12,
    color: colors.textFaint,
  },
});
