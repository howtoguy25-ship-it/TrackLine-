// Shared Jest setup: the official in-JS stand-ins for the native animation and gesture
// libraries, so components using them can be rendered in tests.
/* eslint-env jest */
require("react-native-gesture-handler/jestSetup");
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
// Native-only SDKs pulled in by config/env.ts and services/sentry.ts.
jest.mock("react-native-google-mobile-ads", () => ({
  TestIds: { BANNER: "test-banner", APP_OPEN: "test-app-open", INTERSTITIAL: "test-interstitial" },
  BannerAd: () => null,
  BannerAdSize: { BANNER: "BANNER" },
}));
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// Firebase ships ESM that Jest can't load, and no test talks to a real backend. Anything that
// reaches Firebase (settings sync, the button family reading the map theme...) gets an inert stub.
jest.mock("@/services/firebase", () => require("./__tests__/support/stubs").stubService());
jest.mock("firebase/firestore", () => require("./__tests__/support/stubs").stubService());
jest.mock("firebase/storage", () => require("./__tests__/support/stubs").stubService());
jest.mock("firebase/auth", () => require("./__tests__/support/stubs").stubService());
jest.mock("firebase/functions", () => require("./__tests__/support/stubs").stubService());
jest.mock("firebase/app", () => require("./__tests__/support/stubs").stubService());
