// Pure unit tests (no emulator needed) for the character-voice helpers.
const core = require("../functions/personaSpeechCore");

describe("secretIsSet (is there a real ElevenLabs key?)", () => {
  test("a real-looking value counts", () => {
    expect(core.secretIsSet("sk_abc123")).toBe(true);
  });
  test.each([["empty", ""], ["whitespace", "   "], ["the deploy placeholder", "unset"], ["placeholder, any case", " UNSET "], ["undefined", undefined], ["null", null]])(
    "%s does not",
    (_name, value) => {
      expect(core.secretIsSet(value)).toBe(false);
    }
  );
});

describe("validateRequest", () => {
  test("a known character and a normal sentence pass, with whitespace tidied", () => {
    expect(core.validateRequest({ personaId: "matilda", text: "  Turn left   onto George St " })).toEqual({
      personaId: "matilda",
      text: "Turn left onto George St",
    });
  });
  test.each([
    ["unknown character", { personaId: "darth", text: "Turn left" }],
    ["no character", { text: "Turn left" }],
    ["empty text", { personaId: "matilda", text: "   " }],
    ["non-string text", { personaId: "matilda", text: 42 }],
    ["too long", { personaId: "matilda", text: "a".repeat(core.MAX_TEXT_LENGTH + 1) }],
    ["markup", { personaId: "matilda", text: "Turn <b>left</b>" }],
    ["control characters", { personaId: "matilda", text: "Turn left\u0007" }],
    ["no data at all", undefined],
  ])("rejects: %s", (_name, data) => {
    expect(core.validateRequest(data)).toBeNull();
  });
  test("text exactly at the limit is allowed", () => {
    expect(core.validateRequest({ personaId: "dry_wit", text: "a".repeat(core.MAX_TEXT_LENGTH) })).not.toBeNull();
  });
});

describe("cachePath (the shared sentence cache)", () => {
  test("the same sentence in the same voice always lands in the same place", () => {
    expect(core.cachePath("matilda", "v1", "m1", "Turn left")).toBe(core.cachePath("matilda", "v1", "m1", "Turn left"));
  });
  test("a different sentence, voice or model is a different file", () => {
    const base = core.cachePath("matilda", "v1", "m1", "Turn left");
    expect(core.cachePath("matilda", "v1", "m1", "Turn right")).not.toBe(base);
    expect(core.cachePath("matilda", "v2", "m1", "Turn left")).not.toBe(base);
    expect(core.cachePath("matilda", "v1", "m2", "Turn left")).not.toBe(base);
  });
  test("the path never contains the sentence itself, and stays under personaSpeech/", () => {
    const path = core.cachePath("footy_fan", "v1", "m1", "Turn left onto Secret Street");
    expect(path).toMatch(/^personaSpeech\/footy_fan\/[0-9a-f]{64}\.mp3$/);
    expect(path).not.toContain("Secret");
  });
});

describe("usageToday (the daily allowance)", () => {
  const noon = Date.UTC(2026, 10, 11, 12);
  test("no record yet -> 0", () => {
    expect(core.usageToday(null, noon)).toBe(0);
  });
  test("a count from today is kept", () => {
    expect(core.usageToday({ day: "2026-11-11", count: 37 }, noon)).toBe(37);
  });
  test("a count from yesterday starts again from 0", () => {
    expect(core.usageToday({ day: "2026-11-10", count: 400 }, noon)).toBe(0);
  });
  test("a corrupt count is treated as 0, not as NaN", () => {
    expect(core.usageToday({ day: "2026-11-11", count: "lots" }, noon)).toBe(0);
  });
});
