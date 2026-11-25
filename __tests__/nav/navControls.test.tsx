// Nav fix §5: no two driving controls overlap on any phone width; the bottom bar's three buttons
// work; Search along route opens, can be closed, and leaves nothing behind; it never hangs (it
// says why on failure); Routes shows alternatives with time differences; ending navigation
// resets everything.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { crowded, navControlFrames, overlaps } from "@/nav/navControlsLayout";
import { altDeltaLabel, pickAlternatives } from "@/nav/navAlternatives";
import { detourFrom, detourText, encodePolyline, sortByDetour, type AlongResult } from "@/places/alongRoute";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockSearch = jest.fn<(...a: unknown[]) => Promise<AlongResult[]>>();
jest.mock("@/places/alongRoute", () => ({ ...(jest.requireActual("@/places/alongRoute") as object), searchAlongRoute: (...a: unknown[]) => mockSearch(...a) }));

import { SearchAlongRouteSheet } from "@/components/SearchAlongRouteSheet";
import { NavBottomBar } from "@/components/NavBottomBar";

const PHONES = [
  { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
  { width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { width: 430, height: 932, safeTop: 59, safeBottom: 34 },
];

describe("driving controls never overlap", () => {
  it.each(PHONES.map((p) => [p.width, p] as const))("%ipt wide, with and without the limit sign and re-centre", (_w, p) => {
    for (const showSpeedLimit of [true, false]) {
      for (const showRecenter of [true, false]) {
        for (const extras of [false, true]) {
          // Every control the driving screen can show: compass top-left, audio player + sound +
          // voice top-right, street chip and info banner between the bottom columns.
          const frames = navControlFrames({
            ...p,
            bottomBarHeight: 110,
            topBarHeight: 120,
            showSpeedLimit,
            showRecenter,
            showCompass: true,
            showAudioPlayer: extras,
            showSound: true,
            showVoice: true,
            showStreetChip: extras,
            showInfoBanner: true,
          });
          expect(overlaps(frames)).toEqual([]);
          // 12pt between every pair of floating controls, not just "not touching".
          expect(crowded(frames)).toEqual([]);
          // Nothing off screen.
          for (const [k, f] of Object.entries(frames)) {
            expect([k, f!.x >= 0 && f!.y >= 0 && f!.x + f!.width <= p.width && f!.y + f!.height <= p.height]).toEqual([k, true]);
          }
          // Every requested control got a place.
          for (const k of ["compass", "sound", "voice", "infoBanner", ...(extras ? ["audioPlayer", "streetChip"] : [])]) expect([k, !!frames[k as keyof typeof frames]]).toEqual([k, true]);
          // The info banner has room for "Hazard ahead · 800 m" even on a 320pt phone.
          expect(frames.infoBanner!.width).toBeGreaterThanOrEqual(110);
        }
      }
    }
  });

  it("the components use the shared layout (re-centre pill from the layout, 12pt column gap)", () => {
    expect(readFileSync("src/components/NavBottomBar.tsx", "utf8")).not.toMatch(/recenter|onRecenter/i);
    expect(readFileSync("src/components/NavMapControls.tsx", "utf8")).toMatch(/f\.recenter/);
    expect(readFileSync("src/components/LiveSpeedometer.tsx", "utf8")).toMatch(/SIGN_GAP = CONTROL_GAP/);
    expect(readFileSync("src/screens/MapScreen.tsx", "utf8")).toMatch(/controlsBottom\(insets\.bottom, bottomBarHeight\)/);
  });
});

describe("bottom bar", () => {
  const props = () => ({
    etaText: "17 min",
    arrivalClockText: "10:54 pm",
    distanceRemainingText: "16 km",
    roadName: null,
    themeKey: "dark" as const,
    hasStop: false,
    onAddStop: jest.fn(),
    onRemoveStop: jest.fn(),
    onOptions: jest.fn(),
    onOverview: jest.fn(),
    onLongPressEnd: jest.fn(),
  });
  it("Search, the arrival time (ETA sheet), Routes and long-press End all work", async () => {
    const p = props();
    await render(<NavBottomBar {...p} />);
    expect(screen.getByText("10:54 pm")).toBeTruthy();
    expect(screen.getByText("17 min • 16 km")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("nav-search"));
    await fireEvent.press(screen.getByTestId("nav-eta"));
    await fireEvent.press(screen.getByTestId("nav-routes"));
    await fireEvent(screen.getByTestId("nav-eta"), "longPress");
    for (const fn of [p.onAddStop, p.onOptions, p.onOverview, p.onLongPressEnd]) expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("search along route", () => {
  const ROUTE = [
    { latitude: -33.9187, longitude: 151.0349 },
    { latitude: -33.9064, longitude: 151.0857 },
  ];
  const place = (id: string, detourSeconds: number | null): AlongResult => ({
    placeId: id, name: `Place ${id}`, address: "Stacey St", suburb: null, location: ROUTE[0], distanceMeters: 500,
    rating: null, ratingCount: null, priceLevel: null, openNow: null, photoName: null, googleFuel: {}, detourSeconds,
  });

  it("detour = both legs minus the drive you'd do anyway; sorted by it; '+3 min'", () => {
    expect(detourFrom({ legs: [{ duration: "300s" }, { duration: "720s" }] }, 840)).toBe(180);
    expect(detourText(180)).toBe("+3 min");
    expect(detourText(20)).toBe("On your way");
    expect(sortByDetour([place("b", 300), place("c", null), place("a", 60)]).map((r) => r.placeId)).toEqual(["a", "b", "c"]);
    expect(encodePolyline([{ latitude: 38.5, longitude: -120.2 }, { latitude: 40.7, longitude: -120.95 }, { latitude: 43.252, longitude: -126.453 }])).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("opens with results and Add stop; closing returns to navigation and leaves nothing mounted", async () => {
    mockSearch.mockResolvedValue([place("p1", 180)]);
    const onClose = jest.fn();
    const onAddStop = jest.fn();
    const onGo = jest.fn();
    const r = await render(<SearchAlongRouteSheet route={ROUTE} origin={ROUTE[0]} remainingSeconds={900} unit="km" onClose={onClose} onAddStop={onAddStop} onGo={onGo} />);
    await waitFor(() => expect(screen.getByText("+3 min")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("search-along-add-p1"));
    expect(onAddStop).toHaveBeenCalledWith(expect.objectContaining({ placeId: "p1" }));
    await fireEvent.press(screen.getByTestId("search-along-go-p1"));
    expect(onGo).toHaveBeenCalledWith(expect.objectContaining({ placeId: "p1" }));
    // Every category has a tile, Toilets included, and each asks Places for its own type.
    for (const c of ["fuel", "food", "coffee", "parking", "ev", "toilets"]) expect(screen.getByTestId(`search-along-${c}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("search-along-toilets"));
    await waitFor(() => expect(mockSearch).toHaveBeenLastCalledWith(expect.objectContaining({ query: "public toilet", type: "public_bathroom" })));
    await fireEvent.press(screen.getByTestId("search-along-close"));
    expect(onClose).toHaveBeenCalled();
    r.unmount();
    // MapScreen mounts it only while open, and hides the bar only while it's open.
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/\{route && searchAlongOpen && \(\n\s*<SearchAlongRouteSheet/);
    expect(src).toMatch(/route && !addingStopDuringNav && !stopPreviewRoute && !searchAlongOpen && \(\n\s*<NavBottomBar/);
  });

  it("a failed search says why and retries; it never hangs", async () => {
    mockSearch.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValue([]);
    await render(<SearchAlongRouteSheet route={ROUTE} origin={ROUTE[0]} remainingSeconds={900} unit="km" onClose={jest.fn()} onAddStop={jest.fn()} onGo={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId("search-along-error")).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId("search-along-error")));
    await waitFor(() => expect(screen.getByText("Nothing found along your route. Try another search.")).toBeTruthy());
    expect(readFileSync("src/places/alongRoute.ts", "utf8")).toMatch(/netFetch\("places"/);
  });
});

describe("routes and ending navigation", () => {
  it("alternatives show the time difference and skip ones that are really the same route", () => {
    expect(altDeltaLabel(1200, 1080)).toBe("+2 min");
    expect(altDeltaLabel(960, 1080)).toBe("−2 min");
    expect(altDeltaLabel(1090, 1080)).toBe("Same time");
    const same = { polyline: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }] };
    const other = { polyline: [{ latitude: 0.05, longitude: 0 }, { latitude: 0.05, longitude: 0.01 }] };
    expect(pickAlternatives([same, other], same.polyline)).toEqual([other]);
  });

  it("ending navigation closes the sheets, search and alternatives and puts the camera back home", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    const at = src.indexOf("const exitNavigation = useCallback");
    const body = src.slice(at, src.indexOf("\n  );\n", at));
    for (const s of ["navOptionsSheetRef.current?.close()", "setSearchAlongOpen(false)", "setNavAlternatives(null)", "stopNavSpeech()", "homeCameraAfterDrive("]) expect(body).toContain(s);
  });
});
