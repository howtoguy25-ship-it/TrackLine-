// Siren radar, the app side (nav/sirenRadar.ts + the banner, question card and report picker):
// listens only while driving, never asks while moving, Yes -> a report through the normal
// pipeline, No -> nothing changes, the question goes away by itself after 10 s.
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import {
  ASK_WITHIN_MS,
  DRIVE_GRACE_MS,
  PASSING_TTL_MS,
  PositionTrail,
  QUESTION_TIMEOUT_MS,
  isDriving,
  noteMoving,
  questionExpired,
  quickPin,
  shouldAsk,
  showRadarBanner,
  sirenReport,
  titleProblem,
  vehicleFromType,
  yesNo,
} from "@/nav/sirenRadar";
import { EmergencyVehicleBanner } from "@/components/EmergencyVehicleBanner";
import { SirenQuestionCard } from "@/components/SirenQuestionCard";
import { SirenReportPicker } from "@/components/SirenReportPicker";

const car = { latitude: -33.87, longitude: 151.2 };

describe("when the radar listens", () => {
  it("over 10 km/h, for 2 minutes after (a red light), or while navigating", () => {
    let last = noteMoving(null, 40, 0);
    expect(isDriving(last, 1000, false)).toBe(true);
    last = noteMoving(last, 0, 60_000);
    expect(last).toBe(0);
    expect(isDriving(last, DRIVE_GRACE_MS, false)).toBe(true);
    expect(isDriving(last, DRIVE_GRACE_MS + 1, false)).toBe(false);
    expect(isDriving(null, 0, true)).toBe(true);
    expect(isDriving(noteMoving(null, 8, 0), 0, false)).toBe(false);
  });
});

describe("the question", () => {
  const q = { endedAt: 0, type: "police" as const, loudest: car };
  it("is never asked while moving; asked under 10 km/h; or straight away for a passenger", () => {
    expect(shouldAsk(q, 1000, 50, false)).toBe(false);
    expect(shouldAsk(q, 1000, 10, false)).toBe(false);
    expect(shouldAsk(q, 1000, 9, false)).toBe(true);
    expect(shouldAsk(q, 1000, null, false)).toBe(false);
    expect(shouldAsk(q, 1000, 60, true)).toBe(true);
  });
  it("waits up to 10 minutes, then is dropped", () => {
    expect(shouldAsk(q, ASK_WITHIN_MS, 0, false)).toBe(true);
    expect(shouldAsk(q, ASK_WITHIN_MS + 1, 0, false)).toBe(false);
    expect(questionExpired(q, ASK_WITHIN_MS + 1)).toBe(true);
  });
  it("hears a spoken yes or no", () => {
    expect(yesNo("Yes")).toBe("yes");
    expect(yesNo("yeah I did")).toBe("yes");
    expect(yesNo("no")).toBe("no");
    expect(yesNo("nope")).toBe("no");
    expect(yesNo("what's the weather")).toBeNull();
  });

  it("Yes / No press through; unanswered it calls No after 10 s", async () => {
    jest.useFakeTimers();
    const onYes = jest.fn();
    const onNo = jest.fn();
    const r = await render(<SirenQuestionCard top={50} dark={false} onYes={onYes} onNo={onNo} listening={false} />);
    expect(r.getByText("Did you see an emergency vehicle or incident?")).toBeTruthy();
    await fireEvent.press(r.getByTestId("siren-question-yes"));
    expect(onYes).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByTestId("siren-question-no"));
    expect(onNo).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(QUESTION_TIMEOUT_MS - 1);
    });
    expect(onNo).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onNo).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe("the banner", () => {
  it("says what was heard and how close, and what to do", async () => {
    const r = await render(<EmergencyVehicleBanner top={50} type="police" closeness="closer" dark />);
    expect(r.getByText("Emergency vehicle nearby")).toBeTruthy();
    expect(r.getByTestId("emergency-banner-subtitle").props.children).toBe("Police · Getting closer");
    expect(r.getByText("Slow down and make way when safe")).toBeTruthy();
  });
  it("one at a time; during a turn close-up only when it's getting closer", () => {
    expect(showRadarBanner(null, false)).toBe(false);
    expect(showRadarBanner({ type: "emergency", closeness: "nearby" }, false)).toBe(true);
    expect(showRadarBanner({ type: "emergency", closeness: "nearby" }, true)).toBe(false);
    expect(showRadarBanner({ type: "emergency", closeness: "away" }, true)).toBe(false);
    expect(showRadarBanner({ type: "emergency", closeness: "closer" }, true)).toBe(true);
  });
});

