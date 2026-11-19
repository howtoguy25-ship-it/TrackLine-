// Real, confirmed EAS Android build failure: `react-native-google-mobile-ads`'s pinned
// `play-services-ads:25.4.0` ships real Kotlin metadata at binary version 2.3.0 (confirmed by
// decompiling the real .jar's own .kotlin_module files), but this project's generated root
// android/build.gradle applies the Kotlin Gradle Plugin with NO version string at all
// (`classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')`), which resolves to 2.1.20 (react-
// native's own gradle/libs.versions.toml pin) -- and a 2.1.x compiler can only read metadata up
// to one minor version ahead of itself (2.2.0), one short of 2.3.0. Confirmed real via a local
// build: `Module was compiled with an incompatible version of Kotlin. The binary version of its
// metadata is 2.3.0, expected version is 2.1.0.`
//
// Real root-cause investigation this session already ran (and ruled out) before landing here:
// - `android.kotlinVersion` (an Expo Gradle property, documented to override the *version
//   catalog's* own "kotlin" entry) has ZERO effect on the actually-applied compiler -- that
//   catalog is a separate mechanism from what resolves this specific unversioned classpath
//   entry.
// - Setting `rootProject.ext.kotlinVersion` and/or hardcoding a newer kotlin-gradle-plugin
//   version directly inside react-native-google-mobile-ads' OWN build.gradle (it reads
//   `rootProject.ext.get('kotlinVersion')` via its own `getExtOrDefault` helper) also has ZERO
//   effect -- that module's own buildscript classpath block is only consulted when its android/
//   dir is opened standalone as the Gradle root project, which it never is in a real app build;
//   it's otherwise a dead/unused declaration.
// - A `pluginManagement { resolutionStrategy { eachPlugin { ... } } }` substitution in
//   settings.gradle also has ZERO effect, because the Kotlin plugin is applied here via the old
//   `apply plugin: 'kotlin-android'` string syntax (confirmed by reading the installed node_modules
//   source), which resolves via buildscript classpath, not Gradle's plugin-ID resolution that
//   `eachPlugin` intercepts.
// The one lever that actually worked, confirmed via a real local `./gradlew
// :react-native-google-mobile-ads:compileReleaseKotlin` run that changed from the metadata error
// to a genuine BUILD SUCCESSFUL: directly pinning a real version string on the ROOT project's
// own (consuming-app-level) classpath entry for `org.jetbrains.kotlin:kotlin-gradle-plugin`,
// since that's the one unversioned coordinate every subproject's `apply plugin: 'kotlin-android'`
// actually resolves against project-wide.
//
// 2.2.20 (not higher) -- confirmed both by the real "a Kotlin compiler reads metadata up to one
// minor version ahead of itself" rule (2.2.x can read 2.3.0 metadata) and by Expo's own
// ExpoRootProjectPlugin KSP-version lookup table only recognising a fixed list of Kotlin
// versions (2.2.20/2.2.10/2.2.0/2.1.21/2.1.20/2.0.21) -- 2.3.x is explicitly NOT supported by
// Expo modules' own KSP wiring yet, confirmed via reading expo-modules-autolinking's own
// ExpoRootProjectPlugin.kt source (`if (kotlinVersion >= "2.3.0") ... else throw ...`, the
// else branch is a real, hard failure for any version its own lookup table doesn't recognise).
//
// Bumping the project-wide Kotlin compiler this way surfaced one further real regression in
// this project's own code (modules/map3d's ExpoMap3DView.kt/Map3DModule.kt -- the newer compiler
// can now correctly read play-services-maps3d's own Kotlin metadata too, revealing real
// nullable-property/SAM-conversion issues that were silently masked by the old compiler's
// lenient platform-type fallback before; fixed directly in that module, see its own commit).
const { withProjectBuildGradle } = require("expo/config-plugins");

const KOTLIN_VERSION = "2.2.20";

const UNVERSIONED_CLASSPATH = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";
const VERSIONED_CLASSPATH = `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}")`;

function pinKotlinGradlePluginVersion(buildGradle) {
  let next = buildGradle;
  if (next.includes(UNVERSIONED_CLASSPATH)) {
    next = next.replace(UNVERSIONED_CLASSPATH, VERSIONED_CLASSPATH);
  }
  if (!next.includes("kotlinVersion =")) {
    const snippet = `
        // --- KOTLIN GRADLE PLUGIN VERSION FIX START (see plugins/withAndroidKotlinGradlePluginVersion.js) ---
        kotlinVersion = '${KOTLIN_VERSION}'
        // --- KOTLIN GRADLE PLUGIN VERSION FIX END ---
  `;
    next = next.includes("ext {") ? next.replace("ext {", `ext {${snippet}`) : `${next}\nbuildscript {\n    ext {${snippet}\n    }\n}\n`;
  }
  return next;
}

const withAndroidKotlinGradlePluginVersion = (config) =>
  withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language === "groovy") {
      gradleConfig.modResults.contents = pinKotlinGradlePluginVersion(gradleConfig.modResults.contents);
    }
    return gradleConfig;
  });

module.exports = withAndroidKotlinGradlePluginVersion;
