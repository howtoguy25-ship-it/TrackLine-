import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { formatBuildStamp } from "@/config/buildStamp";

/** "v1.3.0 (7) · b7de7b6 · 2026-11-12 07:21 UTC" for the code running right now. */
export function getBuildStamp(): string {
  const stamp = (Constants.expoConfig?.extra as { buildStamp?: { commit?: string; builtAt?: string } } | undefined)?.buildStamp;
  const source = __DEV__ ? "dev-server" : Updates.isEnabled && !Updates.isEmbeddedLaunch ? "update" : "embedded";
  return formatBuildStamp({
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
    buildNumber: Application.nativeBuildVersion,
    commit: stamp?.commit,
    builtAt: stamp?.builtAt,
    source,
  });
}
