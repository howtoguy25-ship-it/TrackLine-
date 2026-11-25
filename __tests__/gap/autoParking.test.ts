// Gap item 11: remembering where you parked (automatic, from what the phone saw) and "Find my car"
// as a walking route. Rules in nav/autoParking.ts; MapScreen wiring checked from its source.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { onDriveEnd, onFixAfterDrive, MIN_DRIVE_M, WATCH_MS } from "@/nav/autoParking";
import { DEFAULT_SETTINGS } from "@/services/settings";

const car = { latitude: -33.87, longitude: 151.2 };
const metresNorth = (m: number) => ({ latitude: car.latitude + m / 111_320, longitude: car.longitude });
const home = { latitude: -33.9, longitude: 151.25 };

describe("auto parking", () => {
  it("arrived: saved at once where the drive ended, with the destination as its label", () => {
    expect(onDriveEnd({ reason: "arrived", at: car, label: "12 King St", drivenM: 300, endedAt: 0, home })).toEqual({ save: { ...car, label: "12 King St" }, watch: null });
  });

  it("never at Home", () => {
    expect(onDriveEnd({ reason: "arrived", at: { latitude: home.latitude + 0.0005, longitude: home.longitude }, label: "Home", drivenM: 5000, endedAt: 0, home })).toEqual({ save: null, watch: null });
  });

  it("ended early: only after a real drive, and only once you walk away", () => {
    expect(onDriveEnd({ reason: "exit", at: car, label: "x", drivenM: MIN_DRIVE_M - 1, endedAt: 0, home: null })).toEqual({ save: null, watch: null });
    const { watch, save } = onDriveEnd({ reason: "exit", at: car, label: "Where you parked", drivenM: 4000, endedAt: 0, home: null });
    expect(save).toBeNull();
    expect(onFixAfterDrive(watch!, { ...metresNorth(10), speedKmh: 4, at: 60_000 })).toBeNull();
    expect(onFixAfterDrive(watch!, { ...metresNorth(60), speedKmh: 5, at: 120_000 })).toBe("save");
  });

  it("driving off again, or nothing for 15 minutes: no spot saved", () => {
    const { watch } = onDriveEnd({ reason: "exit", at: car, label: "x", drivenM: 4000, endedAt: 0, home: null });
    expect(onFixAfterDrive(watch!, { ...metresNorth(200), speedKmh: 45, at: 30_000 })).toBe("cancel");
    expect(onFixAfterDrive(watch!, { ...metresNorth(60), speedKmh: 4, at: WATCH_MS + 1 })).toBe("cancel");
  });

  it("no position when the drive ended: nothing saved (never guessed)", () => {
    expect(onDriveEnd({ reason: "arrived", at: null, label: "x", drivenM: 5000, endedAt: 0, home: null })).toEqual({ save: null, watch: null });
  });

  it("the setting is on by default and switches it off; the screen uses it", () => {
    expect(DEFAULT_SETTINGS.autoParking).toBe(true);
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/if \(autoParkingOnRef\.current && travelModeRef\.current === "driving"\) \{/);
    expect(src).toMatch(/if \(decision\.save\) saveAutoParking\(decision\.save\);/);
    expect(src).toMatch(/if \(verdict === "save"\) saveAutoParking\(/);
    expect(readFileSync("src/screens/SettingsScreen.tsx", "utf8")).toMatch(/testID: "auto-parking-switch"/);
  });

  it("Find my car walks there, without making Walk the mode for the next drive; Park here uses the same spot", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/requestRoutes\(routeOriginLatLng, place\.location, undefined, travelModesOn \? "walk" : "drive", undefined, false\)/);
    expect(src).toMatch(/if \(rememberMode && settings\.lastTravelMode !== mode\) updateSettings/);
    expect(src).toMatch(/findMyCar\(parkingSpot\)/);
    expect(src).not.toMatch(/name: "Parked car"/);
  });
});
