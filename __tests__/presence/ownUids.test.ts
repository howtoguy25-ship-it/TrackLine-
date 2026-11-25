// Your own Tracky never sits on your arrow -- including the guest account you used before signing
// in (its presence lingers on the server for a few minutes at your spot).
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { addOwnUid } from "@/services/ownUids";
import { presencesToShow } from "@/map/presenceFilter";

const here = { latitude: -33.9, longitude: 151.05 };
const p = (uid: string, dLat = 0) => ({ uid, lat: here.latitude + dLat, lng: here.longitude });

describe("own Tracky", () => {
  it("the guest id from before sign-in is hidden as well as the current one", () => {
    const own = new Set(addOwnUid(addOwnUid([], "guest-123"), "real-456"));
    const shown = presencesToShow([p("guest-123"), p("real-456"), p("someone", 0.001)], { ownUid: "real-456", ownUids: own, blocked: new Set(), here, max: 50 });
    expect(shown.map((x) => x.uid)).toEqual(["someone"]);
  });
  it("the list keeps the most recent 20, no duplicates", () => {
    let list: string[] = [];
    for (let i = 0; i < 25; i++) list = addOwnUid(list, `u${i}`);
    list = addOwnUid(list, "u24");
    expect(list).toHaveLength(20);
    expect(new Set(list).size).toBe(20);
    expect(list[list.length - 1]).toBe("u24");
    expect(addOwnUid(list, null)).toEqual(list);
  });
  it("the map passes every id this phone has used", () => {
    const src = readFileSync("src/screens/MapScreen.tsx", "utf8");
    expect(src).toMatch(/presencesToShow\(presenceList, \{ ownUid: user\?\.uid \?\? null, ownUids: ownUidSet/);
    expect(src).toMatch(/rememberOwnUid\(user\?\.uid\)/);
  });
});
