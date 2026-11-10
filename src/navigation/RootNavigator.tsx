import React, { useRef } from "react";
import { NavigationContainer, type NavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { MapScreen } from "@/screens/MapScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { MainMenuScreen } from "@/screens/MainMenuScreen";
import { InboxScreen } from "@/screens/InboxScreen";
import { SignInScreen } from "@/screens/SignInScreen";
import { VehicleHistoryScreen } from "@/screens/VehicleHistoryScreen";
import { RevCheckScreen } from "@/screens/RevCheckScreen";
import { OwnerDashboardScreen } from "@/screens/OwnerDashboardScreen";
import { DocumentScanScreen } from "@/screens/DocumentScanScreen";
import { VehicleDetectionScreen } from "@/screens/VehicleDetectionScreen";
import { VehicleDetectionErrorBoundary } from "@/components/VehicleDetectionErrorBoundary";
import { MapboxMapScreen } from "@/screens/MapboxMapScreen";
import { VoicePickerScreen } from "@/screens/VoicePickerScreen";
import { RecordVoiceScreen } from "@/screens/RecordVoiceScreen";
import { navigationIntegration } from "@/services/sentry";

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
  Map: undefined;
  Settings: undefined;
  MainMenu: undefined;
  // Real feed of currently-visible community alerts, Phase 4's own main-menu Inbox row. See
  // InboxScreen.tsx.
  Inbox: undefined;
  SignIn: undefined;
  VehicleHistory: undefined;
  RevCheck: RevCheckParams | undefined;
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
  MapboxMapPreview: undefined;
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
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => navigationIntegration.registerNavigationContainer(navigationRef)}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Map" component={MapScreen} />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ headerShown: true, title: "Settings" }}
        />
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ headerShown: true, title: "Sign In" }}
        />
        <Stack.Screen
          name="MainMenu"
          component={MainMenuScreen}
          options={{ presentation: "transparentModal", animation: "slide_from_left" }}
        />
        <Stack.Screen name="Inbox" component={InboxScreen} />
        <Stack.Screen
          name="VehicleHistory"
          component={VehicleHistoryScreen}
          options={{ headerShown: true, title: "Vehicle History" }}
        />
        <Stack.Screen
          name="RevCheck"
          component={RevCheckScreen}
          options={{ headerShown: true, title: "REV Check" }}
        />
        <Stack.Screen
          name="OwnerDashboard"
          component={OwnerDashboardScreen}
          options={{ headerShown: true, title: "Owner Dashboard" }}
        />
        <Stack.Screen name="DocumentScan" component={DocumentScanScreen} />
        <Stack.Screen
          name="MapboxMapPreview"
          component={MapboxMapScreen}
          options={{ headerShown: true, title: "Mapbox map preview" }}
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
            presentation: "fullScreenModal",
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
