// The root cause of "buttons do nothing": screens opened from a native modal were drawn
// underneath it. These tests pin the navigator config so that can't come back, and check that
// every navigate("X") in the app names a registered screen.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";
import { MODAL_SCREENS, screensHiddenBehindModal } from "../../src/navigation/modalStack";

const SRC = path.join(__dirname, "../../src");
const navigatorSource = fs.readFileSync(path.join(SRC, "navigation/RootNavigator.tsx"), "utf8");

function allSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return allSourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** Every <Stack.Screen name="X" ...> with the text of its options. */
function registeredScreens(): Map<string, string> {
  const screens = new Map<string, string>();
  const re = /<Stack\.Screen\s+name="([A-Za-z]+)"([\s\S]*?)\/>/g;
  for (const m of navigatorSource.matchAll(re)) screens.set(m[1], m[2]);
  return screens;
}

describe("modal stacking rule (iOS draws a pushed screen under a modal)", () => {
  it("flags a push screen opened above a modal", () => {
    expect(screensHiddenBehindModal(["Map", "VehicleDetection", "Settings"])).toEqual(["Settings"]);
  });
  it("is fine with modals on modals and plain push stacks", () => {
    expect(screensHiddenBehindModal(["Map", "VehicleDetection", "RevCheck", "DocumentScan"])).toEqual([]);
    expect(screensHiddenBehindModal(["Map", "MainMenu", "PlanADrive"])).toEqual([]);
    expect(screensHiddenBehindModal(["Map", "MainMenu", "Settings", "VoicePicker"])).toEqual([]);
  });
});

describe("navigator configuration", () => {
  const screens = registeredScreens();

  it("the Main menu is an ordinary screen, not a modal", () => {
    expect(screens.get("MainMenu")).toBeDefined();
    expect(screens.get("MainMenu")).not.toMatch(/presentation/);
    expect(MODAL_SCREENS.MainMenu).toBeUndefined();
  });

  it("only the screens listed in modalStack.ts are modals", () => {
    for (const [name, options] of screens) {
      const isModalInNavigator = /presentation/.test(options);
      expect([name, isModalInNavigator]).toEqual([name, MODAL_SCREENS[name] !== undefined]);
    }
  });

  it("every navigate('X') in the app is a registered screen", () => {
    const unknown: string[] = [];
    for (const file of allSourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/navigat(?:e|ion\.navigate)\(\s*"([A-Za-z]+)"/g)) {
        // Skip prose in comments.
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(\/\/|\*)/.test(text.slice(lineStart, m.index))) continue;
        if (!screens.has(m[1])) unknown.push(`${path.relative(SRC, file)}: ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("a modal screen only opens other modals (or closes itself first)", () => {
    const files: Record<string, string> = {
      VehicleDetection: "screens/VehicleDetectionScreen.tsx",
      RevCheck: "screens/RevCheckScreen.tsx",
      DocumentScan: "screens/DocumentScanScreen.tsx",
    };
    const problems: string[] = [];
    for (const [screen, rel] of Object.entries(files)) {
      const text = fs.readFileSync(path.join(SRC, rel), "utf8");
      for (const m of text.matchAll(/navigation\.navigate\(\s*"([A-Za-z]+)"/g)) {
        const target = m[1];
        const before = text.slice(Math.max(0, (m.index ?? 0) - 400), m.index);
        const closesFirst = /popToTop\(\)|goBack\(\)/.test(before);
        if (MODAL_SCREENS[target] === undefined && target !== "Map" && !closesFirst) problems.push(`${screen} -> ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
