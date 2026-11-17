// Section 8 (text and consistency): nothing on screen says "--" (use "—", or rewrite), and no
// screen shows an internal route name (MainMenu, SettingsCategories ...).
import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "fs";
import path from "path";
import { uiStrings } from "../support/uiStrings";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !n.endsWith(".d.ts") ? [p] : [];
  });
}

// Strings that are data, not wording: URLs, CSS/HTML, regexes, CLI-ish flags, log keys.
const NOT_WORDING = /^(https?:|data:|<|\s*[.#]?[a-z-]+\s*\{|--[a-z])|\b(stroke-dash|--watch|--)\s*$/;
// Files whose strings are never shown (logs, network, map style JSON).
const SKIP = [/src[\\/]services[\\/]sentry/, /mapStyle/, /styleJson/i];

const ROUTE_NAMES = ["MainMenu", "SettingsCategories", "SettingsChoice", "PlanADrive", "VehicleDetection", "ReportItemSettings", "PhoneSignIn"];

describe("wording", () => {
  const all = files("src").filter((f) => !SKIP.some((r) => r.test(f))).flatMap(uiStrings);

  it('no "--" in anything shown on screen', () => {
    const bad = all.filter((s) => s.text.includes("--") && !NOT_WORDING.test(s.text.trim())).map((s) => `${s.file}:${s.line} ${JSON.stringify(s.text.slice(0, 80))}`);
    expect(bad).toEqual([]);
  });

  it("no internal route name in JSX text", () => {
    const jsx = files("src")
      .filter((f) => f.endsWith(".tsx"))
      .flatMap(uiStrings)
      .filter((s) => ROUTE_NAMES.some((r) => new RegExp(`(^|\\s)${r}(\\s|$|[.,!?])`).test(s.text)) && /\s/.test(s.text.trim()));
    expect(jsx.map((s) => `${s.file}:${s.line} ${s.text.slice(0, 60)}`)).toEqual([]);
  });
});

describe("times", () => {
  const { formatArrivalClock } = require("@/utils/navFormat") as typeof import("@/utils/navFormat");
  const t = new Date(2026, 10, 17, 22, 7).getTime();
  it('12-hour phones see "10:07 pm"; 24-hour phones "22:07"', () => {
    expect(formatArrivalClock(t, false)).toBe("10:07 pm");
    expect(formatArrivalClock(t, true)).toBe("22:07");
    expect(formatArrivalClock(new Date(2026, 10, 17, 0, 5).getTime(), false)).toBe("12:05 am");
  });
});
