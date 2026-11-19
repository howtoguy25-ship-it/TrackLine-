// Ending a drive (src/nav/endDrive.ts + MapScreen's exitNavigation): every end path calls the SAME
// function; that function closes every driving overlay listed in NAV_OVERLAY_RESETS, clears the
// route, saves the trip to Recents and eases the camera back to the live location in the home
// follow view (pitch 45, zoom 17) -- or waits for the first fix. Also: voice commands, the info
// banner, and the arrival card's timing.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { ARRIVAL_CARD_MS, HOME_PITCH, HOME_RESET_MS, NAV_OVERLAY_RESETS, homeCameraAfterDrive } from "@/nav/endDrive";
import { HOME_FOLLOW_ZOOM } from "@/map/homeMapLogic";
import { parseNavVoiceCommand } from "@/nav/voiceCommand";
import { infoBannerFor } from "@/nav/infoBanner";
import type { RouteEvent } from "@/travel/etaSheet";

const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
const at = src.indexOf("const exitNavigation = useCallback(");
const exitBody = src.slice(at, src.indexOf("\n  );\n", at));

describe("one end-of-drive reset", () => {
  it("there is exactly one exitNavigation, and it resets every driving overlay", () => {
    expect(src.split("const exitNavigation = useCallback(").length - 1).toBe(1);
    for (const reset of NAV_OVERLAY_RESETS) expect([reset, exitBody.includes(reset)]).toEqual([reset, true]);
  });

  it("every way a drive ends calls it, with its reason", () => {
    // Stop in the ETA sheet.
    expect(src).toMatch(/onNavOptionsEndNavigation = useCallback\(\(\) => exitNavigation\("stop"\)/);
    expect(src).toMatch(/onEndNavigation=\{onNavOptionsEndNavigation\}/);
    // Long-press on the bottom bar, after a short confirm.
    expect(src).toMatch(/onLongPressEnd=\{\(\) =>\s*Alert\.alert\("End navigation\?"[\s\S]{0,200}exitNavigation\("longPress"\)/);
    // The X on the top bar.
    expect(src).toMatch(/onExit=\{\(\) => exitNavigation\("exit"\)\}/);
    // The voice command.
    expect(src).toMatch(/if \(cmd === "stop"\) exitNavigation\("voice"\)/);
    // Arriving: the card's timer, Done, Rate drive and Park here.
    expect(src).toMatch(/setTimeout\(\(\) => exitNavigation\("arrived"\), ARRIVAL_CARD_MS\)/);
    expect((src.match(/exitNavigation\("arrived"\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Nothing else ends a drive by clearing the route behind exitNavigation's back.
    const outside = src.replace(exitBody, "");
    expect(outside.match(/setRoute\(null\)/g) ?? []).toEqual([]);
  });

  it("saves the trip to Recents and puts the camera home (or waits for a fix)", () => {
    expect(exitBody).toContain("addSearchHistoryEntry(place)");
    expect(exitBody).toContain("homeCameraAfterDrive(currentLatLngRef.current");
    expect(exitBody).toContain("HOME_RESET_MS");
    expect(exitBody).toContain("homeSnapPendingRef.current = true");
    expect(src).toMatch(/if \(!homeSnapPendingRef\.current \|\| !currentLatLng \|\| route\) return;/);
  });

  it("home camera: live location, pitch 45, zoom 17, heading-up or north-up, over 1.2 s", () => {
    const here = { latitude: -33.9, longitude: 151.05 };
    expect(homeCameraAfterDrive(here, 75, false)).toEqual({ center: here, heading: 75, pitch: 45, zoom: HOME_FOLLOW_ZOOM });
    expect(homeCameraAfterDrive(here, 75, true)!.heading).toBe(0);
    expect(homeCameraAfterDrive(null, 75, false)).toBeNull();
    expect(HOME_PITCH).toBe(45);
    expect(HOME_FOLLOW_ZOOM).toBe(17);
    expect(HOME_RESET_MS).toBe(1200);
    expect(ARRIVAL_CARD_MS).toBe(5000);
  });

  it("driving overlays are mounted only while driving (nothing left over the home map to block touches)", () => {
    for (const re of [
      /\{route && searchAlongOpen && \(\n\s*<SearchAlongRouteSheet/,
      /\{route && arrival && \(\n\s*<ArrivedCard/,
      /\{route && navAlternatives && navAlternatives\.length > 0 && \(/,
      /\{route && !addingStopDuringNav && !stopPreviewRoute && !searchAlongOpen && \(\n\s*<NavMapControls/,
      /\{route \? \(\n\s*<MapSurface>\n\s*<AvoidSheet visible=\{navAvoidOpen\}/,
    ]) {
      expect(src).toMatch(re);
    }
  });
});

describe("voice commands while driving", () => {
  it.each([
    ["stop navigation", "stop"],
    ["End the route", "stop"],
    ["cancel directions", "stop"],
    ["stop", "stop"],
    ["report", "report"],
    ["there's a crash", "report"],
    ["mute", "mute"],
    ["sound off", "mute"],
    ["unmute", "unmute"],
    ["show other routes", "routes"],
    ["find petrol", "search"],
  ] as [string, string][])("%s -> %s", (text, cmd) => {
    expect(parseNavVoiceCommand(text)).toBe(cmd);
  });
  it("anything else is not a command (no guessing)", () => {
    expect(parseNavVoiceCommand("what a nice day")).toBeNull();
    expect(parseNavVoiceCommand("")).toBeNull();
  });
});

describe("info banner above the bottom bar", () => {
  const ev = (id: string, kind: RouteEvent["kind"], label: string, alongMeters: number): RouteEvent => ({ id, kind, label, lat: 0, lng: 0, alongMeters, fraction: 0 });
  it("the nearest real thing ahead, in our words, with its distance", () => {
    expect(infoBannerFor([ev("a", "report", "Hazard", 2400), ev("b", "report", "Police", 800)], "km")?.text).toBe("Police reported ahead · 800 m");
    expect(infoBannerFor([ev("c", "incident", "Road closed", 1200)], "km")?.text).toBe("Road closed ahead · 1.2 km");
  });
  it("nothing when there's nothing within 5 km", () => {
    expect(infoBannerFor([], "km")).toBeNull();
    expect(infoBannerFor([ev("d", "report", "Hazard", 9000)], "km")).toBeNull();
  });
});
