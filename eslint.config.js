// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

const BASE_SYNTAX = [
  {
    selector: "VariableDeclarator[id.name=/^(MOCK|FAKE|DUMMY)_|^SAMPLE_(REPORT|DATA|RESULT)|^(mock|fake|dummy)[A-Z]/]",
    message: "No mock, fake or dummy data in production code: use the real source, or an honest 'not available' state.",
  },
  // Permanent fix §1: the driver is drawn ONLY by map-v2/layers/UserArrow.tsx. A second
  // renderer (Mapbox's puck, its UserLocation, the platform blue dot) is what kept bringing
  // back the blue ball and the lag.
  {
    selector: "JSXOpeningElement[name.name=/^(LocationPuck|UserLocation|CustomLocationProvider)$/]",
    message: "Only UserArrow draws the driver (permanent fix §1).",
  },
  {
    selector: "JSXMemberExpression[property.name=/^(LocationPuck|UserLocation|CustomLocationProvider)$/]",
    message: "Only UserArrow draws the driver (permanent fix §1).",
  },
  {
    selector: "MemberExpression[property.name=/^(LocationPuck|UserLocation|CustomLocationProvider)$/]",
    message: "Only UserArrow draws the driver (permanent fix §1).",
  },
  {
    selector: "JSXAttribute[name.name=/^(showsUserLocation|showUserLocation|puckBearing|puckBearingEnabled|followUserLocation|followUserMode)$/]",
    message: "No native user dot / puck / follow mode: UserArrow draws the driver and CameraController moves the camera (permanent fix).",
  },
];
// Permanent fix §2: ONE camera owner. Every animateCamera / fitToCoordinates / animateToRegion /
// setCamera / flyTo / fitBounds call goes through map-v2/cameraController.ts, which knows whether
// the driver has moved the map (FREE) and refuses automatic moves then.
const CAMERA_SYNTAX = [
  {
    selector: "CallExpression > MemberExpression.callee[property.name=/^(animateCamera|fitToCoordinates|animateToRegion|setCamera|flyTo|fitBounds|easeTo|jumpTo)$/]",
    message: "Move the camera only through CameraController (src/map-v2/cameraController.ts): camera.move / camera.fit / camera.region with a source (permanent fix §2).",
  },
];
const CAMERA_OWNERS = ["src/map-v2/cameraController.ts", "src/map-v2/TrackLineMap.tsx"];

module.exports = defineConfig([
  expoConfig,
  {
    // Build output (git-ignored) is not source: web/dist alone was 5,399 "problems".
    ignores: ["dist/*", "admin/**", "web/dist/**", "**/.next/**"],
  },
  {
    // This rule only reports "React Compiler would skip optimising this component". The React
    // Compiler is not enabled in this project (no babel-plugin-react-compiler, no
    // experiments.reactCompiler), so it describes nothing that runs. The other compiler-era
    // rules (refs, set-state-in-effect, immutability, purity) stay on: they catch real bugs.
    rules: { "react-hooks/preserve-manual-memoization": "off" },
  },
  {
    // Nothing fake in the shipped app (REAL_AUDIT.md): production code can't import test
    // fixtures, mocks, stubs or the test support folder, and can't name a value MOCK_/FAKE_/DUMMY_.
    // Dev-only tools live in src/dev and are only reachable behind __DEV__.
    files: ["src/**/*.{ts,tsx}"],
    ignores: CAMERA_OWNERS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/__tests__/**", "**/__mocks__/**", "**/fixtures/**", "**/support/stubs*"], message: "Production code must not use test fixtures or mocks." },
            { group: ["**/*mock*", "**/*Mock*", "**/*fake*", "**/*Fake*"], message: "Production code must not import mocks or fakes." },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...BASE_SYNTAX, ...CAMERA_SYNTAX],
    },
  },
  {
    // The two files that may move the camera: the controller, and the map component it drives.
    files: CAMERA_OWNERS,
    rules: { "no-restricted-syntax": ["error", ...BASE_SYNTAX] },
  },
  {
    // Jest tests: jest.mock() calls must come before the imports they replace, and a mock
    // factory can only reach outside values through require().
    files: ["__tests__/**/*.{ts,tsx}", "jest.setup.js"],
    languageOptions: { globals: { jest: "readonly" } },
    rules: {
      "import/first": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Cloud Functions and their emulator tests run in Node under Jest, not in the app.
    files: ["firebase/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly", module: "writable", exports: "writable", process: "readonly",
        Buffer: "readonly", __dirname: "readonly", console: "readonly",
        describe: "readonly", test: "readonly", it: "readonly", expect: "readonly",
        beforeAll: "readonly", afterAll: "readonly", beforeEach: "readonly", afterEach: "readonly", jest: "readonly",
      },
    },
  },
]);
