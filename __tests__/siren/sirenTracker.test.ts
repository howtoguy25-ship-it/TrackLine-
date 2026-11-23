// The siren radar's decisions: 3 of 5 windows at >= 0.6, type from the strongest class, closeness
// from the loudness trend, end 8 s after the last siren window, and when it may listen at all.
import { describe, expect, it } from "@jest/globals";
import { SirenTracker, closeness, shouldListen, sirenConfidence, typeGuess, END_AFTER_MS, type SirenWindow } from "@/services/sirenTracker";

const win = (at: number, scores: Record<string, number>, rmsDb: number | null = -30): SirenWindow => ({ at, scores, rmsDb });
const siren = (at: number, extra: Record<string, number> = {}, rms: number | null = -30) => win(at, { Siren: 0.8, ...extra }, rms);
const quiet = (at: number) => win(at, { Music: 0.9, Siren: 0.1 });

describe("siren tracker", () => {
  it("one window is never enough; 3 of the last 5 is", () => {
    const t = new SirenTracker();
    expect(t.push(siren(0))).toEqual([]);
    expect(t.push(quiet(1000))).toEqual([]);
    expect(t.push(siren(2000))).toEqual([]);
    const ev = t.push(siren(3000));
    expect(ev.map((e) => e.kind)).toEqual(["start"]);
  });

  it("music, horns and car alarms (siren score low) never trigger", () => {
    const t = new SirenTracker();
    for (let i = 0; i < 20; i++) expect(t.push(win(i * 1000, { Music: 0.9, "Vehicle horn, car horn, honking": 0.8, "Car alarm": 0.7, Siren: 0.3 }))).toEqual([]);
    expect(sirenConfidence({ "Car alarm": 0.95 })).toBe(0);
  });

  it("type: the strongest emergency class, else 'Emergency vehicle'", () => {
    expect(typeGuess([siren(0, { "Ambulance (siren)": 0.7 }), siren(1, { "Ambulance (siren)": 0.6 })])).toBe("ambulance");
    expect(typeGuess([siren(0, { "Police car (siren)": 0.5, "Fire engine, fire truck (siren)": 0.45 })])).toBe("emergency");
    expect(typeGuess([siren(0)])).toBe("emergency");
  });

  it("closeness from the loudness trend: rising, falling, steady; no metering = nearby", () => {
    expect(closeness([siren(0, {}, -40), siren(1000, {}, -36), siren(2000, {}, -31), siren(3000, {}, -27)])).toBe("closer");
    expect(closeness([siren(0, {}, -25), siren(1000, {}, -30), siren(2000, {}, -34)])).toBe("away");
    expect(closeness([siren(0, {}, -30), siren(1000, {}, -30.5), siren(2000, {}, -29.8)])).toBe("nearby");
    expect(closeness([siren(0, {}, null), siren(1000, {}, null), siren(2000, {}, null)])).toBe("nearby");
  });

  it("updates when it gets closer, ends 8 s after the last siren window, with where it was loudest", () => {
    const t = new SirenTracker();
    [siren(0, {}, -40), siren(1000, {}, -38)].forEach((w) => t.push(w));
    expect(t.push(siren(2000, {}, -36))[0]).toMatchObject({ kind: "start", closeness: "closer" });
    t.push(siren(3000, {}, -26));
    expect(t.tick(3000 + END_AFTER_MS - 1)).toEqual([]);
    const [end] = t.tick(3000 + END_AFTER_MS);
    expect(end).toMatchObject({ kind: "end", loudestAt: 3000 });
    expect(t.isActive).toBe(false);
  });

  it("listens only while driving (over 10 km/h or navigating), opted in, not on a call or over its own audio", () => {
    const base = { settingOn: true, speedKmh: 40, navigating: false, onCall: false, ownAudioLoud: false };
    expect(shouldListen(base)).toBe(true);
    expect(shouldListen({ ...base, speedKmh: 5 })).toBe(false);
    expect(shouldListen({ ...base, speedKmh: 5, navigating: true })).toBe(true);
    expect(shouldListen({ ...base, settingOn: false })).toBe(false);
    expect(shouldListen({ ...base, onCall: true })).toBe(false);
    expect(shouldListen({ ...base, ownAudioLoud: true })).toBe(false);
  });
});
