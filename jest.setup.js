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
