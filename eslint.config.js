// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
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
]);
