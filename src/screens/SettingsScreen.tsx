import { GUEST_WARNING } from "@/guest/savePrompt";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TEST_DRIVE_LABELS, requestTestDrive, type TestDriveKind } from "@/dev/testDrives";
import { View, Image, StyleSheet, Pressable, Modal, Alert, ActivityIndicator, Linking } from "react-native";
import { Text } from "@/components/AppText";
import Slider from "@react-native-community/slider";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { usePowerState } from "expo-battery";
import { useIAP } from "react-native-iap";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { syncVisibleRegionsToProfile } from "@/services/userProfile";
import { setVoiceEnabled } from "@/services/voice";
import { getVoiceDisplayName } from "@/services/voiceLabel";
import { subscribeNswTraffic } from "@/services/trafficNsw";
import { EMPTY_TRAFFIC_SNAPSHOT, type TrafficSnapshot } from "@/services/trafficNswModel";
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
import { getPlateLookupProviderConfig, savePlateLookupProviderConfig } from "@/services/plateLookupAdmin";
import { getPlateRecognizerProviderConfig, savePlateRecognizerProviderConfig } from "@/services/plateRecognizerAdmin";
import { isOwnerEmail } from "@/config/admin";
import { BUSINESS_INFO } from "@/config/business";
import { BLUE } from "@/theme/colors";
import { type AppSettings } from "@/services/settings";
import { parseGpx, startGpsReplay, stopGpsReplay, isGpsReplayActive } from "@/dev/gpsReplay";
import { TouchDebuggerRow } from "@/debug/TouchDebuggerRow";
import { getBuildStamp } from "@/config/getBuildStamp";
import { CATEGORY_SECTIONS, SETTINGS_CATEGORY_LABELS } from "@/screens/settingsCategories";
import { mapEngineLine } from "@/config/mapEngine";
import { AU_STATES, type AuRegionCode } from "@/utils/auStates";
import { MAP_THEME_LABELS, ROAD_THICKNESS_LABELS, type MapThemeKey, type RoadThicknessKey } from "@/utils/mapStyle";
import { NAV_CARD_THEME_LABELS, type NavCardThemeKey } from "@/utils/navCardTheme";
import { MAP_MARKER_STYLE_LABELS, type MapMarkerStyleKey } from "@/utils/mapMarkerStyles";
import { ALERT_ICON_THEME_LABELS, type AlertIconThemeKey } from "@/utils/alertIconThemes";
import { anyOsmWanted } from "@/settings/reportCatalog";
import { SPEED_LIMIT_DISPLAY_OPTIONS } from "@/settings/speedometer";
import { CHOICE_LISTS, SPOKEN_DIRECTIONS_OPTIONS, VISIBILITY_OPTIONS, currentChoiceLabel, type ChoiceListId } from "@/settings/choiceLists";
import { SettingsActionRow, SettingsInput, SettingsPage, SettingsPicker, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { AlertPackPreview, MapThemePreview, MapViewPreview, MarkerPreview, NavCardPreview, RoadThicknessPreview } from "@/components/settings/SettingsPreviews";
import { useSettingsColours } from "@/components/settings/settingsScheme";
import type { RootStackParamList } from "@/navigation/RootNavigator";

// Real, explicit request (Waze-style redesign Phase 5) -- group this screen's 15 real sections
// into Waze-style top-level categories instead of one long flat scroll. Deliberately NOT a
// logic extraction into separate screen files (this screen's state/handlers are all genuinely
// shared and interdependent -- splitting them into independent files would risk duplicating or
// dropping a handler somewhere in a ~2000-line screen); instead this same screen renders either
// every section (no category param -- every existing `navigation.navigate("Settings")` call
// site keeps working exactly as before) or only the sections belonging to one category, via the
// new SettingsCategoriesScreen's own list of category cards.
export { SETTINGS_CATEGORY_LABELS, SETTINGS_CATEGORY_ICONS, type SettingsCategory } from "@/screens/settingsCategories";

function sensitivityLabel(value: number): string {
  if (value <= 0.4) return "Low";
  if (value <= 0.7) return "Medium";
  return "High";
}

const MAP_VIEW_STYLE_ORDER: AppSettings["defaultMapViewStyle"][] = ["tilted3d", "flat", "satellite3d"];
const MAP_VIEW_STYLE_LABELS: Record<AppSettings["defaultMapViewStyle"], string> = {
  tilted3d: "3D tilted",
  flat: "Overhead",
  satellite3d: "Satellite 3D",
};
const MAP_THEME_ORDER: MapThemeKey[] = ["normal", "purpleBlue", "blueGrey", "greenYellow", "blue", "light", "dark"];
const ROAD_THICKNESS_ORDER: RoadThicknessKey[] = ["thin", "normal", "bold", "extraBold"];
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
export function SettingsScreen() {
  const { settings, updateSettings, voiceIdentifier } = useSettings();
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
                  : "Something went wrong. Try again in a moment."
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  }, [reauthenticateCurrentUser]);

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
      setRestoreMessage("Couldn't check for purchases. Try again in a moment.");
    },
  });
  useEffect(() => {
    if (!restoreRequestedRef.current) return;
    restoreRequestedRef.current = false;
    setRestoringPurchases(false);
    const hasPendingRevCheck = availablePurchases.some((p) => p.productId === REV_CHECK_PRODUCT_ID);
    setRestoreMessage(
      hasPendingRevCheck
        ? "Found a paid REV check that wasn't finished. Open Vehicle REV Check and run a check with the same VIN to finish it, free."
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

  const onShowLiveCamerasToggle = useCallback(
    (value: boolean) => updateSettings({ showLiveCameras: value }),
    [updateSettings]
  );
  // Live Traffic NSW. Whether there's anything to show depends on the server having been given
  // a Transport for NSW key, so the row says which state it's in rather than offering a switch
  // that quietly does nothing.
  const [trafficStatus, setTrafficStatus] = useState<TrafficSnapshot>(EMPTY_TRAFFIC_SNAPSHOT);
  useEffect(() => subscribeNswTraffic(setTrafficStatus), []);
  const trafficHelp = !trafficStatus.configured
    ? "Not set up yet. It needs a free Transport for NSW key on the server; nothing shows until then."
    : trafficStatus.incidents.length === 0
      ? "Connected to Transport for NSW. No current incidents reported."
      : `Crashes, heavy traffic, roadworks, floods and fires from Transport for NSW. ${trafficStatus.incidents.length} current across the state.`;

  const onSpeedWarningChimeToggle = useCallback(
    (value: boolean) => updateSettings({ speedWarningChimeEnabled: value }),
    [updateSettings]
  );

  // Real, explicit request -- dev-only "GPS replay" test harness (see src/dev/gpsReplay.ts's
  // own header for why no bundled "sample drive" ships with this: a fabricated GPX pretending
  // to be a real recording would itself be fake data). The developer pastes their own real
  // recorded GPX XML in directly -- no new native file-picker dependency needed for that.
  const [gpxText, setGpxText] = useState("");
  const [gpxReplayRunning, setGpxReplayRunning] = useState(isGpsReplayActive());
  const onStartGpxReplay = useCallback(() => {
    try {
      const points = parseGpx(gpxText);
      startGpsReplay(points, 1);
      setGpxReplayRunning(true);
    } catch (err) {
      Alert.alert("Couldn't start replay", err instanceof Error ? err.message : String(err));
    }
  }, [gpxText]);
  const onStopGpxReplay = useCallback(() => {
    stopGpsReplay();
    setGpxReplayRunning(false);
  }, []);

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

  // Real, explicit request (Waze-style redesign, Phase 3) -- resolves the stored voiceIdentifier
  // to its real display name for this row's subtitle, same real lookup SoundSheet.tsx already
  // does for its own "Current voice" row. The actual picking/previewing UI now lives entirely
  // in VoicePickerScreen.tsx.
  const [currentVoiceLabel, setCurrentVoiceLabel] = useState("Device default");
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getVoiceDisplayName(voiceIdentifier, "Device default")
      .then((label) => {
        if (!cancelled) setCurrentVoiceLabel(label);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setVoicesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [voiceIdentifier]);

  const onMapThemeSelect = useCallback(
    (theme: MapThemeKey) => updateSettings({ mapTheme: theme }),
    [updateSettings]
  );

  const onMapViewStyleSelect = useCallback(
    (style: AppSettings["defaultMapViewStyle"]) => updateSettings({ defaultMapViewStyle: style }),
    [updateSettings]
  );

  const onRoadThicknessSelect = useCallback(
    (thickness: RoadThicknessKey) => updateSettings({ roadThickness: thickness }),
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

  // Same owner-only pattern as the PPSR/NEVDIS keys above, for the separate plate-based lookup
  // provider (RegCheck/carregistrationapi.com.au -- see runPlateLookup in
  // firebase/functions/index.js). Real self-serve signup: create a free/paid account at
  // carregistrationapi.com.au to get this username.
  const [plateLookupUsernameDraft, setPlateLookupUsernameDraft] = useState("");
  const [plateLookupKeyLoaded, setPlateLookupKeyLoaded] = useState(false);
  const [plateLookupKeySavedFlash, setPlateLookupKeySavedFlash] = useState(false);
  const [savingPlateLookupKey, setSavingPlateLookupKey] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    getPlateLookupProviderConfig()
      .then((config) => {
        if (cancelled) return;
        setPlateLookupUsernameDraft(config.username);
      })
      .catch((err) => console.warn("[settings] failed to load plate lookup provider config", err))
      .finally(() => {
        if (!cancelled) setPlateLookupKeyLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);
  const onSavePlateLookupKey = useCallback(async () => {
    setSavingPlateLookupKey(true);
    try {
      await savePlateLookupProviderConfig({ username: plateLookupUsernameDraft });
      setPlateLookupKeySavedFlash(true);
      setTimeout(() => setPlateLookupKeySavedFlash(false), 2000);
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSavingPlateLookupKey(false);
    }
  }, [plateLookupUsernameDraft]);

  // Same owner-only pattern again, for the Plate Recognizer cloud OCR provider (see
  // recognizePlate in firebase/functions/index.js) -- a real, paid account at
  // platerecognizer.com, used as a cloud alternative to on-device plate reading in AI Vehicle
  // Detection when connected (see plateRecognizer.ts's own comment for the on-device fallback).
  const [plateRecognizerKeyDraft, setPlateRecognizerKeyDraft] = useState("");
  const [plateRecognizerKeyLoaded, setPlateRecognizerKeyLoaded] = useState(false);
  const [plateRecognizerKeySavedFlash, setPlateRecognizerKeySavedFlash] = useState(false);
  const [savingPlateRecognizerKey, setSavingPlateRecognizerKey] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    getPlateRecognizerProviderConfig()
      .then((config) => {
        if (cancelled) return;
        setPlateRecognizerKeyDraft(config.apiKey);
      })
      .catch((err) => console.warn("[settings] failed to load plate recognizer provider config", err))
      .finally(() => {
        if (!cancelled) setPlateRecognizerKeyLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);
  const onSavePlateRecognizerKey = useCallback(async () => {
    setSavingPlateRecognizerKey(true);
    try {
      await savePlateRecognizerProviderConfig({ apiKey: plateRecognizerKeyDraft });
      setPlateRecognizerKeySavedFlash(true);
      setTimeout(() => setPlateRecognizerKeySavedFlash(false), 2000);
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSavingPlateRecognizerKey(false);
    }
  }, [plateRecognizerKeyDraft]);

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

  // No category param (every pre-existing navigate("Settings") call site) shows every section,
  // exactly the previous behavior -- only the Settings home's own groups pass one.
  const settingsRoute = useRoute<RouteProp<RootStackParamList, "Settings">>();
  const category = settingsRoute.params?.category;
  const highlight = settingsRoute.params?.highlight ?? null;
  const shouldShow = (sectionTitle: string) => !category || CATEGORY_SECTIONS[category].includes(sectionTitle);
  const colours = useSettingsColours();
  const openChoice = (list: ChoiceListId) => navigation.navigate("SettingsChoice", { list });
  const voiceName = !voicesLoaded ? "Loading…" : currentVoiceLabel;
  const regionsOn = settings.visibleRegions.length;

  return (
    <SettingsPage title={category ? SETTINGS_CATEGORY_LABELS[category] : "All settings"} highlight={highlight} testID="settings-screen">
      {/* ---------------- Account ---------------- */}
      <Section title="Account" visible={shouldShow("Account")}>
        {isSignedIn ? (
          <SettingsRow icon="person-circle" meaning="account" title="Signed in" subtitle={user.email ?? user.displayName ?? "Your account"} />
        ) : (
          <SettingsRow
            icon="person-circle"
            meaning="account"
            title="You're using TrackLine as a guest"
            subtitle={GUEST_WARNING}
            testID="guest-warning"
          />
        )}
        {isSignedIn ? (
          <SettingsActionRow title="Sign out" onPress={() => signOutUser()} testID="sign-out" />
        ) : (
          <SettingsActionRow title="Create account" onPress={() => navigation.navigate("SignIn")} testID="save-trackline" />
        )}
        {isSignedIn ? (
          <SettingsActionRow title="Delete account" destructive onPress={onDeleteAccount} loading={deletingAccount} testID="delete-account" />
        ) : null}
      </Section>

      <Section
        title="Purchases"
        visible={shouldShow("Purchases")}
        footer={restoreMessage ?? "Brings back anything you bought with your App Store or Google Play account on this phone."}
      >
        <SettingsActionRow title="Restore purchases" onPress={onRestorePurchases} loading={restoringPurchases} testID="restore-purchases" />
      </Section>

      {/* ---------------- Privacy & visibility ---------------- */}
      <Section title="Who can see you" visible={shouldShow("Who can see you")} footer="Everyone starts in Ghost mode. Switch it off any time to let nearby drivers see your Tracky.">
        {VISIBILITY_OPTIONS.map((o) => (
          <SettingsRow
            key={o.key}
            title={o.label}
            subtitle={o.hint}
            selected={settings.visibility === o.key}
            onPress={() => updateSettings({ visibility: o.key })}
            testID={`visibility-${o.key}`}
          />
        ))}
      </Section>

      <Section title="Reports and places" visible={shouldShow("Reports and places")}>
        <SettingsRow
          icon="person"
          meaning="privacy"
          title="Show my name on reports"
          subtitle={settings.showNameOnReports ? "Your name shows on alerts you report" : "Your reports show as “A Tracky”"}
          toggle={{ value: settings.showNameOnReports, onValueChange: (v) => updateSettings({ showNameOnReports: v }) }}
        />
        <SettingsRow
          icon="star"
          meaning="privacy"
          title="Share arrivals"
          subtitle="Adds an anonymous +1 to places you arrive at, so popular places get a badge. Only a count is kept, never who or when."
          toggle={{ value: settings.shareArrivals, onValueChange: (v) => updateSettings({ shareArrivals: v }), testID: "share-arrivals-switch" }}
        />
      </Section>

      {/* ---------------- Map display ---------------- */}
      <Section title="Appearance" visible={shouldShow("Appearance")}>
        {CHOICE_LISTS.appearance.options(settings).map((o) => (
          <SettingsRow
            key={o.key}
            title={o.label}
            subtitle={o.hint}
            selected={CHOICE_LISTS.appearance.selected(settings) === o.key}
            onPress={() => updateSettings(CHOICE_LISTS.appearance.patch(o.key, settings))}
            testID={`appearance-${o.key}`}
          />
        ))}
      </Section>

      <Section title="Map view" visible={shouldShow("Map view")}>
        <SettingsRow icon="download" meaning="map" title="Offline maps" subtitle="Download the map around you to use without a signal" onPress={() => navigation.navigate("OfflineMaps")} testID="open-offline-maps" />
        <SettingsRow
          icon="earth"
          meaning="map"
          title="Satellite view"
          subtitle="Aerial imagery instead of the drawn map"
          toggle={{ value: settings.defaultMapViewStyle === "satellite3d", onValueChange: (v) => updateSettings({ defaultMapViewStyle: v ? "satellite3d" : "tilted3d" }) }}
        />
        <SettingsRow
          icon="business"
          meaning="map"
          title="3D buildings"
          subtitle="Raised buildings when the map is tilted"
          toggle={{ value: settings.show3DBuildings, onValueChange: (v) => updateSettings({ show3DBuildings: v }) }}
        />
        <SettingsRow
          icon="warning"
          meaning="reports"
          title="Alerts on the map"
          subtitle="Police, hazards, crashes and other reports"
          toggle={{ value: settings.alertsEnabled, onValueChange: (v) => updateSettings({ alertsEnabled: v }) }}
        />
      </Section>

      {shouldShow("Map theme") ? (
        <SettingsPicker
          title="Map theme"
          footer="Recolours the whole map. Street names stay easy to read in every theme."
          items={MAP_THEME_ORDER.map((t) => ({ key: t, label: MAP_THEME_LABELS[t], preview: <MapThemePreview theme={t} /> }))}
          selected={settings.mapTheme}
          onSelect={onMapThemeSelect}
          testIDPrefix="map-theme"
        />
      ) : null}

      {shouldShow("Road thickness") ? (
        <SettingsPicker
          title="Road thickness"
          items={ROAD_THICKNESS_ORDER.map((t) => ({ key: t, label: ROAD_THICKNESS_LABELS[t], preview: <RoadThicknessPreview thickness={t} theme={settings.mapTheme} /> }))}
          selected={settings.roadThickness}
          onSelect={onRoadThicknessSelect}
          testIDPrefix="road-thickness"
        />
      ) : null}

      {shouldShow("Default map view") ? (
        <SettingsPicker
          title="Default map view"
          footer="How the map opens and how it starts a drive. The buttons on the map still switch it any time."
          items={MAP_VIEW_STYLE_ORDER.map((v) => ({ key: v, label: MAP_VIEW_STYLE_LABELS[v], preview: <MapViewPreview view={v} /> }))}
          selected={settings.defaultMapViewStyle}
          onSelect={onMapViewStyleSelect}
          columns={3}
          previewHeight={78}
          testIDPrefix="map-view"
        />
      ) : null}

      <Section title="Map labels" visible={shouldShow("Map labels")} footer={CHOICE_LISTS.mapLabels.footer}>
        {CHOICE_LISTS.mapLabels.options(settings).map((o) => (
          <SettingsRow
            key={o.key}
            title={o.label}
            selected={settings.mapLabels === o.key}
            onPress={() => updateSettings(CHOICE_LISTS.mapLabels.patch(o.key, settings))}
            testID={`map-labels-${o.key}`}
          />
        ))}
      </Section>

      {shouldShow("Navigation card") ? (
        <SettingsPicker
          title="Navigation card"
          footer="Colours of the turn card while you drive. The map keeps its own theme."
          items={NAV_CARD_THEME_ORDER.map((t) => ({ key: t, label: NAV_CARD_THEME_LABELS[t], preview: <NavCardPreview theme={t} /> }))}
          selected={settings.navCardTheme}
          onSelect={onNavCardThemeSelect}
          previewHeight={72}
          testIDPrefix="nav-card"
        />
      ) : null}

      {shouldShow("Your map marker") ? (
        <SettingsPicker
          title="Your map marker"
          footer="How you appear on the map. It turns to show which way you're heading."
          items={MAP_MARKER_STYLE_ORDER.map((m) => ({ key: m, label: MAP_MARKER_STYLE_LABELS[m], preview: <MarkerPreview style={m} background={colours.page} /> }))}
          selected={settings.mapMarkerStyle}
          onSelect={onMapMarkerStyleSelect}
          columns={3}
          previewHeight={72}
          testIDPrefix="marker"
        />
      ) : null}

      {shouldShow("Alert icons") ? (
        <SettingsPicker
          title="Alert icons"
          footer="How police, crashes, hazards and traffic lights look on the map."
          items={ALERT_ICON_THEME_ORDER.map((t) => ({ key: t, label: ALERT_ICON_THEME_LABELS[t], preview: <AlertPackPreview theme={t} background={colours.page} glyph={colours.text} /> }))}
          selected={settings.alertIconTheme}
          onSelect={onAlertIconThemeSelect}
          previewHeight={60}
          testIDPrefix="alert-icons"
        />
      ) : null}

      {/* ---------------- Map information & overlays ---------------- */}
      <Section title="Reports" visible={shouldShow("Reports")}>
        <SettingsRow
          icon="layers"
          meaning="reports"
          title="Reports"
          subtitle="Cameras, road features, police, crashes, hazards and school zones"
          onPress={() => navigation.navigate("ReportsSettings")}
          testID="reports-link"
        />
        {isOwnerEmail(user?.email) ? (
          <SettingsRow
            icon="checkmark-circle"
            meaning="account"
            title="Moderation queue"
            subtitle="Approve cameras and road features drivers reported"
            onPress={() => navigation.navigate("Moderation")}
            testID="moderation-link"
          />
        ) : null}
      </Section>

      <Section
        title="Mapped road features"
        visible={shouldShow("Mapped road features")}
        footer="Traffic lights, cameras, crossings and other features switched on in Reports, from OpenStreetMap. Shown out to this distance from you."
      >
        <SettingsRow icon="map" meaning="map" title="Show within" value={`${settings.osmLayerRadiusKm} km`} disabled={!anyOsmWanted(settings)}>
          <Slider
            minimumValue={1}
            maximumValue={200}
            step={1}
            value={settings.osmLayerRadiusKm}
            onSlidingComplete={onOsmRadiusChange}
            disabled={!anyOsmWanted(settings)}
            minimumTrackTintColor={BLUE}
            maximumTrackTintColor={colours.switchOff}
            accessibilityLabel="Show road features within, kilometres"
          />
        </SettingsRow>
      </Section>

      <Section title="Live traffic (NSW)" visible={shouldShow("Live traffic (NSW)")} footer="From Transport for NSW, refreshed live. NSW only for now.">
        <SettingsRow
          icon="warning"
          meaning="reports"
          title="Traffic incidents"
          subtitle={trafficHelp}
          toggle={{ value: settings.showLiveTraffic, onValueChange: (v) => updateSettings({ showLiveTraffic: v }) }}
        />
        <SettingsRow
          icon="cctv"
          meaning="reports"
          title="Traffic cameras"
          subtitle="Tap a camera on the map to see its latest picture"
          toggle={{ value: settings.showLiveCameras, onValueChange: onShowLiveCamerasToggle }}
        />
      </Section>

      <Section title="Speedometer" visible={shouldShow("Speedometer")}>
        <SettingsRow
          icon="car-sport"
          meaning="safety"
          title="Show speedometer"
          subtitle="Your speed on the map while you drive"
          toggle={{ value: settings.showSpeedometer, onValueChange: (v) => updateSettings({ showSpeedometer: v }), testID: "show-speedometer-switch" }}
        />
        <SettingsRow
          icon="warning"
          meaning="safety"
          title="Speeding alert"
          subtitle="How far over the limit counts as speeding"
          value={currentChoiceLabel("speedingThreshold", settings)}
          onPress={() => openChoice("speedingThreshold")}
          testID="speeding-threshold-row"
        />
        <SettingsRow
          icon="volume-high"
          meaning="sound"
          title="Speeding chime"
          subtitle="One soft chime when you pass the alert, at most every 30 seconds"
          toggle={{ value: settings.speedWarningChimeEnabled, onValueChange: onSpeedWarningChimeToggle, testID: "speed-chime-switch" }}
        />
      </Section>

      <Section title="Speed limit sign" visible={shouldShow("Speed limit sign")} footer="The sign only ever shows a limit from real data: a school zone, your route or the road's posted limit. It's hidden rather than guessed.">
        {SPEED_LIMIT_DISPLAY_OPTIONS.map((o) => (
          <SettingsRow
            key={o.value}
            title={o.label}
            subtitle={o.hint}
            selected={settings.speedLimitDisplay === o.value}
            onPress={() => updateSettings({ speedLimitDisplay: o.value })}
            testID={`speed-limit-display-${o.value}`}
          />
        ))}
      </Section>

      <Section title="Map shortcuts" visible={shouldShow("Map shortcuts")} footer="Buttons on the home map. Show Trackys only changes what you see, not who sees you.">
        <SettingsRow icon="compass" meaning="map" title="Compass" subtitle="Points north; tap to face north" toggle={{ value: settings.showCompass, onValueChange: (v) => updateSettings({ showCompass: v }) }} />
        <SettingsRow
          icon="musical-notes"
          meaning="sound"
          title="Audio player"
          subtitle="Opens Spotify, Apple Music or YouTube Music"
          toggle={{ value: settings.showAudioPlayer, onValueChange: (v) => updateSettings({ showAudioPlayer: v }) }}
        />
        <SettingsRow
          icon="volume-high"
          meaning="sound"
          title="Sound button"
          subtitle="Quick mute on the map"
          toggle={{ value: settings.showSoundButton, onValueChange: (v) => updateSettings({ showSoundButton: v }), testID: "shortcut-sound-switch" }}
        />
        <SettingsRow
          icon="happy"
          meaning="map"
          title="Show Trackys"
          subtitle="Other visible drivers on your map"
          toggle={{ value: settings.showTrackysOnMap, onValueChange: (v) => updateSettings({ showTrackysOnMap: v }), testID: "shortcut-trackys-switch" }}
        />
        <SettingsRow
          icon="car"
          meaning="routes"
          title="Traffic flow"
          subtitle="Colours roads by live traffic"
          toggle={{ value: settings.showTrafficFlow, onValueChange: (v) => updateSettings({ showTrafficFlow: v }), testID: "shortcut-traffic-flow-switch" }}
        />
      </Section>

      {/* ---------------- Navigation & voice ---------------- */}
      <Section title="Voice guidance" visible={shouldShow("Voice guidance")}>
        <SettingsRow
          icon="volume-high"
          meaning="sound"
          title="Voice on by default"
          subtitle="Start every drive with spoken guidance"
          toggle={{ value: settings.defaultVoiceEnabled, onValueChange: onDefaultVoiceToggle }}
        />
        <SettingsRow icon="mic" meaning="sound" title="Current voice" subtitle="Pick, preview or record a voice" value={voiceName} onPress={() => navigation.navigate("VoicePicker")} testID="current-voice" />
        <SettingsRow
          icon="mic"
          meaning="sound"
          title="Hey TrackLine"
          subtitle="While the map is open, say “Hey TrackLine, crash ahead”, “navigate home”, “mute” or “what's my ETA”. Listens on your phone only; the siren radar pauses while it's on."
          toggle={{ value: settings.wakePhrase, onValueChange: (v: boolean) => updateSettings({ wakePhrase: v }), testID: "wake-phrase-switch" }}
        />
      </Section>

      <Section title="Spoken directions" visible={shouldShow("Spoken directions")}>
        {SPOKEN_DIRECTIONS_OPTIONS.map((o) => (
          <SettingsRow
            key={o.key}
            title={o.label}
            subtitle={o.hint}
            selected={settings.spokenDirections === o.key}
            onPress={() => updateSettings({ spokenDirections: o.key })}
            testID={`spoken-${o.key}`}
          />
        ))}
      </Section>

      <Section title="Units" visible={shouldShow("Units")}>
        {CHOICE_LISTS.distanceUnit.options(settings).map((o) => (
          <SettingsRow
            key={o.key}
            title={o.label}
            subtitle={o.hint}
            selected={settings.distanceUnit === o.key}
            onPress={() => updateSettings(CHOICE_LISTS.distanceUnit.patch(o.key, settings))}
            testID={`units-${o.key}`}
          />
        ))}
      </Section>

      <Section
        title="Public transport"
        visible={shouldShow("Public transport")}
        footer="Live bus and train positions are NSW only. Everywhere else, Transit uses published timetables: the real line, stop and departure time."
      >
        <SettingsRow icon="train" meaning="routes" title="Live tracking" value="NSW only" />
      </Section>

      {/* ---------------- Alerts & community ---------------- */}
      <Section title="Live alerts" visible={shouldShow("Live alerts")}>
        <SettingsRow
          icon="notifications"
          meaning="reports"
          title="Receive alerts"
          subtitle={settings.alertsEnabled ? "Community alerts on your map and while you drive" : "Off: you won't see or get any community alerts"}
          toggle={{ value: settings.alertsEnabled, onValueChange: onAlertsEnabledToggle }}
        />
        <SettingsRow
          icon="layers"
          meaning="reports"
          title="Which reports show and alert"
          subtitle="Each type on its own"
          onPress={() => navigation.navigate("ReportsSettings")}
          testID="live-alerts-reports-link"
        />
        <SettingsRow
          icon="time"
          meaning="reports"
          title="Alert lifetime"
          subtitle="How long your reports stay up"
          value={currentChoiceLabel("alertLifetime", settings)}
          onPress={() => openChoice("alertLifetime")}
          testID="alert-lifetime-row"
        />
      </Section>

      <Section
        title="Alert regions"
        visible={shouldShow("Alert regions")}
        footer={`You see every alert in the states and territories switched on, however far away. ${regionsOn} on.`}
      >
        {AU_STATES.map((state) => (
          <SettingsRow
            key={state.code}
            title={state.label}
            disabled={!settings.alertsEnabled}
            toggle={{
              value: settings.visibleRegions.includes(state.code as AuRegionCode),
              onValueChange: (v) => onRegionToggle(state.code as AuRegionCode, v),
              disabled: !settings.alertsEnabled,
            }}
          />
        ))}
      </Section>

      <Section title="Emergency vehicle radar" visible={shouldShow("Emergency vehicle radar")} footer="Siren detection runs on your phone. Nothing is shared unless Auto-share is on.">
        <SettingsRow
          icon="radio"
          meaning="safety"
          title="Auto-share detections"
          subtitle="A confirmed siren posts an emergency vehicle alert at your location"
          toggle={{ value: settings.autoShareDetections, onValueChange: onAutoShareToggle }}
        />
        <SettingsRow icon="options" meaning="safety" title="Detection sensitivity" value={sensitivityLabel(settings.sirenSensitivity)}>
          <Slider
            minimumValue={0.3}
            maximumValue={0.9}
            step={0.05}
            value={settings.sirenSensitivity}
            onSlidingComplete={onSensitivityChange}
            minimumTrackTintColor={BLUE}
            maximumTrackTintColor={colours.switchOff}
            accessibilityLabel="Siren detection sensitivity"
          />
          <View style={styles.sliderEnds}>
            <Text style={[styles.sliderEnd, { color: colours.subtext }]}>Low</Text>
            <Text style={[styles.sliderEnd, { color: colours.subtext }]}>High</Text>
          </View>
        </SettingsRow>
      </Section>

      {/* ---------------- Notifications ---------------- */}
      <Section title="Messages from TrackLine" visible={shouldShow("Messages from TrackLine")} footer="Push, Inbox and banners. Account and security messages always come.">
        {(
          [
            ["notifyFun", "Fun announcements", "New features and Tracky news"],
            ["notifyNews", "News and updates", "What's changed in TrackLine"],
            ["notifyTraffic", "Traffic advisories", "Big closures and events near you"],
          ] as const
        ).map(([key, label, hint]) => (
          <SettingsRow
            key={key}
            icon="notifications"
            meaning="sound"
            title={label}
            subtitle={hint}
            toggle={{ value: settings[key], onValueChange: (v) => updateSettings({ [key]: v }), testID: `notify-${key}` }}
          />
        ))}
      </Section>

      {/* ---------------- Planned drives ---------------- */}
      <Section title="Planned drives" visible={shouldShow("Planned drives")} footer="Pick where you're going and when you'll leave to see the expected drive time.">
        <SettingsRow icon="calendar" meaning="routes" title="Plan a drive" subtitle="Drive time for when you leave" onPress={() => navigation.navigate("PlanADrive")} testID="plan-a-drive" />
      </Section>

      {/* ---------------- Vehicle & AI tools ---------------- */}
      <Section title="AI vehicle detection" visible={shouldShow("AI vehicle detection")}>
        <SettingsRow
          icon={batteryLow ? "battery-alert" : "battery-heart-variant"}
          meaning={batteryLow ? "safety" : "account"}
          title="Battery"
          subtitle={
            batteryPercent !== null
              ? `${batteryPercent}%${lowPowerMode ? ", Low Power Mode on" : ""}. Detection works best above 50%.`
              : "Detection works best above 50% battery."
          }
          onPress={() => setBatteryInfoOpen(true)}
          testID="battery-info"
        />
        <SettingsRow
          icon="moon"
          meaning="safety"
          title="Night mode"
          subtitle="Brighter camera and looser detection after dark"
          value={currentChoiceLabel("nightMode", settings)}
          onPress={() => openChoice("nightMode")}
          testID="night-mode-row"
        />
      </Section>

      <Section title="Vehicle checks" visible={shouldShow("Vehicle checks")} footer="Australia only. Vehicles the camera fully reads are saved here; you can also type any plate.">
        <SettingsRow
          icon="car-search"
          meaning="safety"
          title="Vehicle history and REV check"
          subtitle="Registration, odometer, stolen and written-off status"
          onPress={() => navigation.navigate("VehicleHistory")}
          testID="vehicle-history"
        />
      </Section>

      {isOwner && shouldShow("Owner tools") ? (
        <>
          <Section title="Owner tools" visible footer="Only you see this. Keys are saved to the server, never in the app, and only your account and the server can read them.">
            <SettingsRow icon="view-dashboard" meaning="account" title="Owner dashboard" subtitle="Users and notifications" onPress={() => navigation.navigate("OwnerDashboard")} />
            <SettingsRow icon="key-variant" meaning="account" title="PPSR and NEVDIS keys" subtitle="Stolen, written-off and registration history">
              {!keysLoaded ? (
                <ActivityIndicator size="small" color={colours.subtext} />
              ) : (
                <>
                  <SettingsInput value={ppsrKeyDraft} onChangeText={setPpsrKeyDraft} placeholder="PPSR provider key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
                  <SettingsInput value={nevdisKeyDraft} onChangeText={setNevdisKeyDraft} placeholder="NEVDIS provider key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
                </>
              )}
            </SettingsRow>
            <SettingsActionRow title={keysSavedFlash ? "Saved" : "Save keys"} onPress={onSaveRevCheckKeys} loading={savingKeys} disabled={!keysLoaded} />
            <SettingsRow icon="key-variant" meaning="account" title="Plate lookup username" subtitle="Make, model and year by plate (carregistrationapi.com.au)">
              {!plateLookupKeyLoaded ? (
                <ActivityIndicator size="small" color={colours.subtext} />
              ) : (
                <SettingsInput value={plateLookupUsernameDraft} onChangeText={setPlateLookupUsernameDraft} placeholder="Username" autoCapitalize="none" autoCorrect={false} secureTextEntry />
              )}
            </SettingsRow>
            <SettingsActionRow title={plateLookupKeySavedFlash ? "Saved" : "Save username"} onPress={onSavePlateLookupKey} loading={savingPlateLookupKey} disabled={!plateLookupKeyLoaded} />
            <SettingsRow icon="key-variant" meaning="account" title="Plate Recognizer key" subtitle="Cloud plate reading. Cropped plate images go to platerecognizer.com.">
              {!plateRecognizerKeyLoaded ? (
                <ActivityIndicator size="small" color={colours.subtext} />
              ) : (
                <SettingsInput value={plateRecognizerKeyDraft} onChangeText={setPlateRecognizerKeyDraft} placeholder="API key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
              )}
            </SettingsRow>
            <SettingsActionRow title={plateRecognizerKeySavedFlash ? "Saved" : "Save key"} onPress={onSavePlateRecognizerKey} loading={savingPlateRecognizerKey} disabled={!plateRecognizerKeyLoaded} />
          </Section>
        </>
      ) : null}

      <Modal visible={batteryInfoOpen} transparent animationType="fade" onRequestClose={() => setBatteryInfoOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setBatteryInfoOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colours.card }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colours.text }]}>Why battery matters</Text>
              <Button variant="ghost" icon="close" iconColor={colours.subtext} onPress={() => setBatteryInfoOpen(false)} accessibilityLabel="Close" />
            </View>
            <Text style={[styles.modalBody, { color: colours.text }]}>
              Vehicle detection runs the live camera through on-device AI many times a second, one of the heaviest things the app does. When the
              battery is low, or Low Power Mode is on, your phone slows its processor down to save power.
            </Text>
            <Text style={[styles.modalBody, { color: colours.text }]}>
              For the smoothest detection, keep the battery above 50% or plug in. Below that it still works, just more slowly.
            </Text>
            {batteryPercent !== null ? (
              <Text style={[styles.modalMeta, { color: colours.subtext }]}>
                Battery now: {batteryPercent}%{lowPowerMode ? ", Low Power Mode on" : ""}
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ---------------- Developer (development builds only) ---------------- */}
      {__DEV__ ? (
        <Section title="Touch debugger (dev only)" visible={shouldShow("Touch debugger (dev only)")} footer={`Running ${getBuildStamp()}`}>
          <TouchDebuggerRow />
          {(Object.keys(TEST_DRIVE_LABELS) as TestDriveKind[]).map((kind) => (
            <SettingsActionRow
              key={kind}
              title={TEST_DRIVE_LABELS[kind]}
              onPress={() => {
                navigation.navigate("Map");
                setTimeout(() => requestTestDrive(kind), 300);
              }}
            />
          ))}
        </Section>
      ) : null}
      {__DEV__ ? (
        <Section title="GPS replay (dev only)" visible={shouldShow("GPS replay (dev only)")} footer={gpxReplayRunning ? "Replay running. Real GPS is ignored until you stop it." : "Paste a recorded drive's GPX; the app plays it back as your location."}>
          <SettingsRow title="GPX">
            <SettingsInput value={gpxText} onChangeText={setGpxText} placeholder="<gpx>…</gpx>" multiline editable={!gpxReplayRunning} style={{ minHeight: 90 }} />
          </SettingsRow>
          <SettingsActionRow title="Start replay" onPress={onStartGpxReplay} disabled={gpxReplayRunning || !gpxText.trim()} />
          <SettingsActionRow title="Stop replay" onPress={onStopGpxReplay} disabled={!gpxReplayRunning} />
        </Section>
      ) : null}

      {/* ---------------- About ---------------- */}
      <Section title="About" visible={shouldShow("About")}>
        <SettingsRow
          icon="information-circle"
          meaning="account"
          title={Constants.expoConfig?.name ?? "TrackLine"}
          subtitle={`Version ${Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "1.0.0"}${Application.nativeBuildVersion ? ` (build ${Application.nativeBuildVersion})` : ""}`}
          testID="about-version"
        />
        <SettingsRow icon="code-slash" meaning="account" title="Build" subtitle={getBuildStamp()} testID="build-stamp" />
        <SettingsRow icon="map" meaning="map" title="Map engine" subtitle={mapEngineLine()} testID="map-engine" />
        <SettingsRow icon="construct" meaning="account" title="Diagnostics" subtitle="Map, routing and server checks" onPress={() => navigation.navigate("Diagnostics")} testID="open-diagnostics" />
        <SettingsRow icon="file-certificate" meaning="account" title="Licences and attributions" onPress={() => navigation.navigate("Licenses")} testID="open-licences" />
        {env.firebase.projectId ? (
          <SettingsRow
            icon="lock-closed"
            meaning="privacy"
            title="Privacy policy"
            onPress={() => Linking.openURL(`https://${env.firebase.projectId}.web.app/privacy.html`).catch(() => {})}
            testID="privacy-policy-link"
          />
        ) : null}
        {__DEV__ ? <SettingsRow icon="checkbox" meaning="account" title="Smoke test" subtitle="Development builds only" onPress={() => navigation.navigate("SmokeTest")} testID="open-smoke-test" /> : null}
      </Section>
      {shouldShow("About") ? (
        <View style={styles.aboutFooter} testID="data-sources">
          <Image source={require("../../assets/icon.png")} style={styles.aboutLogo} />
          {BUSINESS_INFO.businessName ? <Text style={[styles.aboutLine, { color: colours.subtext }]}>{BUSINESS_INFO.businessName}</Text> : null}
          {BUSINESS_INFO.abn ? <Text style={[styles.aboutLine, { color: colours.subtext }]}>ABN {BUSINESS_INFO.abn}</Text> : null}
          <Text style={[styles.aboutHeading, { color: colours.subtext }]}>Data sources</Text>
          {DATA_SOURCES.map((d) => (
            <Text key={d} style={[styles.aboutLine, { color: colours.subtext }]}>
              {d}
            </Text>
          ))}
        </View>
      ) : null}
    </SettingsPage>
  );
}

/** A card of rows, shown only in its category (or on the all-settings page). */
function Section({ title, visible = true, footer, children }: { title: string; visible?: boolean; footer?: string; children: React.ReactNode }) {
  if (!visible) return null;
  return (
    <SettingsSection title={title} footer={footer} testID={`section-${title}`}>
      {children}
    </SettingsSection>
  );
}

// What the map, speed limits and school zones are built from (Settings > About).
const DATA_SOURCES = [
  "Map, directions, traffic and route speed limits: Mapbox (© Mapbox, © OpenStreetMap contributors)",
  "Posted road speed limits, traffic lights, speed cameras: OpenStreetMap contributors (ODbL)",
  "NSW school zones and their hours: Transport for NSW, Speed Zones dataset (CC BY 4.0)",
  "NSW school terms: Transport for NSW (zone operating calendar) and NSW Department of Education",
  "NSW public holidays: NSW Government, Guide to Public Holidays",
  "Australian suburb names and postcodes: Australian Bureau of Statistics, ASGS Edition 3 (2021) Suburbs and Localities and Postal Areas (CC BY 4.0)",
  "NSW live traffic incidents and cameras: Transport for NSW, Live Traffic NSW (CC BY 4.0)",
  "Places, search and Street View: Google",
];

const styles = StyleSheet.create({
  sliderEnds: { flexDirection: "row", justifyContent: "space-between" },
  sliderEnd: { fontSize: 13, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { borderRadius: 16, padding: 20, gap: 12, width: "100%", maxWidth: 420 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 20, fontWeight: "700", flex: 1 },
  modalBody: { fontSize: 15, lineHeight: 21 },
  modalMeta: { fontSize: 13 },
  aboutFooter: { alignItems: "center", gap: 6, marginTop: 24, paddingHorizontal: 8 },
  aboutLogo: { width: 56, height: 56, borderRadius: 14, marginBottom: 6 },
  aboutHeading: { fontSize: 13, fontWeight: "600", marginTop: 8 },
  aboutLine: { fontSize: 13, lineHeight: 18, textAlign: "center" },
});
