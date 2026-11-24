import { Dimensions, Platform } from "react-native";
import { RUBIK } from "@/theme/typography";
import { colors } from "@/theme/tokens";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { MapScreen } from "@/screens/MapScreen";
import { SettingsScreen, SETTINGS_CATEGORY_LABELS, type SettingsCategory } from "@/screens/SettingsScreen";
import { SettingsChoiceScreen } from "@/screens/SettingsChoiceScreen";
import type { ChoiceListId } from "@/settings/choiceLists";
import { SettingsCategoriesScreen } from "@/screens/SettingsCategoriesScreen";
import { MainMenuScreen } from "@/screens/MainMenuScreen";
import { InboxScreen } from "@/screens/InboxScreen";
import { SignInScreen } from "@/screens/SignInScreen";
import { VehicleHistoryScreen } from "@/screens/VehicleHistoryScreen";
import { RevCheckScreen } from "@/screens/RevCheckScreen";
import { VehicleCheckScreen } from "@/screens/VehicleCheckScreen";
import { ReportItemSettingsScreen, ReportsSettingsScreen } from "@/screens/ReportsSettingsScreen";
import { ModerationScreen } from "@/screens/ModerationScreen";
import type { ReportItemId } from "@/settings/reportCatalog";
import { OwnerDashboardScreen } from "@/screens/OwnerDashboardScreen";
import { DocumentScanScreen } from "@/screens/DocumentScanScreen";
import { VehicleDetectionScreen } from "@/screens/VehicleDetectionScreen";
import { VehicleDetectionErrorBoundary } from "@/components/VehicleDetectionErrorBoundary";
import { VoicePickerScreen } from "@/screens/VoicePickerScreen";
import { RecordVoiceScreen } from "@/screens/RecordVoiceScreen";
import { navigationIntegration } from "@/services/sentry";
import { PlanADriveScreen } from "@/screens/PlanADriveScreen";
import { HelpScreen } from "@/screens/HelpScreen";
import { navigationRef } from "@/navigation/deepLinks";
import { AccountRecoveryScreen } from "@/screens/AccountRecoveryScreen";
import { PhoneSignInScreen } from "@/screens/PhoneSignInScreen";
import { SupportRequestsScreen } from "@/screens/SupportRequestsScreen";
import { LicensesScreen } from "@/screens/LicensesScreen";
import { DiagnosticsScreen } from "@/screens/DiagnosticsScreen";
import { OfflineMapsScreen } from "@/screens/OfflineMapsScreen";
import { PointsScreen } from "@/screens/PointsScreen";
import { TripHistoryScreen } from "@/screens/TripHistoryScreen";
import { SmokeTestScreen } from "@/screens/SmokeTestScreen";
import { TrackyProfileScreen } from "@/screens/TrackyProfileScreen";
import { TrackyCustomizerScreen } from "@/screens/TrackyCustomizerScreen";
import type { PlaceDetails } from "@/services/places";
import { MODAL_SCREENS, screensHiddenBehindModal } from "@/navigation/modalStack";
import { logNavigation } from "@/debug/touchDebug";
import { screenOrientation, TABLET_MIN_SHORT_SIDE } from "@/layout/screenLayout";

/** iPad (or a large Android tablet): every screen may turn. */
const IS_TABLET = (Platform.OS === "ios" && Platform.isPad) || Math.min(Dimensions.get("screen").width, Dimensions.get("screen").height) >= TABLET_MIN_SHORT_SIDE;

export type RevCheckParams = {
  // Prefilled plate -- from tapping a saved vehicle history entry, or a "Run REV Check" tap in
  // the live AI detection detail panel. Left undefined for a blank manual entry.
  plate?: string;
  state?: string;
  // Prefilled VIN -- only ever comes from a saved history entry that already had one recorded
  // (see vehicleHistory.ts). The camera can't read a VIN, so a detection-screen "Run REV Check"
  // tap never has one; the driver types it in on this screen instead.
  vin?: string;
  // Only present when opened from a live/saved AI detection -- shown as a read-only summary
  // card above the check form, per the explicit "display Speed Travelling, Number Plate" ask.
  vehicleLabel?: "Vehicle" | "Heavy Vehicle";
  speedKmh?: number | null;
  speedKind?: "absolute" | "closing" | null;
};

