// App-wide rules, read straight from the source: one button family, one icon set, one shadow,
// no loops, and every meaning colour used only where it means that.
import { describe, expect, it } from "@jest/globals";
import path from "path";
import { adHocButtons, openings, read, sourceFiles } from "../support/sourceScan";

const ui = (f: string) => f.includes(`components${path.sep}ui${path.sep}`);
const theme = (f: string) => f.startsWith(`src${path.sep}theme${path.sep}`);

describe("one button family", () => {
  it("no screen dresses a Pressable up as a button (use Button / Chip / FloatingButton)", () => {
    expect(adHocButtons()).toEqual([]);
  });

  it("no Touchable* anywhere, and the press feedback is only used inside components/ui", () => {
    for (const f of sourceFiles()) {
      const src = read(f);
      expect([f, /Touchable(Opacity|Highlight|WithoutFeedback)\b/.test(src)]).toEqual([f, false]);
      if (!ui(f)) expect([f, src.includes("PressableScale")]).toEqual([f, false]);
    }
  });

  it("re-centre tone is only ever a re-centre, and report tone only ever a report", () => {
    for (const f of sourceFiles("src", /\.tsx$/)) {
      if (ui(f)) continue;
      for (const o of openings(read(f), ["FloatingButton"])) {
        const tone = /tone="(\w+)"/.exec(o.text)?.[1];
        const label = /accessibilityLabel=(?:"([^"]*)"|\{([^}]*)\})/.exec(o.text);
        const said = (label?.[1] ?? label?.[2] ?? "").toLowerCase();
        if (tone === "recenter") expect([f, o.line, /re-?cent(re|er)/.test(said)]).toEqual([f, o.line, true]);
        if (tone === "report") expect([f, o.line, said.includes("report")]).toEqual([f, o.line, true]);
      }
    }
  });

  it("button labels are sentence case (no Title Case Words)", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles("src", /\.tsx$/)) {
      for (const o of openings(read(f), ["Button", "Chip"])) {
        for (const [, label] of o.text.matchAll(/label="([^"]+)"/g)) {
          const words = label.split(/\s+/).slice(1);
          // Proper nouns and acronyms are fine ("REV", "PPSR", "Tracky", "Maps").
          const bad = words.filter((w) => /^[A-Z][a-z]+$/.test(w) && !["Tracky", "Maps", "Google", "TrackLine"].includes(w));
          if (bad.length) offenders.push(`${f}:${o.line} "${label}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("one icon set", () => {
  // Map artwork keeps its own drawings: the user-chosen alert icon themes, OSM marker glyphs,
  // and map pins. Every other icon is a Lucide line icon through components/ui/Icon.
  const ARTWORK = new Set(
    [
      "src/components/AlertTypeGlyph.tsx",
      "src/components/LocationMarkers.tsx",
      "src/components/NearbyAlertToast.tsx",
      "src/map-v2/layers/MapIcons.tsx",
      "src/screens/OsmMarkerSheet.tsx",
      "src/screens/InboxScreen.tsx",
      "src/screens/SettingsScreen.tsx",
    ].map((p) => p.split("/").join(path.sep))
  );

  it("only map-artwork files import @expo/vector-icons", () => {
    const users = sourceFiles().filter((f) => read(f).includes('from "@expo/vector-icons"'));
    expect(users.filter((f) => !ARTWORK.has(f))).toEqual([]);
  });

  it("in those files, vector icons only draw alert / marker artwork", () => {
    for (const f of ARTWORK) {
      for (const o of openings(read(f), ["Ionicons", "MaterialCommunityIcons", "MaterialIcons"])) {
        if (f.includes("MapIcons") || f.includes("AlertTypeGlyph") || f.includes("LocationMarkers")) continue;
        expect([f, o.line, /ALERT_ICONS|iconSpec|marker\.icon|ICON_NAMES|glyph\.name/.test(o.text)]).toEqual([f, o.line, true]);
      }
    }
  });
});

describe("one shadow", () => {
  it("nothing outside the theme sets its own shadow", () => {
    const offenders = sourceFiles()
      .filter((f) => !theme(f))
      .filter((f) => /shadow(Color|Opacity|Radius|Offset)\s*:/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("motion", () => {
  it("nothing loops except the Go now fill (a one-shot timing) and Tracky's idle bob", () => {
    const loops = sourceFiles().filter((f) => /withRepeat\(|Animated\.loop\(/.test(read(f)));
    expect(loops).toEqual([path.join("src", "components", "trackys", "Tracky.tsx")]);
  });

  it("Tracky's bob and the Go now countdown both stop with Reduce Motion", () => {
    expect(read("src/components/trackys/Tracky.tsx")).toMatch(/shouldAnimate = animated && !reduceMotion/);
    expect(read("src/screens/MapScreen.tsx")).toMatch(/countdownRunning=\{autoGoRunning && travelMode === "driving" && !reduceMotion\}/);
  });

  it("presses use timing, not springs (no overshoot)", () => {
    const press = read("src/components/ui/PressableScale.tsx");
    expect(press).toMatch(/withTiming/);
    expect(press).not.toMatch(/withSpring/);
  });
});

describe("meaning colours stay in the theme", () => {
  // The raw hex of a meaning colour anywhere else means something bypassed the groups.
  const MEANING_HEX = /#(0099FF|0098FF|0062B8|3C3F44|FFD84D|E5484D|B8262B|6A1FD1|5212B8|C9A8F5|12A150|0B7A3B)\b/i;
  it("no screen or component writes a meaning colour by hand", () => {
    const offenders = sourceFiles().filter((f) => !theme(f) && MEANING_HEX.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the re-centre grey and the report yellow are only used by their own buttons", () => {
    const users = (token: string) =>
      sourceFiles()
        .filter((f) => !theme(f) && read(f).includes(token))
        .map((f) => f.split(path.sep).join("/"));
    // NavBottomBar's in-drive Re-centre is the other re-centre button.
    expect(users("colors.recenterGrey")).toEqual(["src/components/NavBottomBar.tsx"]);
    // The street pill's "N reports around you" mark is about reports, so it's report yellow.
    expect(users("colors.reportYellow")).toEqual(["src/components/StreetPill.tsx"]);
  });
});
