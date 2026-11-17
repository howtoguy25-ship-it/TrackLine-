// The build-time Mapbox token check: a placeholder, a secret token or junk fails an EAS build.
import { describe, expect, it } from "@jest/globals";
/* eslint-disable @typescript-eslint/no-require-imports */
const { mapboxTokenProblem } = require("../scripts/mapboxTokenCheck");

describe("Mapbox token build check", () => {
  it("rejects every placeholder seen or likely", () => {
    for (const t of [
      "***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)",
      "YOUR_TOKEN",
      "<mapbox-token>",
      "placeholder",
      "",
      undefined,
    ]) expect(mapboxTokenProblem(t)).not.toBeNull();
  });
  it("rejects a secret token and non-tokens", () => {
    expect(mapboxTokenProblem("sk.eyJ1IjoieCJ9.abc")).toMatch(/secret/);
    expect(mapboxTokenProblem("test-token")).toMatch(/pk\./);
  });
  it("accepts a real-shaped public token, and never repeats the value in the message", () => {
    expect(mapboxTokenProblem("pk.eyJ1IjoidHJhY2tsaW5lIn0.AbC-dEf_123")).toBeNull();
    expect(mapboxTokenProblem("sk.eyJ1IjoieCJ9.abc")).not.toContain("eyJ1");
  });
});
