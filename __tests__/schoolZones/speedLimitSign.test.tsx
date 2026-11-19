// Which limit the sign shows (priority, never a guess), how it looks where you are (ring vs
// rectangle, km/h vs mph), the school-zone badge, and the "School zone, 40" call-out firing once on
// entering and the zone switching on/off at the exact minute -- driven through the same
// trackSchoolZone MapScreen uses, along the real Unwins Bridge Road zone.
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import tile from "../fixtures/schoolZones/nsw-tile-newtown.json";
import drive from "../fixtures/schoolZones/drive-through-zone.json";
import nsw from "@/data/schoolCalendars/AU-NSW.json";
import { asSchoolCalendar } from "@/schoolZones/calendar";
import { toShape, type StoredZone } from "@/schoolZones/zoneMatch";
import { INITIAL_SCHOOL_ZONE_TRACKER, trackSchoolZone } from "@/schoolZones/schoolZoneTracker";
import { isSpeeding, resolveSpeedLimit, routeLimitAt, signStyleFor, signUnitFor, signValue } from "@/speedLimits/resolveLimit";
import { SpeedLimitSign } from "@/components/SpeedLimitSign";
import { planPhrase } from "@/services/navSpeechPlan";
import { parseMapboxResponse } from "@/services/mapboxDirections";
import { driveTrack } from "@/dev/simulateDrive";
import type { LatLng } from "@/utils/polyline";

const cal = asSchoolCalendar(nsw)!;
const shapes = (tile.zones as StoredZone[]).map(toShape);
const road = parseMapboxResponse(drive)[0];

describe("which limit the sign shows", () => {
  const school = { active: true, kmh: 40, display: { value: 40, unit: "km/h" as const }, untilLabel: "until 9:30 am", name: "Tempe High School" };
  it("an active school zone beats every other source", () => {
    expect(resolveSpeedLimit({ schoolZone: school, official: 60, route: 60, osm: { kmh: 60, estimated: false } })).toEqual({
      kmh: 40,
      source: "schoolZone",
      schoolZone: { untilLabel: "until 9:30 am", name: "Tempe High School" },
    });
  });
  it("an inactive zone falls through: official > route (Mapbox) > OSM posted", () => {
    const off = { ...school, active: false };
    expect(resolveSpeedLimit({ schoolZone: off, official: 50, route: 60, osm: { kmh: 70, estimated: false } })?.source).toBe("official");
    expect(resolveSpeedLimit({ schoolZone: off, route: 60, osm: { kmh: 70, estimated: false } })).toEqual({ kmh: 60, source: "route", schoolZone: null });
    expect(resolveSpeedLimit({ route: null, osm: { kmh: 70, estimated: false } })?.source).toBe("osm");
  });
  it("a road-type default is a guess: the sign is hidden, not guessed", () => {
    expect(resolveSpeedLimit({ osm: { kmh: 50, estimated: true } })).toBeNull();
    expect(resolveSpeedLimit({})).toBeNull();
  });
  it("the route's limit is the one at the segment the car is matched to", () => {
    const line: LatLng[] = [
      { latitude: -33.9, longitude: 151.15 },
      { latitude: -33.899, longitude: 151.15 }, // ~111 m
      { latitude: -33.898, longitude: 151.15 },
    ];
    expect(routeLimitAt(line, [60, 40], 50)).toBe(60);
    expect(routeLimitAt(line, [60, 40], 150)).toBe(40);
    expect(routeLimitAt(line, [60, null], 150)).toBeNull();
    expect(routeLimitAt(line, undefined, 50)).toBeNull();
  });
  it("speeding uses the user's threshold, school-zone limits included", () => {
    expect(isSpeeding(42, 40, 3)).toBe(false);
    expect(isSpeeding(43, 40, 3)).toBe(true);
    expect(isSpeeding(41, 40, 1)).toBe(true);
    expect(isSpeeding(90, null, 3)).toBe(false);
  });
});

