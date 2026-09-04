import React, { useRef } from "react";
import { NavigationContainer, type NavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MapScreen } from "@/screens/MapScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SignInScreen } from "@/screens/SignInScreen";
import { VehicleHistoryScreen } from "@/screens/VehicleHistoryScreen";
import { RevCheckScreen } from "@/screens/RevCheckScreen";
import { DocumentScanScreen } from "@/screens/DocumentScanScreen";
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
  SignIn: undefined;
  VehicleHistory: undefined;
  RevCheck: RevCheckParams | undefined;
  // Real camera capture for a VIN or a plate/registration -- see DocumentScanScreen's own
  // header comment for why one screen serves both as two distinct, purpose-built experiences.
  DocumentScan: { mode: "vin" | "plate" };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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
          name="VehicleHistory"
          component={VehicleHistoryScreen}
          options={{ headerShown: true, title: "Vehicle History" }}
        />
        <Stack.Screen
          name="RevCheck"
          component={RevCheckScreen}
          options={{ headerShown: true, title: "REV Check" }}
        />
        <Stack.Screen name="DocumentScan" component={DocumentScanScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