describe("the Yes report", () => {
  it("files through the normal pipeline: passing = 15 min; crash / blocked / police stop = normal rules", () => {
    expect(sirenReport({ vehicle: "ambulance", what: "passing", title: "" })).toEqual({ item: "emergencyVehicles", ttlMs: PASSING_TTL_MS, comment: "Ambulance", closure: null });
    expect(sirenReport({ vehicle: "fire", what: "crash", title: "Two cars" })).toMatchObject({ item: "crash", ttlMs: null, comment: "Fire truck: Two cars" });
    expect(sirenReport({ vehicle: "police", what: "blocked", title: "" })).toMatchObject({ item: "closures", ttlMs: null, closure: { direction: "mine", lanes: "all", until: "1h" } });
    expect(sirenReport({ vehicle: "unmarkedPolice", what: "policeStop", title: "" })).toMatchObject({ item: "police", comment: "Unmarked police" });
    expect(sirenReport({ vehicle: "rescue", what: "unknown", title: "" })).toMatchObject({ item: "emergencyVehicles", ttlMs: null, comment: "SES / Rescue" });
  });
  it("the title: 40 characters, kept clean", () => {
    expect(titleProblem("x".repeat(40))).toBeNull();
    expect(titleProblem("x".repeat(41))).toMatch(/40/);
    expect(titleProblem("what the fuck")).toMatch(/clean/);
    expect(sirenReport({ vehicle: "police", what: "passing", title: "what the fuck" }).comment).toBe("Police");
  });
  it("starts on what was heard", () => {
    expect(vehicleFromType("ambulance")).toBe("ambulance");
    expect(vehicleFromType("fire")).toBe("fire");
    expect(vehicleFromType("emergency")).toBe("other");
  });
  it("quick pins: ahead / behind 100 m along your heading, or where it was loudest", () => {
    const loud = { latitude: -33.86, longitude: 151.21 };
    expect(quickPin("heard", car, 0, loud)).toBe(loud);
    expect(quickPin("heard", car, 0, null)).toBe(car);
    const ahead = quickPin("ahead", car, 0, loud);
    const behind = quickPin("behind", car, 0, loud);
    expect(ahead.latitude).toBeGreaterThan(car.latitude);
    expect(behind.latitude).toBeLessThan(car.latitude);
    expect((ahead.latitude - car.latitude) * 111_195).toBeCloseTo(100, 0);
  });
  it("the trail finds where the car was when it was loudest", () => {
    const t = new PositionTrail();
    t.push(0, { latitude: 1, longitude: 1 });
    t.push(5000, { latitude: 2, longitude: 2 });
    t.push(10_000, { latitude: 3, longitude: 3 });
    expect(t.at(6000)).toEqual({ latitude: 2, longitude: 2 });
    expect(t.at(100_000)).toBeNull();
  });

  it("the sheet: chips change it, the title only while stopped, quick pins press through", async () => {
    const onChange = jest.fn();
    const onQuickPin = jest.fn();
    const value = { vehicle: "other" as const, what: "passing" as const, title: "" };
    const r = await render(<SirenReportPicker value={value} onChange={onChange} stopped={false} onQuickPin={onQuickPin} />);
    for (const id of ["ambulance", "police", "unmarkedPolice", "fire", "rescue", "other"]) expect(r.getByTestId(`siren-vehicle-${id}`)).toBeTruthy();
    for (const id of ["passing", "crash", "blocked", "policeStop", "unknown"]) expect(r.getByTestId(`siren-what-${id}`)).toBeTruthy();
    await fireEvent.press(r.getByTestId("siren-vehicle-fire"));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, vehicle: "fire" });
    await fireEvent.press(r.getByTestId("siren-what-crash"));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, what: "crash" });
    expect(r.getByTestId("siren-title").props.editable).toBe(false);
    await fireEvent.press(r.getByTestId("siren-pin-behind"));
    expect(onQuickPin).toHaveBeenCalledWith("behind");
    const moving = await render(<SirenReportPicker value={value} onChange={onChange} stopped onQuickPin={onQuickPin} />);
    expect(moving.getByTestId("siren-title").props.editable).toBe(true);
  });
});

describe("MapScreen wiring", () => {
  const src = require("fs").readFileSync("src/screens/MapScreen.tsx", "utf8") as string;
  it("listens only when opted in and driving; turning the setting off stops it at once", () => {
    expect(src).toMatch(/settingOn: settings\.sirenRadar,/);
    expect(src).toMatch(/navigating: isDriving\(lastMovingAtRef\.current, now, !!route && travelMode === "driving"\)/);
    expect(src).toMatch(/if \(settings\.sirenRadar \|\| !radarListeningRef\.current\) return;\s*radarListeningRef\.current = false;\s*sirenDetection\.stop\(\);/);
    expect(src).toMatch(/sirenDetection\.setOwnAudioCheck\(isNavSpeaking\)/);
  });
  it("asks only when stopped, never during a report; No changes nothing on the map", () => {
    expect(src).toMatch(/if \(shouldAsk\(sirenQuestion, now, currentSpeedKmh, false\) && !placingAlert\) setSirenAsking\(true\);/);
    const no = src.slice(src.indexOf("const onSirenNo = useCallback"), src.indexOf("}, []);", src.indexOf("const onSirenNo = useCallback")));
    expect(no).not.toMatch(/submitReport|setAlertPlacementLatLng|setPlacingAlert/);
  });
  it("Yes opens the report at the loudest point; Report sends what happened through submitReport", () => {
    expect(src).toMatch(/onReportItemSelected\("emergencyVehicles"\);\s*const at = q\.loudest \?\? initialAlertPlacement\(currentLatLng\);/);
    expect(src).toMatch(/const sirenPlan = sirenDraft \? sirenReport\(sirenDraft\) : null;/);
    expect(src).toMatch(/customTtlMs: sirenPlan\?\.ttlMs \?\? settings\.alertExpiryMs,\s*comment: sirenPlan \? sirenPlan\.comment : alertComment,/);
  });
});