describe("the sign looks like the local one", () => {
  it("red ring in Australia/Europe, white rectangle in the US and Canada", () => {
    expect(signStyleFor("AU")).toBe("ring");
    expect(signStyleFor("DE")).toBe("ring");
    expect(signStyleFor("GB")).toBe("ring");
    expect(signStyleFor("US")).toBe("rectangle");
    expect(signStyleFor("ca")).toBe("rectangle");
    expect(signStyleFor(null)).toBe("ring");
  });
  it("km/h or mph: the country's own unless chosen in Settings; mph signs are multiples of 5", () => {
    expect(signUnitFor("AU")).toBe("km/h");
    expect(signUnitFor("US")).toBe("mph");
    expect(signUnitFor("GB")).toBe("mph");
    expect(signUnitFor("US", "km")).toBe("km/h");
    expect(signValue(40.2336, "mph")).toBe(25); // a US 25 mph school zone
    expect(signValue(32.18688, "mph")).toBe(20);
    expect(signValue(40, "km/h")).toBe(40);
  });
  it("renders a ring, a rectangle, and the school badge with when it ends", async () => {
    await render(<SpeedLimitSign kmh={40} schoolZone={{ untilLabel: "until 9:30 am" }} />);
    expect(screen.getByTestId("speed-limit-ring")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.getByTestId("school-zone-badge")).toBeTruthy();
    expect(screen.getByText("until 9:30 am")).toBeTruthy();
    expect(screen.getByLabelText("School zone, speed limit 40 kilometres per hour, until 9:30 am")).toBeTruthy();

    await render(<SpeedLimitSign kmh={40.2336} unit="mph" signStyle="rectangle" />);
    expect(screen.getByTestId("speed-limit-rectangle")).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.queryByTestId("school-zone-badge")).toBeNull();
  });
  it("the call-out says 'School zone, 40'", () => {
    expect(planPhrase({ kind: "schoolZone", limit: 40 }).fullText).toBe("School zone, 40");
  });
});

describe("driving the real Unwins Bridge Road zone, as MapScreen does", () => {
  const run = (startIso: string) => {
    const t0 = Date.parse(startIso);
    let state = INITIAL_SCHOOL_ZONE_TRACKER;
    let prev: LatLng | null = null;
    let entered = 0;
    let shown: number[] = [];
    for (const s of driveTrack(road.polyline, () => 40)) {
      const heading = prev ? (Math.atan2((s.truth.longitude - prev.longitude) * Math.cos((s.truth.latitude * Math.PI) / 180), s.truth.latitude - prev.latitude) * 180) / Math.PI : null;
      prev = s.truth;
      const r = trackSchoolZone(state, { position: s.truth, heading, shapes, calendars: { "AU-NSW": cal }, nowMs: t0 + s.timeMs });
      state = r.state;
      if (r.entered) entered++;
      const limit = resolveSpeedLimit({
        schoolZone: r.now?.status.active ? { active: true, kmh: r.now.status.limitKmh, display: r.now.shape.zone.limit, untilLabel: r.now.status.untilLabel } : null,
        osm: { kmh: 60, estimated: false },
      });
      shown.push(limit!.kmh);
    }
    return { entered, shown };
  };
  it("8:20 am on a school day: one call-out, the sign goes 60 -> 40 -> 60", () => {
    const { entered, shown } = run("2026-11-17T08:20:00+11:00");
    expect(entered).toBe(1);
    const changes = shown.filter((v, i) => i === 0 || v !== shown[i - 1]);
    expect(changes).toEqual([60, 40, 60]);
  });
  it("8:20 am in the holidays: no call-out, the sign stays at the road's 60", () => {
    const { entered, shown } = run("2026-04-14T08:20:00+10:00");
    expect(entered).toBe(0);
    expect(new Set(shown)).toEqual(new Set([60]));
  });
  it("parked in the zone at 7:59 am: switches on at exactly 8:00 (nextChangeMs), and off at 9:30", () => {
    const tempe = shapes.find((s) => s.zone.id === "TfNSW-449560")!;
    const inZone = driveTrack(road.polyline, () => 40)
      .map((s) => s.truth)
      .find((p) => trackSchoolZone(INITIAL_SCHOOL_ZONE_TRACKER, { position: p, heading: null, shapes: [tempe], calendars: {}, nowMs: 0 }).now)!;
    const at = (iso: string) => trackSchoolZone(INITIAL_SCHOOL_ZONE_TRACKER, { position: inZone, heading: null, shapes: [tempe], calendars: { "AU-NSW": cal }, nowMs: Date.parse(iso) });
    const before = at("2026-11-17T07:59:00+11:00");
    expect(before.now?.status.active).toBe(false);
    expect(before.nextChangeMs).toBe(Date.parse("2026-11-17T08:00:00+11:00"));
    expect(at("2026-11-17T08:00:00+11:00").now?.status.active).toBe(true);
    const during = at("2026-11-17T09:29:00+11:00");
    expect(during.nextChangeMs).toBe(Date.parse("2026-11-17T09:30:00+11:00"));
    expect(at("2026-11-17T09:30:00+11:00").now?.status.active).toBe(false);
  });
});
