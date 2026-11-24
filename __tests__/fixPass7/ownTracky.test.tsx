// Fix pass 7 §4: your own Tracky is never drawn. Root cause of "it's still there in every
// screenshot": MapboxLayers drew a spooky Tracky (GhostBadge) beside the arrow whenever you were
// in ghost mode -- and ghost is the DEFAULT visibility (services/settings.ts), so every new driver
// saw it. Presence data never drew you (presencesToShow drops your uid). This renders the home
// map and the driving map with presence data that contains your own uid, ghost mode on, and checks
// that no Tracky is drawn for you: no Tracky component at all, no presence feature or icon for
// your uid.
import React from "react";
import { readFileSync } from "fs";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";

const mockTrackys: Record<string, unknown>[] = [];
const mockPresenceUids: string[][] = [];
const mockIconNames: string[][] = [];

jest.mock("@/components/trackys/Tracky", () => ({
  Tracky: (p: Record<string, unknown>) => {
    mockTrackys.push(p);
    return null;
  },
}));
jest.mock("@/map-v2/layers/PresenceLayerV2", () => ({
  PresenceLayerV2: (p: { presences: { uid: string }[] }) => {
    mockPresenceUids.push(p.presences.map((x) => x.uid));
    return null;
  },
  presenceIconName: (p: { uid: string }) => `tracky:${p.uid}`,
}));
jest.mock("@/map-v2/layers/MapIcons", () => ({
  MapIcons: (p: { names: string[] }) => {
    mockIconNames.push([...p.names]);
    return null;
  },
}));
jest.mock("@/map-v2/mapbox", () => {
  const React = require("react");
  const Generic = (p: { children?: unknown }) => React.createElement(React.Fragment, null, p.children ?? null);
  const proxy = new Proxy({}, { get: () => Generic });
  return { loadMapbox: () => proxy };
});

import { MapboxLayers } from "@/map-v2/MapboxLayers";
import { presencesToShow } from "@/map/presenceFilter";
import type { PresenceDoc } from "@/services/presence";
import { DEFAULT_SETTINGS } from "@/services/settings";

const here = { latitude: -33.9, longitude: 151 };
const north = (m: number) => ({ lat: -33.9 + m / 111_195, lng: 151 });
const doc = (uid: string, m: number) => ({ uid, ...north(m), updatedAt: Date.now(), look: { mood: "chill" } }) as unknown as PresenceDoc;
// The server's list includes the driver's own entry (and an older guest uid from this phone).
const serverList = [doc("me", 0), doc("me-old-guest", 150), doc("neighbour", 400)];

function layers(navigating: boolean) {
  const presences = presencesToShow(serverList as never, { ownUid: "me", ownUids: new Set(["me-old-guest"]), blocked: new Set(), here, me: here, max: 50 }) as PresenceDoc[];
  const route = [here, { latitude: -33.89, longitude: 151 }, { latitude: -33.89, longitude: 151.01 }];
  const props = {
        navRoute: navigating ? route : null,
        remaining: navigating ? route : [],
        turnCallouts: navigating ? [{ key: "t", coordinate: route[1], text: "Vanessa St", side: "left" }] : [],
        nextTurn: navigating ? route[1] : null,
        stopPreview: null,
        trafficSuggestion: null,
        user: { coordinate: here, heading: 0, accuracyMeters: 8, deviceHeading: null, navigating, markerStyle: "default", ghost: true, fixTimeMs: 1 },
        presences,
        presenceCellSize: 0.002,
        onSelectPresence: () => {},
        onPresenceCluster: () => {},
        selection: null,
        arrival: null,
        pins: [],
        onPinPress: () => {},
        selectedComment: null,
  } as unknown as React.ComponentProps<typeof MapboxLayers>;
  return <MapboxLayers {...props} />;
}

describe("own Tracky never drawn (home and navigation, ghost mode on)", () => {
  it("ghost is the default visibility -- the case that showed it to every new driver", () => {
    expect(DEFAULT_SETTINGS.visibility).toBe("ghost");
  });

  it.each([
    ["home", false],
    ["navigation", true],
  ])("%s: no Tracky at all, no presence or icon for your uids", async (_name, navigating) => {
    mockTrackys.length = 0;
    mockPresenceUids.length = 0;
    mockIconNames.length = 0;
    const r = await render(layers(navigating as boolean));
    await act(async () => {});
    expect(mockTrackys).toEqual([]); // no spooky ghost badge, no Tracky drawn by the layers themselves
    const uids = mockPresenceUids.flat();
    expect(uids).toContain("neighbour"); // other drivers still show
    expect(uids).not.toContain("me");
    expect(uids).not.toContain("me-old-guest");
    const icons = mockIconNames.flat();
    expect(icons.filter((n) => /^tracky:me/.test(n) || /ghost/.test(n))).toEqual([]);
    await r.unmount();
  });

  it("nothing in the map layers can draw one for you again", () => {
    const src = readFileSync("src/map-v2/MapboxLayers.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/GhostBadge|<Tracky\b/);
    expect(readFileSync("src/map-v2/layers/MapIcons.tsx", "utf8")).not.toMatch(/"ghost-badge"/);
  });
});
