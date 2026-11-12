// "Written but not wired in" can't pass silently: every new piece of UI pass 2, the button fix
// and the Mapbox map must be RENDERED (as JSX) by the screen that's live on the phone, starting
// from the app entry. And the old home-screen pieces must not be rendered anywhere.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";
import { formatBuildStamp } from "../../src/config/buildStamp";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const renders = (file: string, component: string) => new RegExp(`<${component}[\\s>/]`).test(read(file));

describe("wired into the live app", () => {
  it("entry -> App -> navigator -> Map screen", () => {
    expect(JSON.parse(read("package.json")).main).toBe("node_modules/expo/AppEntry.js");
    expect(renders("App.tsx", "RootNavigator")).toBe(true);
    expect(renders("App.tsx", "TouchDebugRoot")).toBe(true);
    expect(read("src/navigation/RootNavigator.tsx")).toMatch(/<Stack\.Screen name="Map" component=\{MapScreen\}/);
    // Map is the first screen, so it's what opens.
    const firstScreen = read("src/navigation/RootNavigator.tsx").match(/<Stack\.Screen\s+name="([A-Za-z]+)"/);
    expect(firstScreen?.[1]).toBe("Map");
  });

  it.each([
    ["src/screens/MapScreen.tsx", "TrackLineMap"],
    ["src/screens/MapScreen.tsx", "MapboxLayers"],
    ["src/screens/MapScreen.tsx", "HomeMapControls"],
    ["src/screens/MapScreen.tsx", "StreetPill"],
    ["src/screens/MapScreen.tsx", "WhereToSheet"],
    ["src/screens/MapScreen.tsx", "PlacePage"],
    ["src/screens/MapScreen.tsx", "RouteSelectionTopCard"],
    ["src/screens/MapScreen.tsx", "RouteSelectionSheet"],
    ["src/screens/MapScreen.tsx", "AvoidSheet"],
    ["src/screens/MapScreen.tsx", "TravelModeSheet"],
    ["src/screens/MapScreen.tsx", "BannerAdBar"],
    ["src/screens/WhereToSheet.tsx", "ThreeSnapBottomSheet"],
    ["src/components/HomeMapControls.tsx", "FloatingButton"],
    ["src/screens/PlacePage.tsx", "Button"],
    ["src/map-v2/MapboxLayers.tsx", "UserPuck"],
    ["src/map-v2/MapboxLayers.tsx", "PinLayer"],
    ["src/map-v2/MapboxLayers.tsx", "PresenceLayerV2"],
    ["src/map-v2/MapboxLayers.tsx", "RouteLine"],
    ["src/screens/SettingsScreen.tsx", "TouchDebuggerRow"],
  ])("%s renders <%s>", (file, component) => {
    expect(renders(file, component)).toBe(true);
  });

  it("every screen's text goes through the Rubik wrapper, not react-native's Text", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (rel.endsWith(".tsx") && !rel.endsWith("AppText.tsx")) {
          const src = read(rel);
          const rnImport = src.match(/import\s*\{([^}]*)\}\s*from\s*"react-native";/);
          if (rnImport && /\bText\b(?!Input|Style)/.test(rnImport[1].replace(/type \w+/g, ""))) offenders.push(rel);
        }
      }
    };
    walk("src/screens");
    walk("src/components");
    expect(offenders).toEqual([]);
  });
});

describe("old home-screen pieces are gone", () => {
  it("react-native-maps is not a dependency and not imported", () => {
    expect(JSON.parse(read("package.json")).dependencies["react-native-maps"]).toBeUndefined();
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(rel) && /from "react-native-maps"/.test(read(rel))) hits.push(rel);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });

  it("the map screen doesn't render the Map tools sheet's old home buttons or the old button components", () => {
    const map = read("src/screens/MapScreen.tsx");
    for (const gone of ["MenuButton", "CompassButton", "SoundButton", "RouteOptionsCard", "AlertMarker", "Map3DView"]) {
      expect(renders("src/screens/MapScreen.tsx", gone)).toBe(false);
      expect(fs.existsSync(path.join(ROOT, `src/components/${gone}.tsx`))).toBe(false);
    }
    // The Map tools panel only opens from Trip options during navigation, never from a home button.
    expect(map).not.toMatch(/accessibilityLabel="Map tools"/);
  });
});

describe("build stamp", () => {
  it("shows version, build, commit and UTC build time", () => {
    expect(
      formatBuildStamp({ version: "1.3.0", buildNumber: "7", commit: "b7de7b6", builtAt: "2026-11-12T07:21:23.881Z", source: "embedded" })
    ).toBe("v1.3.0 (7) · b7de7b6 · 2026-11-12 07:21 UTC");
  });
  it("says when the JavaScript comes from a dev server or an update", () => {
    expect(formatBuildStamp({ version: "1.3.0", buildNumber: null, commit: "abc1234", builtAt: null, source: "dev-server" })).toBe(
      "v1.3.0 · abc1234 · JS from dev server"
    );
    expect(formatBuildStamp({ version: null, buildNumber: null, commit: null, builtAt: "bad", source: "update" })).toBe(
      "v? · unknown commit · OTA update"
    );
  });
});
