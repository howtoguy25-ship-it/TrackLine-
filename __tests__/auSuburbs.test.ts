// Suburb postcodes from official ABS data (src/data/auSuburbPostcodes.json, built by
// scripts/build-au-postcodes.py from ASGS 2021 Suburbs and Localities + Postal Areas).
import { describe, expect, it } from "@jest/globals";
import { auSuburbFeatures, auSuburbs, suburbLabel } from "@/map-v2/auSuburbs";
import { AU_SUBURB_MIN_ZOOM, LIGHT_PALETTE, auSuburbLabelStyle, buildStyle } from "@/map-v2/styles/buildStyle";

const all = auSuburbs();
const nsw = (name: string) => all.filter((s) => s.name === name && s.state === "NSW");
// Sydney's Punchbowl (there's a second one near Armidale): the one inside Sydney's box.
const inSydney = (name: string) => nsw(name).find((s) => s.latitude < -33.5 && s.latitude > -34.2 && s.longitude > 150.6 && s.longitude < 151.4);

describe("Australian suburb postcodes (ABS)", () => {
  it("ten known Sydney suburbs carry their real postcode", () => {
    const known: [string, string][] = [
      ["Punchbowl", "2196"],
      ["Lakemba", "2195"],
      ["Greenacre", "2190"],
      ["Bankstown", "2200"],
      ["Parramatta", "2150"],
      ["Newtown", "2042"],
      ["Bondi", "2026"],
      ["Manly", "2095"],
      ["Chatswood", "2067"],
      ["Penrith", "2750"],
    ];
    for (const [name, postcode] of known) expect([name, inSydney(name)?.postcode]).toEqual([name, postcode]);
    expect(suburbLabel(inSydney("Punchbowl")!)).toBe("Punchbowl 2196");
  });

  it("a suburb split between postcodes shows its name alone, never a wrong number", () => {
    for (const name of ["Pemulwuy", "Ropes Crossing", "Glen Alpine"]) {
      const s = inSydney(name);
      expect(s).toBeDefined();
      expect(s!.postcode).toBeNull();
      expect(suburbLabel(s!)).toBe(name);
    }
    expect(all.find((s) => s.name === "Melbourne" && s.state === "VIC")?.postcode).toBeNull(); // 3000 / 3004
  });

  it("covers the whole country; the map layer has one point per suburb", () => {
    expect(all.length).toBeGreaterThan(15000);
    expect(new Set(all.map((s) => s.state))).toEqual(new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT", "OT"]));
    const fc = auSuburbFeatures();
    expect(fc.features.length).toBe(all.length);
    expect(all.filter((s) => s.postcode === null).length).toBeLessThan(50);
  });

  it("Australia shows ABS names + postcodes from z11; every other country keeps its own names, no postcode", () => {
    const style = buildStyle(LIGHT_PALETTE) as { layers: { id: string; minzoom?: number; maxzoom?: number; filter?: unknown }[] };
    const low = style.layers.find((l) => l.id === "suburb-labels")!;
    const intl = style.layers.find((l) => l.id === "suburb-labels-intl")!;
    expect(low.maxzoom).toBe(AU_SUBURB_MIN_ZOOM);
    expect(intl.minzoom).toBe(AU_SUBURB_MIN_ZOOM);
    expect(JSON.stringify(intl.filter)).toContain('["!=",["get","iso_3166_1"],"AU"]');
    expect(auSuburbLabelStyle(LIGHT_PALETTE).textField).toEqual(["case", ["has", "postcode"], ["concat", ["get", "name"], " ", ["get", "postcode"]], ["get", "name"]]);
  });
});
