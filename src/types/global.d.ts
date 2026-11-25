// This project's tsconfig sets customConditions: ["react-native"] (Expo's own recommended
// config, to match Metro's real module resolution) -- which means some libraries' raw .ts
// SOURCE gets type-checked directly instead of their compiled output, since their package.json
// "exports" map points a "react-native" condition straight at src/*.ts. react-native-iap does
// this, and its own source references the ambient Node-style `global` identifier. Verified this
// project's @types/node + "dom" lib combination doesn't reliably surface `global` on its own
// (other Node ambients like `process` resolve fine from the very same @types/node package,
// `global` specifically doesn't) -- declared explicitly here rather than left broken. `global`
// genuinely exists at runtime in React Native (its own JS engine provides it); this only makes
// it visible to TypeScript.
// `var` is required: only an ambient `var` declares a property of globalThis.
// eslint-disable-next-line no-var
declare var global: typeof globalThis;
