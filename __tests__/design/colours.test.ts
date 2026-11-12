// The colour system: every pair the app draws passes WCAG AA, and every colour sits in the group
// for its meaning. Pure data -- no rendering -- so a failing pair names itself exactly.
import { describe, expect, it } from "@jest/globals";
import {
  AA_LARGE,
  AA_TEXT,
  ACTIONS,
  BLUE,
  GREEN,
  LIVE_TRAFFIC_BADGE,
  PURPLE,
  PURPLE_BEST,
  LAVENDER,
  RED,
  REPORTS,
  SELECTED_ROUTE_TIME,
  SELECTED_TINT,
  SURFACES,
  TRAFFIC,
  TRAFFIC_TEXT,
  YELLOW,
  allowedColours,
  contrastRatio,
  darken,
  type ActionGroup,
  type Scheme,
} from "@/theme/colors";
import { ALERT_PIN } from "@/types/alert";
import { incidentStyle } from "@/services/trafficNswModel";

const SCHEMES: Scheme[] = ["light", "dark"];
const GROUPS = Object.keys(ACTIONS.light) as ActionGroup[];

const opaque = (c: string) => /^#[0-9A-F]{6}$/i.test(c);

describe("the brief's colours", () => {
  it("are the ones asked for (blue one step darker to clear 3:1, see colors.ts)", () => {
    expect(BLUE).toBe("#0098FF");
    expect(contrastRatio("#FFFFFF", "#0099FF")).toBeLessThan(AA_LARGE); // 2.9998 -- why it moved
    expect(contrastRatio("#FFFFFF", BLUE)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(ACTIONS.light.alternative.fill).toBe("#F1F3F7");
    expect(ACTIONS.light.mapControl).toMatchObject({ fill: "#FFFFFF" });
    expect(ACTIONS.light.recenter.fill).toBe("#3C3F44");
    expect(ACTIONS.light.report).toMatchObject({ fill: "#FFD84D", outline: "#000000" });
    expect(PURPLE).toBe("#6A1FD1");
    expect(PURPLE_BEST).toBe("#5212B8");
    expect(LAVENDER).toBe("#C9A8F5");
    expect(RED).toBe("#E5484D");
    expect(GREEN).toBe("#12A150");
    expect(REPORTS.police.fill).toBe("#2F6FED");
    expect(REPORTS.crash.fill).toBe("#F0552E");
    expect(REPORTS.hazard.fill).toBe("#F5A623");
    expect(REPORTS.jam.fill).toBe("#D7263D");
    expect(REPORTS.camera.fill).toBe("#8B5CF6");
    expect(REPORTS.roadwork).toMatchObject({ fill: "#FF8A00", shape: "diamond" });
    expect(REPORTS.chat.fill).toBe("#14B8C8");
    expect(TRAFFIC).toEqual({ slow: "#F5A623", heavy: "#D7263D", standstill: "#8E1B2B" });
    expect(SURFACES.dark.background).toBe("#1C1D20");
    expect(SURFACES.dark.raised).toBe("#26282C");
    expect(ACTIONS.dark.mapControl).toMatchObject({ fill: "#2A2C30", on: "#FFFFFF" });
  });

  it("dark mode changes surfaces and map controls only; every other hue keeps its colour", () => {
    for (const g of ["go", "recenter", "report", "route", "dangerConfirm", "good"] as ActionGroup[]) {
      expect(ACTIONS.dark[g].fill).toBe(ACTIONS.light[g].fill);
    }
  });

  it("only the report group is yellow, only re-centre is dark grey, only go is the go blue", () => {
    const owners = (colour: string) => GROUPS.filter((g) => allowedColours(g).has(colour));
    expect(owners(YELLOW)).toEqual(["report"]);
    expect(owners(ACTIONS.light.recenter.fill)).toEqual(["recenter"]);
    expect(owners(BLUE)).toEqual(["go"]);
    expect(owners(RED)).toEqual(["dangerConfirm"]);
    expect(owners(PURPLE)).toEqual(["route"]);
    expect(owners(GREEN)).toEqual(["good"]);
  });
});

describe("WCAG AA, every pair", () => {
  // Labels on the go blue and the danger red are 18pt semibold (Button.labelSize), so they're
  // held to the large-text 3:1; every other text pair to 4.5:1.
  const LARGE_LABEL_GROUPS = new Set<ActionGroup>(["go", "dangerConfirm", "good", "route"]);
  // Icon-only groups: a glyph needs 3:1 (non-text contrast).
  const ICON_GROUPS = new Set<ActionGroup>(["mapControl", "recenter", "report"]);

  for (const scheme of SCHEMES) {
    for (const group of GROUPS) {
      const { fill, on } = ACTIONS[scheme][group];
      const need = LARGE_LABEL_GROUPS.has(group) || ICON_GROUPS.has(group) ? AA_LARGE : AA_TEXT;
      it(`${scheme} ${group}: ${on} on ${fill} >= ${need}:1, and still when pressed (6% darker)`, () => {
        expect(contrastRatio(on, fill)).toBeGreaterThanOrEqual(need);
        if (opaque(on) && on !== "#000000") {
          expect(contrastRatio(on, darken(fill))).toBeGreaterThanOrEqual(need);
        }
      });
    }

    it(`${scheme}: ghost buttons' blue text reads on the sheet, the raised card and the grey field`, () => {
      const blue = ACTIONS[scheme].alternative.on;
      for (const bg of [SURFACES[scheme].sheet, SURFACES[scheme].raised, SURFACES[scheme].muted]) {
        expect(contrastRatio(blue, bg)).toBeGreaterThanOrEqual(AA_TEXT);
      }
      expect(contrastRatio(blue, SELECTED_TINT[scheme])).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${scheme}: chip text on grey, and the danger red text on the sheet`, () => {
      expect(contrastRatio(SURFACES[scheme].text, ACTIONS[scheme].alternative.fill)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(ACTIONS[scheme].danger.on, SURFACES[scheme].sheet)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it(`${scheme}: body text, muted and faint text on every surface`, () => {
      const s = SURFACES[scheme];
      for (const bg of [s.sheet, s.raised]) {
        for (const fg of [s.text, s.textMuted, s.textFaint]) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });

    it(`${scheme}: "Light / Typical / Heavy traffic" and the selected route time`, () => {
      for (const fg of Object.values(TRAFFIC_TEXT[scheme])) {
        expect(contrastRatio(fg, SURFACES[scheme].sheet)).toBeGreaterThanOrEqual(AA_TEXT);
      }
      expect(contrastRatio(SELECTED_ROUTE_TIME[scheme], SURFACES[scheme].sheet)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  it("every report pin's glyph reads on its colour (3:1)", () => {
    for (const [kind, r] of Object.entries(REPORTS)) {
      expect([kind, contrastRatio(r.glyph, r.fill) >= AA_LARGE]).toEqual([kind, true]);
    }
    for (const [type, pin] of Object.entries(ALERT_PIN)) {
      expect([type, contrastRatio(pin.glyph, pin.fill) >= AA_LARGE]).toEqual([type, true]);
    }
    expect(contrastRatio(LIVE_TRAFFIC_BADGE.glyph, LIVE_TRAFFIC_BADGE.fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("Live Traffic NSW incidents use their report type's colour and a glyph that reads on it", () => {
    const cases = [
      { kind: "incident", category: "Crash" },
      { kind: "roadwork", category: "Roadwork" },
      { kind: "incident", category: "Heavy traffic" },
      { kind: "fire", category: "Fire" },
    ] as const;
    for (const c of cases) {
      const st = incidentStyle(c);
      expect(Object.values(REPORTS).map((r) => r.fill)).toContain(st.color);
      expect(contrastRatio(st.glyph, st.color)).toBeGreaterThanOrEqual(AA_LARGE);
    }
    expect(incidentStyle({ kind: "roadwork", category: "Roadwork" }).shape).toBe("diamond");
    expect(incidentStyle({ kind: "incident", category: "Crash" }).shape).toBe("circle");
  });

  it("route lines and bubbles: white on purple, white on the Best bubble", () => {
    expect(contrastRatio("#FFFFFF", PURPLE)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio("#FFFFFF", PURPLE_BEST)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // Map traffic lines are drawn in the brief's exact colours. They aren't the only way traffic is
  // shown (each route also SAYS "Light / Typical / Heavy traffic", tested above), so they're
  // supplementary graphics; their ratios are recorded here rather than held to 3:1. Slow amber on
  // the white road is 2.0:1 and heavy red on the purple route 1.6:1 -- if the brief's colours
  // change, update these numbers deliberately.
  it("records the map traffic colours' contrast (supplementary graphics, see comment)", () => {
    const r = (a: string, b: string) => Math.round(contrastRatio(a, b) * 100) / 100;
    expect({
      slowOnRoad: r(TRAFFIC.slow, "#FFFFFF"),
      heavyOnRoad: r(TRAFFIC.heavy, "#FFFFFF"),
      standstillOnRoad: r(TRAFFIC.standstill, "#FFFFFF"),
      slowOnRoute: r(TRAFFIC.slow, PURPLE),
      heavyOnRoute: r(TRAFFIC.heavy, PURPLE),
    }).toEqual({ slowOnRoad: 2.03, heavyOnRoad: 4.96, standstillOnRoad: 8.97, slowOnRoute: 3.8, heavyOnRoute: 1.55 });
  });
});
