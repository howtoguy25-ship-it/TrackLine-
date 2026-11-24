// Switching on everything between users needs one GitHub secret: FIREBASE_SERVICE_ACCOUNT.
// (Bug: the deploy also demanded MAPBOX_SERVER_TOKEN and stopped without it, although the only
// use -- snapping other drivers' Trackys to the road -- already falls back to their real
// positions when the snapping fails.) Without the token the deploy now creates the same
// "unset" placeholder as every other optional key, and the server skips the snapping.
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { describe, expect, it } from "@jest/globals";

const tokenFor = (value: string) =>
  execFileSync("node", ["-e", "process.stdout.write(String(require('./index.js')._mapboxServerTokenForTest()))"], {
    cwd: "firebase/functions",
    env: { ...process.env, MAPBOX_SERVER_TOKEN: value },
    encoding: "utf8",
  });

describe("the server Mapbox token is optional", () => {
  it("placeholder or empty: no snapping (null); a real token is used", () => {
    expect(tokenFor("unset")).toBe("null");
    expect(tokenFor("")).toBe("null");
    expect(tokenFor("pk.test-token")).toBe("pk.test-token");
  });

  it("updatePresence only calls Map Matching with a real token, and keeps the real fixes otherwise", () => {
    const src = readFileSync("firebase/functions/index.js", "utf8");
    expect(src).toMatch(/const mapboxToken = mapboxServerToken\(\);\n\s*if \(mapboxToken\) try \{/);
    expect(src).toMatch(/access_token=\$\{mapboxToken\}/);
    expect(src).not.toMatch(/access_token=\$\{MAPBOX_SERVER_TOKEN\.value\(\)\}/);
  });

  it("the deploy no longer stops without it: it gets the placeholder like every optional key", () => {
    const wf = readFileSync(".github/workflows/firebase-deploy.yml", "utf8");
    expect(wf).not.toMatch(/elif \[ "\$NAME" = "MAPBOX_SERVER_TOKEN" \]/);
    expect(wf).toMatch(/printf 'unset' \| set_secret "\$NAME"/);
    expect(readFileSync("DEPLOY.md", "utf8")).toMatch(/with just `FIREBASE_SERVICE_ACCOUNT` the deploy works/);
  });
});
