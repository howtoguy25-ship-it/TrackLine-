// Travel modes steps 4-6 on REAL recorded Google transit responses (fixtures/travel, recorded
// 2026-11-16): the transit timeline, fare / Opal note, live/late wording, ferry details, the
// "Get off" prompt, per-mode navigation rules, and the trip-details sheet.
import React from "react";
import fs from "fs";
import path from "path";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { parseRoute, type Route } from "@/services/directions";
import { fareLine, liveStatusText, timelineFor } from "@/travel/transitTimeline";
import { bookingLink, ferryDetailsFor } from "@/travel/ferryDetails";
import { rideStatus } from "@/travel/rideProgress";
import { compassAllowed } from "@/nav/headingFilter";
import { collectApproachFeatures } from "@/alerts/collectFeatures";
import { DEFAULT_SETTINGS } from "@/services/settings";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { TripDetailsSheet } from "@/components/TripDetailsSheet";

const dir = path.join(__dirname, "../fixtures/travel");
const load = (f: string): Route[] => (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).routes as unknown[]).map(parseRoute);
const manly = load("circular-quay-manly-transit.json");
const bankstown = load("bankstown-parramatta-transit.json");

describe("transit timeline (step 4)", () => {
  it("Circular Quay -> Manly: walk, the Manly ferry with its wharves, times and stops", () => {
    const t = timelineFor(manly[0]);
    const ride = t.find((e) => e.kind === "ride");
    expect(ride && ride.kind === "ride" && ride.from).toMatch(/Circular Quay/);
    expect(ride && ride.kind === "ride" && ride.to).toMatch(/Manly/);
    expect(ride && ride.kind === "ride" && ride.title).toMatch(/^Ferry /);
    expect(ride && ride.kind === "ride" && ride.times).toMatch(/–/);
    expect(ride && ride.kind === "ride" && ride.status).toBe("Timetable");
  });
  it("Bankstown -> Parramatta: rides in order, no ferry, walks between", () => {
    const t = timelineFor(bankstown[0]);
    expect(t.filter((e) => e.kind === "ride").length).toBe(bankstown[0].transitSummary!.legs.length);
    expect(t.some((e) => e.kind === "ride" && /Ferry/.test(e.title))).toBe(false);
    expect(ferryDetailsFor([bankstown[0]])).toBeNull();
  });
  it("live / late: only what the provider says", () => {
    expect(liveStatusText(null).text).toBe("Timetable");
    expect(liveStatusText({ live: false, delayMinutes: null }).text).toBe("Timetable");
    expect(liveStatusText({ live: true, delayMinutes: 0 }).text).toBe("Live · on time");
    expect(liveStatusText({ live: true, delayMinutes: 4 })).toEqual({ text: "Live · 4 min late", late: true });
    expect(liveStatusText({ live: true, delayMinutes: -1 }).text).toBe("Live · 1 min early");
    const t = timelineFor(manly[0], [{ live: true, delayMinutes: 3 }]);
    expect(t.find((e) => e.kind === "ride")).toMatchObject({ status: "Live · 3 min late", late: true });
  });
  it("fare: Google gives none for these Sydney trips, so none is shown -- the Opal note is", () => {
    expect(manly[0].transitSummary!.fare).toBeUndefined();
    expect(fareLine(manly[0], true)).toMatch(/Opal/);
    expect(fareLine(manly[0], true)).not.toMatch(/\$/);
    expect(fareLine({ ...manly[0], transitSummary: { ...manly[0].transitSummary!, fare: { text: "$7.35", currency: "AUD", value: 7.35 } } }, true)).toBe("Fare: $7.35");
  });
});

