// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // This rule only reports "React Compiler would skip optimising this component". The React
    // Compiler is not enabled in this project (no babel-plugin-react-compiler, no
    // experiments.reactCompiler), so it describes nothing that runs. The other compiler-era
    // rules (refs, set-state-in-effect, immutability, purity) stay on: they catch real bugs.
    rules: { "react-hooks/preserve-manual-memoization": "off" },
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
