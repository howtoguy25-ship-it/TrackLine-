const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The vehicle classifier's weight shards are loaded via require() (see modelAssetIO.ts) --
// Metro needs to treat .bin files as binary assets, not source, for that to resolve correctly.
config.resolver.assetExts.push("bin");
// react-native-fast-tflite loads the on-device object detection model via require() too.
config.resolver.assetExts.push("tflite");

// The owner dashboard (/admin) is a separate Next.js app with its own node_modules; the phone
// app never imports it, so Metro doesn't need to watch or index it.
const path = require("path");
const adminDir = path.resolve(__dirname, "admin").replace(/[/\\]/g, "[/\\\\]");
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), new RegExp(`^${adminDir}[/\\\\].*`)];

module.exports = config;
