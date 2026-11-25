// Gap item 3: conversational reporting -- what a spoken phrase reports (type, item, lane), and
// MapScreen sends it with the same server rules, says it back, and offers the 3 s Undo.
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { parseVoiceReport, stripPreamble } from "@/nav/voiceReport";
import { parseNavVoiceCommand } from "@/nav/voiceCommand";
import { baseTypeOf } from "@/settings/reportGrid";
import { shouldSpeakPhrase } from "@/services/navSpeechPlan";

describe("spoken reports", () => {
  it.each([
    ["Hey TrackLine, crash ahead", "crash", "Crash reported"],
    ["report a crash in the left lane", "crash", "Crash reported"],
    ["police on the right", "police", "Police reported"],
    ["there's a speed camera van", "mobilePoliceCamera", "Mobile police camera reported"],
    ["traffic light's not working", "trafficLights", "Traffic light not working reported"],
    ["the traffic lights are out", "trafficLights", "Traffic light not working reported"],
    ["something on the road in the right lane", "otherHazards", "Object on road reported"],
    ["pothole", "pothole", "Pothole reported"],
    ["road closed", "closures", "Road closed reported"],
    ["heavy traffic", "traffic", "Heavy traffic reported"],
    ["car broken down on the shoulder", "carOnShoulder", "Car on shoulder reported"],
    ["kangaroo on the road", "animals", "Animal on road reported"],
    ["ambulance coming", "emergencyVehicles", "Emergency vehicle reported"],
    ["roadworks", "roadwork", "Roadwork reported"],
  ])("%s -> %s", (said, item, spoken) => {
    const r = parseVoiceReport(said)!;
    expect(r.item).toBe(item);
    expect(r.spoken).toBe(spoken);
    // The same type the report grid uses for that item.
    expect(r.type).toBe(baseTypeOf(r.item as never) ?? r.type);
  });

  it("lanes and subtype go into the note", () => {
    expect(parseVoiceReport("crash in the left lane")).toMatchObject({ lane: "left", note: "Left lane" });
    expect(parseVoiceReport("debris in the middle lane")).toMatchObject({ lane: "middle", note: "Object on road · Middle lane" });
    expect(parseVoiceReport("police")).toMatchObject({ lane: null, note: null });
  });

  it("not sure = not a report (the grid asks instead); negations and commands aren't reports", () => {
    for (const t of ["", "report", "stop navigation", "mute", "other routes", "find fuel", "no crash", "cancel", "never mind", "hello"]) expect([t, parseVoiceReport(t)]).toEqual([t, null]);
    // "report" alone still opens the report grid.
    expect(parseNavVoiceCommand("report")).toBe("report");
    expect(stripPreamble("Hey Track Line, there's a crash")).toBe("crash");
  });

  it("the confirmation is always spoken unless the voice is off", () => {
    expect(shouldSpeakPhrase("lessChatty", { kind: "said", text: "Crash reported" })).toBe(true);
    expect(shouldSpeakPhrase("off", { kind: "said", text: "Crash reported" })).toBe(false);
  });

  it("MapScreen: a spoken report is sent with the server's rules, said back, with the 3 s Undo", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/const spokenReport = parseVoiceReport\(text\);\n\s*if \(spokenReport\) return void sendVoiceReport\(spokenReport\);/);
    expect(src).toMatch(/await submitReport\(r\.type, currentLatLng, currentLatLng, user\.uid/);
    expect(src).toMatch(/announcePhrase\(\{ kind: "said", text: result\.kind === "merged" \? `\$\{r\.label\} confirmed` : r\.spoken \}\)/);
    expect(src).toMatch(/setPendingReport\(\{ result, type: r\.type, label: r\.label/);
  });
});
