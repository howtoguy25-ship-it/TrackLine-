// Traffic lights, cameras and official hazards drawn as our own road-sign art, where they show,
// and what tapping an official hazard says.
import { describe, expect, it, jest } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { alertIconTheme: "default" } }) }));

import { iconView } from "@/map-v2/layers/MapIcons";
import {
  CAMERA_MIN_ZOOM,
  MAX_SIGNS_PER_KIND,
  ROAD_FEATURE_MARK_ZOOM,
  roadFeatureState,
  TRAFFIC_LIGHT_MIN_ZOOM,
  homeRoadSigns,
  signIcon,
  signKind,
  type SignPoint,
} from "@/map/roadSignVisibility";
import { cardForOfficial, officialFacts, tidyHeadline } from "@/map/alertCard";
import { AlertCard } from "@/components/AlertCard";
import { incidentStyle, type NearbyIncident } from "@/services/trafficNswModel";

const CENTRE = { latitude: -33.92, longitude: 151.05 };
const view = (zoom: number) => ({ ...CENTRE, latitudeDelta: 360 / 2 ** zoom, zoom });
const all = () => true;
const light = (k: string, dLat = 0): SignPoint => ({ key: `tl:${k}`, item: "trafficLights", lat: CENTRE.latitude + dLat, lng: CENTRE.longitude });
const camera = (k: string, dLat = 0): SignPoint => ({ key: `sc:${k}`, item: "speedCamera", lat: CENTRE.latitude + dLat, lng: CENTRE.longitude });

describe("road-sign art on the map", () => {
  it("traffic lights, speed cameras and every camera item draw our own sign art", async () => {
    await render(<>{iconView("traffic-light")}</>);
    expect(screen.getByTestId("art-traffic-light")).toBeTruthy();
    await render(<>{iconView("speed-camera")}</>);
    expect(screen.getByTestId("art-speed-camera")).toBeTruthy();
    for (const id of ["redLightCamera", "mobilePhoneCamera", "seatBeltCamera", "safeDistanceCamera"]) {
      await render(<>{iconView(`feature:${id}`)}</>);
      expect(screen.getByTestId("art-speed-camera")).toBeTruthy();
    }
    await render(<>{iconView("feature:trafficLights")}</>);
    expect(screen.getByTestId("art-traffic-light")).toBeTruthy();
  });

  it("every Live Traffic NSW kind (roadwork, crash, flood, fire, closure, event) is a hazard triangle", async () => {
    const cases = [
      { kind: "roadwork", category: "Roadwork" },
      { kind: "incident", category: "Crash" },
      { kind: "flood", category: "Flooding" },
      { kind: "fire", category: "Bushfire" },
      { kind: "incident", category: "Road closed" },
      { kind: "majorevent", category: "Concert" },
      { kind: "incident", category: "Hazard" },
    ] as const;
    for (const c of cases) {
      const st = incidentStyle(c);
      await render(<>{iconView(`incident:${st.color}:${st.glyph}:${st.shape}:${st.icon}:0`)}</>);
      expect(screen.getByTestId("art-hazard-triangle")).toBeTruthy();
    }
  });

  it("sign icons and kinds", () => {
    expect(signIcon("trafficLights")).toBe("traffic-light");
    expect(signIcon("speedCamera")).toBe("speed-camera");
    expect(signIcon("redLightCamera")).toBe("feature:redLightCamera");
    expect(signKind("redLightCamera")).toBe("camera");
    expect(signKind("transitLaneCamera")).toBe("camera");
    expect(signKind("trafficLights")).toBe("trafficLight");
    expect(signKind("speedBump")).toBe("other");
  });
});

