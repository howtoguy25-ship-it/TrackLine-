// Real, confirmed EAS Android build failure (EAS_BUILD_UNKNOWN_GRADLE_ERROR during the "Run
// gradlew" phase): react-native-webview's own android/build.gradle reads
// `androidx.webkit:webkit:${safeExtGet('webkitVersion')}` with NO fallback value (unlike every
// other native module in this project -- react-native-maps, expo-modules-core, etc. -- which all
// call their own safeExtGet with a real default). This project's generated root build.gradle
// never defines `ext.webkitVersion` anywhere (confirmed by inspecting the generated
// android/build.gradle after a local `expo prebuild`), so react-native-webview's own
// `rootProject.ext.has('webkitVersion')` check is false and it falls through to
// `project.properties['ReactNativeWebView_webkitVersion']`, which is also never set -- so the
// dependency line resolves to the literal, unresolvable coordinate "androidx.webkit:webkit:null".
//
// Fix: inject a real `ext.webkitVersion` into the root build.gradle during prebuild, same
// mechanism/style already used by rn-mlkit-ocr's own bundled config plugin (see
// node_modules/rn-mlkit-ocr/plugin/src/index.ts) to set its own ext properties on this exact
// file. 1.18.0 is the current stable androidx.webkit release (confirmed directly against
// Google's Maven metadata at https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/
// maven-metadata.xml -- 1.19.0-alpha01 is the latest overall but is a pre-release alpha).
const { withProjectBuildGradle } = require("expo/config-plugins");

const WEBKIT_VERSION = "1.18.0";

function setWebkitVersion(buildGradle) {
  if (buildGradle.includes("webkitVersion =")) {
    return buildGradle;
  }
  const snippet = `
        // --- REACT-NATIVE-WEBVIEW GRADLE FIX START (see plugins/withAndroidWebviewGradleFix.js) ---
        webkitVersion = '${WEBKIT_VERSION}'
        // --- REACT-NATIVE-WEBVIEW GRADLE FIX END ---
  `;
  if (buildGradle.includes("ext {")) {
    return buildGradle.replace("ext {", `ext {${snippet}`);
  }
  return `${buildGradle}\nbuildscript {\n    ext {${snippet}\n    }\n}\n`;
}

const withAndroidWebviewGradleFix = (config) =>
  withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language === "groovy") {
      gradleConfig.modResults.contents = setWebkitVersion(gradleConfig.modResults.contents);
    }
    return gradleConfig;
  });

module.exports = withAndroidWebviewGradleFix;
