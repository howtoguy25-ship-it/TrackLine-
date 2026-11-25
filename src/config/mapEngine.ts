import Constants from "expo-constants";
import { isMapboxUsable } from "@/map-v2/mapbox";
import { STYLE_VERSION } from "@/map-v2/styles/buildStyle";

/** Settings > About: which map is really running -- "Map engine: Mapbox · style v3 · commit 1a2b3c4". */
export function mapEngineLine(usable: boolean = isMapboxUsable(), commit: string | undefined = buildCommit()): string {
  const engine = usable ? "Mapbox" : "none (Mapbox isn't set up in this build)";
  return `Map engine: ${engine} · style v${STYLE_VERSION} · commit ${commit ? commit.slice(0, 7) : "unknown"}`;
}

function buildCommit(): string | undefined {
  return (Constants.expoConfig?.extra as { buildStamp?: { commit?: string } } | undefined)?.buildStamp?.commit;
}