describe("where traffic lights and cameras show off a drive", () => {
  const points = [light("a"), camera("b"), { key: "bump", item: "speedBump", lat: CENTRE.latitude, lng: CENTRE.longitude } as SignPoint];

  it("street level: cameras, lights and road features (speed bump as its small grey icon)", () => {
    expect(homeRoadSigns(points, view(16), { navigating: false, shown: all }).map((p) => p.key)).toEqual(["sc:b", "tl:a", "bump"]);
    expect(signIcon("speedBump", 16)).toBe("road-feature:speedBump");
  });

  it("cameras from zoom 12, traffic lights from street level; road features as a checker mark at 14-16, hidden below 14", () => {
    expect(homeRoadSigns(points, view(TRAFFIC_LIGHT_MIN_ZOOM - 0.5), { navigating: false, shown: all }).map((p) => p.key)).toEqual(["sc:b", "bump"]);
    expect(signIcon("speedBump", 15)).toBe("road-mark");
    expect(homeRoadSigns(points, view(ROAD_FEATURE_MARK_ZOOM - 0.5), { navigating: false, shown: all }).map((p) => p.key)).toEqual(["sc:b"]);
    expect(homeRoadSigns(points, view(CAMERA_MIN_ZOOM - 0.5), { navigating: false, shown: all })).toEqual([]);
    expect([roadFeatureState(17), roadFeatureState(16), roadFeatureState(15), roadFeatureState(13.9)]).toEqual(["icon", "icon", "mark", "hidden"]);
  });

  it("the item's Show on map switch decides", () => {
    expect(homeRoadSigns(points, view(16), { navigating: false, shown: (i) => i !== "speedCamera" && i !== "speedBump" }).map((p) => p.key)).toEqual(["tl:a"]);
  });

  it("no road feature is ever a coloured dot: our grey icon at street zoom, a 7pt checker below", async () => {
    await render(<>{iconView("road-feature:speedBump")}</>);
    expect(screen.getByTestId("road-feature-speed-bump", { includeHiddenElements: true })).toBeTruthy();
    await render(<>{iconView("road-feature:raisedCrossing")}</>);
    expect(screen.getByTestId("road-feature-icon", { includeHiddenElements: true })).toBeTruthy();
    await render(<>{iconView("road-mark")}</>);
    expect(screen.getByTestId("road-feature-mark", { includeHiddenElements: true })).toHaveStyle({ width: 7, height: 7 });
  });

  it("nothing while navigating (the route-ahead icons take over) and nothing before the map has a view", () => {
    expect(homeRoadSigns(points, view(16), { navigating: true, shown: all })).toEqual([]);
    expect(homeRoadSigns(points, null, { navigating: false, shown: all })).toEqual([]);
  });

  it("only what's in view, nearest the centre first, capped per kind", () => {
    const v = view(16);
    const far = light("far", v.latitudeDelta * 2);
    const many = Array.from({ length: MAX_SIGNS_PER_KIND + 10 }, (_, i) => light(`n${i}`, (i * v.latitudeDelta) / 200));
    const out = homeRoadSigns([far, ...many], v, { navigating: false, shown: all });
    expect(out).toHaveLength(MAX_SIGNS_PER_KIND);
    expect(out.map((p) => p.key)).not.toContain("tl:far");
    expect(out[0].key).toBe("tl:n0");
  });
});

describe("tapping an official hazard: the simple full story", () => {
  const NOW = 1_800_000_000_000;
  const incident = {
    id: "ltn-9",
    kind: "roadwork",
    category: "Roadwork",
    headline: "ROADWORK Strathfield",
    where: "Parramatta Road at Leicester Avenue, Strathfield",
    delay: "Expect delays of 10 minutes",
    advice: "Reduced speed limit, one lane closed",
    major: true,
    lat: -33.87,
    lng: 151.09,
    updatedAt: NOW - 5 * 60_000,
    distanceMeters: 600,
  } as NearbyIncident;

  it("headline tidied, delay and impact listed; only what the feed gave", () => {
    expect(tidyHeadline("CRASH Punchbowl")).toBe("Crash Punchbowl");
    expect(officialFacts(incident, incident.advice)).toEqual([
      { label: "What's happening", value: "Roadwork Strathfield" },
      { label: "Delay", value: "Expect delays of 10 minutes" },
      { label: "Impact", value: "Major incident" },
    ]);
    expect(officialFacts({ ...incident, headline: "", delay: "", major: false }, incident.advice)).toEqual([]);
  });

  it("the card shows type, where, advice, the facts, source and the triangle", async () => {
    await render(
      <AlertCard
        card={cardForOfficial(incident)}
        incident={incident}
        distanceText="600 m away"
        place={null}
        now={NOW}
        thanked={false}
        compact={false}
        top={47}
        scale={1}
        onThanks={() => {}}
        onOpenDetails={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByTestId("alert-card-title").props.children).toBe("Roadwork");
    expect(screen.getByTestId("alert-card-note").props.children).toBe("“Reduced speed limit, one lane closed”");
    expect(screen.getByTestId("alert-card-facts")).toBeTruthy();
    expect(screen.getByText(/Expect delays of 10 minutes/)).toBeTruthy();
    expect(screen.getByTestId("alert-card-source").props.children).toBe("Source: Live Traffic NSW (official)");
    expect(screen.getByTestId("art-hazard-triangle")).toBeTruthy();
    expect(screen.queryByTestId("alert-card-thanks")).toBeNull();
  });
});