export type RootStackParamList = {
  // Real, explicit request -- Plan a Drive's own "Start" hand-off (see PlanADriveScreen.tsx)
  // needs a way to tell the already-mounted MapScreen which destination/departure time to pick
  // up with, since all of this screen's own search-to-route state lives inside MapScreen's own
  // local closures, not passed down via navigation elsewhere in this app. MapScreen reads these
  // once via useRoute/useFocusEffect and clears them (setParams) so returning to Map normally
  // afterward never re-triggers the same hand-off.
  Map: { planADriveDestination?: PlaceDetails } | undefined;
  // Real, explicit request (Waze-style redesign Phase 5) -- optional category filters this
  // screen down to just one group's real sections (see SettingsScreen.tsx's own shouldShow).
  // Omitted (every pre-existing navigate("Settings") call site) shows every section, unchanged.
  /** highlight: a setting that search jumped to (its row flashes). */
  Settings: { category?: SettingsCategory; highlight?: string } | undefined;
  SettingsChoice: { list: ChoiceListId };
  // The new top-level Waze-style category list this screen is reached from. See
  // SettingsCategoriesScreen.tsx.
  SettingsCategories: undefined;
  MainMenu: undefined;
  // Real feed of currently-visible community alerts, Phase 4's own main-menu Inbox row. See
  // InboxScreen.tsx.
  Inbox: undefined;
  // Real destination + departure-time planner, Phase 4's own main-menu "Plan a drive" card. See
  // PlanADriveScreen.tsx.
  // Optionally opened with a destination already chosen (the place page's "Add to a planned drive").
  PlanADrive: { initialDestination?: PlaceDetails } | undefined;
  // Real FAQ + contact row, Phase 4's own main-menu Help row. See HelpScreen.tsx.
  Help: undefined;
  // Sign in > Forgot password / Can't sign in? (src/account/recovery.ts).
  AccountRecovery: { mode?: "forgot" | "cancel" } | undefined;
  // Help > Contact support: in-app requests to the support inbox.
  SupportRequests: undefined;
  // Sign in > Continue with phone number (Firebase SMS code).
  PhoneSignIn: undefined;
  // Real, explicit request (Copyright/trademark safety audit, Part 4) -- Settings > About's own
  // "Licences & attributions" row. See LicensesScreen.tsx.
  Licenses: undefined;
  Diagnostics: undefined;
  OfflineMaps: undefined;
  // Points, levels, badges, weekly leaderboard (gap item 15).
  Points: undefined;
  // Trip history + stats (gap item 17).
  TripHistory: undefined;
  SmokeTest: undefined;
  // Real Tracky mood grid ("View profile" from the main menu header). See TrackyProfileScreen.tsx.
  TrackyProfile: undefined;
  // ADD-ON Part A -- the "Make your Tracky" customiser, reached from TrackyProfile. See
  // TrackyCustomizerScreen.tsx.
  TrackyCustomizer: undefined;
  SignIn: undefined;
  VehicleHistory: undefined;
  // Superseded by VehicleCheck (the one paid full check); kept registered, no longer linked.
  RevCheck: RevCheckParams | undefined;
  // Menu > Vehicle check. Same prefill params as the old REV check, plus an open report.
  VehicleCheck: (RevCheckParams & { reportId?: string }) | undefined;
  // Settings > Map information & overlays > Reports, and one item's detail.
  ReportsSettings: undefined;
  ReportItemSettings: { id: ReportItemId };
  // Owner/admin: fixed-feature reports waiting for approval.
  Moderation: undefined;
  // Real camera capture for a VIN or a plate/registration -- see DocumentScanScreen's own
  // header comment for why one screen serves both as two distinct, purpose-built experiences.
  DocumentScan: { mode: "vin" | "plate" };
  // True while a route is active in the background -- see VehicleDetectionScreen's own Props
  // for why this affects its side-capture interval timing.
  VehicleDetection: { isNavigating?: boolean } | undefined;
  OwnerDashboard: undefined;
  // Phase 1B of the Waze-style redesign -- the @rnmapbox/maps engine evaluation, an isolated
  // owner-only prototype screen. See MapboxMapScreen.tsx's own header. (The equivalent MapLibre
  // prototype that used to live here was removed -- see its own deletion commit for why: it and
  // @rnmapbox/maps both generate an iOS Codegen native-module spec literally named
  // `NativeMapViewModule`, which collided at the final static link step the moment both were
  // compiled into the same app, confirmed via a real EAS iOS build's actual linker error
  // ("duplicate symbol ... NativeMapViewModuleSpecJSI ... in rnmapbox_maps_specs-generated.o /
  // MapLibreReactNativeSpec-generated.o"). Real Mapbox was the user's own explicit engine
  // choice, so the now-superseded, already-broken-by-this prototype was deleted rather than the
  // real engine.
  // Phase 3 of the Waze-style redesign -- the real "Current voice" picker (search, Recommended/
  // My recorded voices/All languages sections, consent modal). See VoicePickerScreen.tsx.
  VoicePicker: undefined;
  // The picker's own "Record your own voice" entry point -- a real, guided, 6-second-clip
  // recorder for every turn-by-turn phrase the brief lists. See RecordVoiceScreen.tsx.
  RecordVoice: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Real, confirmed bug: AI Vehicle Detection's own rotation never actually worked on a real
// device (confirmed via screen recording -- the status bar, close button, and zoom slider all
// stayed fixed in their portrait positions for the whole recording despite the phone visibly
// being tilted through a full 90°+, even though every layer of app code -- Info.plist's
// `orientation: "default"`, App.tsx's own portrait lock, this screen's own
// ScreenOrientation.unlockAsync(), and the old wrapping Modal's supportedOrientations -- looked
// individually correct). Root cause: react-native-screens (which @react-navigation/native-stack
// uses under the hood) globally swizzles UIViewController's supportedInterfaceOrientations and
// resolves the CURRENT screen's real allowed orientation through its own screen-trait system
// (see RNSScreenWindowTraits.mm's enforceDesiredDeviceOrientation) -- a plain RN <Modal> floating
// outside that screen graph (which is what this used to be, rendered from inside MapScreen) is
// invisible to it, so expo-screen-orientation's manual unlockAsync() call never actually reached
// whatever view controller iOS was really asking. This is a documented, known conflict class
// between expo-screen-orientation and react-native-screens (see
// https://github.com/expo/expo/issues/43802) -- the real, supported fix is to stop fighting that
// swizzle with manual calls and instead register a genuine per-screen orientation the SAME
// system react-native-screens already understands: native-stack's own `orientation` screen
// option (backed by react-native-screens' real screenOrientation trait), set on a real navigator
// route instead of a floating Modal.
function VehicleDetectionRoute({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "VehicleDetection">) {
  const onClose = () => navigation.goBack();
  return (
    <VehicleDetectionErrorBoundary onClose={onClose}>
      <VehicleDetectionScreen onClose={onClose} isNavigating={!!route.params?.isNavigating} />
    </VehicleDetectionErrorBoundary>
  );
}

export function RootNavigator() {
  // Shared with deepLinks.ts so a message button can open a screen.

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => navigationIntegration.registerNavigationContainer(navigationRef)}
      // navigate("Typo") would otherwise do nothing at all; say so in development.
      onUnhandledAction={(action) => {
        if (__DEV__) console.warn("[nav] nothing handled this navigation (unknown screen?)", JSON.stringify(action));
      }}
      onStateChange={(state) => {
        const names = state?.routes.map((r) => r.name) ?? [];
        logNavigation(names[names.length - 1] ?? "?");
        const hidden = screensHiddenBehindModal(names);
        if (__DEV__ && hidden.length > 0) {
          console.warn(`[nav] ${hidden.join(", ")} opened behind a modal screen and can't be seen (see navigation/modalStack.ts)`);
        }
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // Fix pass 7 §3: portrait on phones, any way up on tablets (layout/screenLayout.ts).
          orientation: screenOrientation("", IS_TABLET),
          // The native header draws its own title, outside the app's Text wrapper -- so it's
          // told about the app font here. Applies to every screen that shows a header.
          headerTitleStyle: { fontFamily: RUBIK.semiBold, color: colors.text },
          headerBackTitleStyle: { fontFamily: RUBIK.regular },
          headerTintColor: colors.accent,
        }}
      >
        <Stack.Screen name="Map" component={MapScreen} options={{ title: "Map", orientation: screenOrientation("Map", IS_TABLET) }} />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={({ route }) => ({
            headerShown: true,
            title: route.params?.category ? SETTINGS_CATEGORY_LABELS[route.params.category] : "Settings",
          })}
        />
        <Stack.Screen name="SettingsCategories" component={SettingsCategoriesScreen} options={{ title: "Settings" }} />
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ headerShown: true, title: "Sign in" }}
        />
        <Stack.Screen
          name="MainMenu"
          component={MainMenuScreen}
          // An ordinary screen, not a modal: every row opens another screen, and on iOS a
          // screen opened from a modal is drawn underneath it (see navigation/modalStack.ts).
          options={{ animation: "slide_from_left", title: "Menu" }}
        />
        <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: "Inbox" }} />
        <Stack.Screen name="PlanADrive" component={PlanADriveScreen} options={{ title: "Plan a drive" }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: "Help" }} />
        <Stack.Screen name="AccountRecovery" component={AccountRecoveryScreen} options={{ headerShown: true, title: "Account help" }} />
        <Stack.Screen name="SupportRequests" component={SupportRequestsScreen} options={{ headerShown: true, title: "Contact support" }} />
        <Stack.Screen name="PhoneSignIn" component={PhoneSignInScreen} options={{ headerShown: true, title: "Phone number" }} />
        <Stack.Screen name="Licenses" component={LicensesScreen} options={{ title: "Licences" }} />
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ headerShown: true, title: "Diagnostics" }} />
        <Stack.Screen name="OfflineMaps" component={OfflineMapsScreen} options={{ headerShown: true, title: "Offline maps" }} />
        <Stack.Screen name="Points" component={PointsScreen} options={{ headerShown: true, title: "Points & badges" }} />
        <Stack.Screen name="TripHistory" component={TripHistoryScreen} options={{ headerShown: true, title: "Trip history" }} />
        <Stack.Screen name="SettingsChoice" component={SettingsChoiceScreen} options={{ headerShown: true, title: "Settings" }} />
        {/* Development builds only (a JS bundle served by Metro: __DEV__). */}
        {__DEV__ ? <Stack.Screen name="SmokeTest" component={SmokeTestScreen} options={{ headerShown: true, title: "Smoke test" }} /> : null}
        <Stack.Screen name="TrackyProfile" component={TrackyProfileScreen} options={{ title: "Your Tracky" }} />
        <Stack.Screen name="TrackyCustomizer" component={TrackyCustomizerScreen} options={{ title: "Make your Tracky" }} />
        <Stack.Screen
          name="VehicleHistory"
          component={VehicleHistoryScreen}
          options={{ headerShown: true, title: "Vehicle history" }}
        />
        <Stack.Screen name="ReportsSettings" component={ReportsSettingsScreen} options={{ headerShown: true, title: "Reports" }} />
        <Stack.Screen name="ReportItemSettings" component={ReportItemSettingsScreen} options={{ headerShown: true, title: "Report" }} />
        <Stack.Screen name="Moderation" component={ModerationScreen} options={{ headerShown: true, title: "Moderation queue" }} />
        <Stack.Screen
          name="VehicleCheck"
          component={VehicleCheckScreen}
          options={{ headerShown: true, title: "Vehicle check", presentation: MODAL_SCREENS.VehicleCheck as "modal" }}
        />
        <Stack.Screen
          name="RevCheck"
          component={RevCheckScreen}
          options={{ headerShown: true, title: "REV check", presentation: MODAL_SCREENS.RevCheck as "modal" }}
        />
        <Stack.Screen
          name="OwnerDashboard"
          component={OwnerDashboardScreen}
          options={{ headerShown: true, title: "Owner dashboard" }}
        />
        <Stack.Screen
          name="DocumentScan"
          component={DocumentScanScreen}
          options={{ presentation: MODAL_SCREENS.DocumentScan as "modal", title: "Scan" }}
        />
        <Stack.Screen
          name="VoicePicker"
          component={VoicePickerScreen}
          options={{ headerShown: true, title: "Current voice" }}
        />
        <Stack.Screen
          name="RecordVoice"
          component={RecordVoiceScreen}
          options={{ headerShown: true, title: "Record your own voice" }}
        />
        <Stack.Screen
          name="VehicleDetection"
          component={VehicleDetectionRoute}
          options={{
            title: "Vehicle detection",
            presentation: MODAL_SCREENS.VehicleDetection as "fullScreenModal",
            animation: "slide_from_bottom",
            // The real fix -- see this file's own header comment on VehicleDetectionRoute for
            // why this (not expo-screen-orientation) is what actually lets this one screen
            // rotate while every other screen in the app stays portrait-only.
            orientation: "all",
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
