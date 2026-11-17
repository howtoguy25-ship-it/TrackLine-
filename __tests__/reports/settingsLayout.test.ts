// Nothing was lost in the move: every Settings section is reachable from a category, and Map
// information & overlays holds Reports, Speedometer and Map shortcuts.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { CATEGORY_SECTIONS } from "@/screens/settingsCategories";

const src = readFileSync(join(__dirname, "../../src/screens/SettingsScreen.tsx"), "utf8");
const sections = [...src.matchAll(/<Section title="([^"]+)" visible=\{shouldShow\("([^"]+)"\)\}/g)].map((m) => m[2]);
const reachable = new Set(Object.values(CATEGORY_SECTIONS).flat());

describe("Settings layout", () => {
  it("every section is in a category", () => {
    expect(sections.length).toBeGreaterThan(15);
    const lost = sections.filter((s) => !reachable.has(s) && !/dev only/.test(s));
    expect(lost).toEqual([]);
  });
  it("Map information & overlays holds Reports, Speedometer and Map shortcuts (plus the map overlays)", () => {
    for (const s of ["Reports", "Speedometer", "Speed limit sign", "Map shortcuts", "Mapped road features", "Live traffic (NSW)"]) expect(CATEGORY_SECTIONS.mapInfo).toContain(s);
  });
  it("Map shortcuts has Audio player, Sound button, Show Trackys, Traffic flow and Compass", () => {
    const block = src.slice(src.indexOf('<Section title="Map shortcuts"'), src.indexOf('<Section title="Voice guidance"'));
    for (const label of ["Compass", "Audio player", "Sound button", "Show Trackys", "Traffic flow"]) expect(block).toContain(`title="${label}"`);
  });
  it("Speedometer has show, limit display with tick, thresholds and the chime", () => {
    const block = src.slice(src.indexOf('<Section title="Speedometer"'), src.indexOf('<Section title="Map shortcuts"'));
    for (const s of ["Show speedometer", "SPEED_LIMIT_DISPLAY_OPTIONS", 'openChoice("speedingThreshold")', "Speeding chime"]) expect(block).toContain(s);
  });
});
