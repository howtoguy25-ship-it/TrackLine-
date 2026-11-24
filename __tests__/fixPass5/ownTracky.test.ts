// Fix pass 5 §3: your own Tracky is never drawn -- home, route preview, navigation -- and your own
// position never counts as "another driver" anywhere else either.
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";
import { othersOnly, presencesToShow } from "@/map/presenceFilter";
import { overlaysFor } from "@/map/previewOverlays";

const here = { latitude: -33.9, longitude: 151.05 };
const p = (uid: string, dLat: number) => ({ uid, id: uid, lat: here.latitude + dLat, lng: here.longitude });
const list = [p("me", 0.002), p("old-guest-me", 0.003), p("friend", 0.004), p("stranger", 0.006)];
const own = { ownUid: "me", ownUids: new Set(["old-guest-me"]), blocked: new Set<string>(), here, me: here, max: 50 };

describe("own Tracky never drawn", () => {
  const shown = presencesToShow(list, own);
  it("home: everyone but you (current and earlier ids)", () => {
    const o = overlaysFor("home", { pins: [], presences: shown, badges: true });
    expect(o.presences.map((x) => x.uid)).toEqual(["friend", "stranger"]);
  });
  it("route preview: no Trackys at all", () => {
    expect(overlaysFor("routePreview", { pins: [], presences: shown, badges: true }).presences).toEqual([]);
  });
  it("navigation (normal and the close-up at a turn): never you", () => {
    for (const mode of ["home", "approach"] as const) {
      const o = overlaysFor(mode, { pins: [], presences: shown, badges: true });
      expect(o.presences.some((x) => x.uid === "me" || x.uid === "old-guest-me")).toBe(false);
    }
  });
  it("before we know who you are, nobody is drawn (you can't be told apart)", () => {
    expect(presencesToShow(list, { ...own, ownUid: null })).toEqual([]);
  });
  it("'Trackys slowing down ahead' only reads other drivers", () => {
    expect(othersOnly(list, "me", own.ownUids).map((x) => x.uid)).toEqual(["friend", "stranger"]);
    const map = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(map).toMatch(/trackySlowdownAhead\(othersOnly\(presenceList,/);
    // and the one drawn list is the filtered one, in every state
    expect(map).toMatch(/overlaysFor\([^)]*presences: visiblePresences/);
  });
});