describe("ferry details (step 6)", () => {
  it("wharves, every departure across the options, crossing time, passengers only, the operator's link", () => {
    const f = ferryDetailsFor(manly)!;
    expect(f.fromWharf).toMatch(/Circular Quay/);
    expect(f.toWharf).toMatch(/Manly/);
    expect(f.departures.length).toBeGreaterThan(1);
    expect(f.crossingMinutes).toBeGreaterThan(10);
    expect(f.crossingMinutes).toBeLessThan(40);
    expect(f.carsAllowed).toBe(false);
    expect(bookingLink(f.bookingUrl)).toMatch(/^https:\/\//);
  });
  it("links are https only", () => {
    expect(bookingLink("//transportnsw.info/")).toBe("https://transportnsw.info/");
    expect(bookingLink("http://x.com")).toBe("https://x.com");
    expect(bookingLink("javascript:alert(1)")).toBeNull();
  });
});

describe("per-mode navigation (step 5)", () => {
  const leg = manly[0].transitSummary!.legs.find((l) => l.vehicleType === "FERRY")!;
  it("transit: 'Get off at the next stop' near the wharf, with one buzz; 'Get off in 2 stops' from the stop sequence", () => {
    const mid = { latitude: (leg.departureLocation.latitude + leg.arrivalLocation.latitude) / 2, longitude: (leg.departureLocation.longitude + leg.arrivalLocation.longitude) / 2 };
    const ride = { arrivalStop: leg.arrivalStop, arrivalLocation: leg.arrivalLocation, arrivalTimeMs: leg.arrivalTimeMs };
    expect(rideStatus(ride, mid, (leg.departureTimeMs ?? 0) + 60_000, false)).toMatchObject({ vibrate: false, text: expect.stringMatching(/^Get off at /) });
    const near = { latitude: leg.arrivalLocation.latitude + 0.004, longitude: leg.arrivalLocation.longitude };
    expect(rideStatus(ride, near, 0, false)).toMatchObject({ vibrate: true, text: expect.stringMatching(/next stop/) });
    expect(rideStatus(ride, near, 0, true).vibrate).toBe(false);
    const stops = [
      { name: "A", latitude: -33.84, longitude: 151.24 },
      { name: "B", latitude: -33.82, longitude: 151.26 },
      { name: leg.arrivalStop, ...leg.arrivalLocation },
    ];
    expect(rideStatus({ ...ride, arrivalTimeMs: undefined, stopsAhead: stops }, { latitude: -33.85, longitude: 151.23 }, 0, false).text).toBe(`Get off in 3 stops, at ${leg.arrivalStop}`);
  });
  it("walk: compass-up (the compass steers while walking)", () => {
    expect(compassAllowed({ compassTrusted: true, hasMoved: true } as never, { speedKmh: 5, walking: true })).toBe(true);
    expect(compassAllowed({ compassTrusted: true, hasMoved: true } as never, { speedKmh: 40, walking: false })).toBe(false);
  });
  it("bike / walk / transit: no camera alerts (MapScreen runs approach alerts only when driving)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/screens/MapScreen.tsx"), "utf8");
    expect(src).toMatch(/if \(route \|\| !currentLatLng \|\| travelMode !== "driving" \|\| approachFeatures\.length === 0\) return;/);
    // Navigating: the ahead alerts are for driving only too.
    expect(src).toMatch(/if \(!route \|\| travelMode !== "driving"\) return \[\];/);
    // and the features exist for drivers
    expect(collectApproachFeatures(DEFAULT_SETTINGS, { osm: { trafficLights: [], speedCameras: [{ id: 1, lat: 0, lng: 0 }], features: {} }, alerts: [], incidents: [] })).toHaveLength(1);
  });
});

describe("trip details sheet", () => {
  it("shows the timeline, the Opal note and the ferry with a working tickets link", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    await render(<TripDetailsSheet visible route={manly[0]} alternatives={manly} realtime={[]} realtimeNote="Times are the timetable" inNsw onClose={() => {}} />);
    expect(screen.getAllByTestId("timeline-ride").length).toBeGreaterThan(0);
    expect(screen.getByTestId("trip-fare").props.children).toMatch(/Opal/);
    expect(screen.getByTestId("ferry-details")).toBeTruthy();
    expect(screen.getByText("Times are the timetable")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ferry-booking"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\//));
  });
  it("no ferry block for a train/bus trip", async () => {
    await render(<TripDetailsSheet visible route={bankstown[0]} alternatives={bankstown} realtime={[]} realtimeNote={null} inNsw onClose={() => {}} />);
    expect(screen.queryByTestId("ferry-details")).toBeNull();
  });
});
