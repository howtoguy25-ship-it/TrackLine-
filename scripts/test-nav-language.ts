// Real unit checks for src/services/navLanguage.ts and the language side of navSpeechPlan.ts
// -- run with:
//   npx tsx scripts/test-nav-language.ts
// These check the plumbing (the right table entry reaches the right place, nothing is left in
// English by accident). They cannot check that a translation is GOOD -- that needs a speaker.
import {
  NAMED_LANGUAGE_VOICES,
  NAV_LANGUAGES,
  findVoiceForNamedLanguage,
  localizedDistanceCue,
  localizedPhrase,
  localizedReport,
  navLanguageForVoiceLanguage,
  sampleInstruction,
  type NavLanguage,
} from "../src/services/navLanguage";
import { planPhrase, planStepAnnouncement } from "../src/services/navSpeechPlan";
import { extractRoundaboutExitNumber } from "../src/utils/navFormat";

const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "assertion failed");
  },
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
};
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const OTHERS = NAV_LANGUAGES.filter((l) => l !== "en") as Exclude<NavLanguage, "en">[];
const ALERTS = ["police", "emergency_vehicle", "hazard", "camera", "crash", "traffic_light"] as const;

console.log("which language a voice speaks");
check("a voice's language tag maps to its navigation language", () => {
  assert.equal(navLanguageForVoiceLanguage("ru-RU"), "ru");
  assert.equal(navLanguageForVoiceLanguage("es_MX"), "es");
  assert.equal(navLanguageForVoiceLanguage("ar-001"), "ar");
  assert.equal(navLanguageForVoiceLanguage("TR"), "tr");
});
check("English, unsupported and missing languages all mean English directions", () => {
  assert.equal(navLanguageForVoiceLanguage("en-AU"), "en");
  assert.equal(navLanguageForVoiceLanguage("fr-FR"), "en");
  assert.equal(navLanguageForVoiceLanguage(undefined), "en");
});

console.log("every language has every phrase");
check("all nine distance cues exist in each language, and none is left in English", () => {
  for (const language of OTHERS) {
    for (const meters of [1500, 1000, 800, 400, 200, 1609, 805, 402, 183]) {
      const text = localizedDistanceCue(language, meters);
      assert.ok(text && text.length > 0, `${language} has no cue for ${meters}`);
      // "kilometre" is not on this list on purpose: it's also the Turkish spelling.
      assert.ok(!/^in\s|\bmetres\b|\bmiles?\b|\bfeet\b/i.test(text!), `${language} ${meters} looks English: ${text}`);
    }
  }
});
check("all five fixed phrases and all six report types exist in each language", () => {
  for (const language of OTHERS) {
    for (const key of ["andThen", "start", "rerouting", "arrived", "heavyTraffic"] as const) {
      assert.ok(localizedPhrase(language, key), `${language} missing ${key}`);
    }
    for (const alert of ALERTS) assert.ok(localizedReport(language, alert), `${language} missing ${alert}`);
    assert.ok(sampleInstruction(language) !== "Turn left");
  }
});
check("no two phrases within a language are the same text (a copy-paste slip would be)", () => {
  for (const language of OTHERS) {
    const all = [
      ...[1500, 1000, 800, 400, 200, 1609, 805, 402, 183].map((m) => localizedDistanceCue(language, m)),
      ...(["andThen", "start", "rerouting", "arrived", "heavyTraffic"] as const).map((k) => localizedPhrase(language, k)),
      ...ALERTS.map((a) => localizedReport(language, a)),
    ];
    assert.equal(new Set(all).size, all.length);
  }
});
check("Arabic and Russian text is actually in those scripts", () => {
  assert.ok(/[؀-ۿ]/.test(localizedPhrase("ar", "arrived")!));
  assert.ok(/[Ѐ-ӿ]/.test(localizedPhrase("ru", "arrived")!));
});
check("English returns null here -- its wording stays in navSpeechPlan, tied to the recordable clips", () => {
  assert.equal(localizedDistanceCue("en", 400), null);
  assert.equal(localizedPhrase("en", "arrived"), null);
});

console.log("what gets spoken");
const step = (instruction: string) => ({ instruction, maneuver: "turn-left" as const });
check("an advance warning is the localized distance + Google's already-translated instruction", () => {
  const plan = planStepAnnouncement(
    { step: step("Gire a la izquierda hacia Calle Mayor"), distanceMeters: 400, kind: "early" },
    "km",
    "es"
  );
  assert.equal(plan.fullText, "En 400 metros, gire a la izquierda hacia Calle Mayor");
});
check("Arabic joins with the Arabic comma", () => {
  const plan = planStepAnnouncement({ step: step("انعطف يسارًا"), distanceMeters: 400, kind: "early" }, "km", "ar");
  assert.equal(plan.fullText, "بعد 400 متر، انعطف يسارًا");
});
check("'and then' is localized too", () => {
  const plan = planStepAnnouncement(
    { step: step("Поверните налево"), distanceMeters: 190, kind: "final", thenStep: step("Поверните направо") },
    "km",
    "ru"
  );
  assert.equal(plan.fullText, "Поверните налево, а затем поверните направо");
});
check("another language never produces English clip segments -- it's all spoken", () => {
  const plan = planStepAnnouncement({ step: step("Sola dönün"), distanceMeters: 400, kind: "early" }, "km", "tr");
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].clipKey, undefined);
  assert.equal(plan.segments[0].text, plan.fullText);
});
check("miles cues are localized as well", () => {
  const plan = planStepAnnouncement({ step: step("Sola dönün"), distanceMeters: 800, kind: "early" }, "miles", "tr");
  assert.equal(plan.fullText, "Yarım mil sonra, sola dönün");
});
check("phrases and reports come out in the chosen language", () => {
  assert.equal(planPhrase({ kind: "arrived" }, { language: "es" }).fullText, "Ha llegado a su destino");
  assert.equal(planPhrase({ kind: "report", alertType: "police" }, { language: "tr" }).fullText, "İleride polis bildirildi");
});
check("English is completely unchanged by the language parameter", () => {
  const a = planStepAnnouncement({ step: step("Turn left onto George St"), distanceMeters: 400, kind: "early" }, "km");
  const b = planStepAnnouncement({ step: step("Turn left onto George St"), distanceMeters: 400, kind: "early" }, "km", "en");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.fullText, "In 400 metres, turn left onto George St");
});

console.log("the picker's named languages");
const voices = [
  { identifier: "v.ar.sa", name: "Majed", language: "ar-SA", quality: "Default" },
  { identifier: "v.ar.001", name: "Maged", language: "ar-001", quality: "Enhanced" },
  { identifier: "v.ar.lb", name: "Carla", language: "ar-LB", quality: "Default" },
  { identifier: "v.ru", name: "Milena", language: "ru-RU", quality: "Default" },
  { identifier: "v.es.mx", name: "Paulina", language: "es-MX", quality: "Default" },
  { identifier: "v.es.es", name: "Mónica", language: "es-ES", quality: "Enhanced" },
  { identifier: "v.en", name: "Karen", language: "en-AU", quality: "Enhanced" },
];
const entry = (id: string) => NAMED_LANGUAGE_VOICES.find((e) => e.id === id)!;
check("each named language finds an installed voice of that language, best quality first", () => {
  assert.equal(findVoiceForNamedLanguage(entry("ru"), voices)?.identifier, "v.ru");
  assert.equal(findVoiceForNamedLanguage(entry("es"), voices)?.identifier, "v.es.es");
});
check("Levantine only accepts a Levant-region voice; Modern Standard never takes one", () => {
  assert.equal(findVoiceForNamedLanguage(entry("ar_levantine"), voices)?.identifier, "v.ar.lb");
  assert.equal(findVoiceForNamedLanguage(entry("ar_msa"), voices)?.identifier, "v.ar.001");
});
check("no Levantine voice installed -> not offered, rather than quietly using a different Arabic", () => {
  const without = voices.filter((v) => v.identifier !== "v.ar.lb");
  assert.equal(findVoiceForNamedLanguage(entry("ar_levantine"), without), null);
});
check("a language with no installed voice at all is null", () => {
  assert.equal(findVoiceForNamedLanguage(entry("tr"), voices), null);
});

console.log("roundabout exit numbers in other languages");
check("English still reads '2nd exit'", () => {
  assert.equal(extractRoundaboutExitNumber("At the roundabout, take the 2nd exit onto Pitt St"), 2);
});
check("Spanish, Russian and Turkish ordinal forms are read", () => {
  assert.equal(extractRoundaboutExitNumber("En la rotonda, toma la 2.ª salida"), 2);
  assert.equal(extractRoundaboutExitNumber("На круге сверните на 3-й съезд"), 3);
  assert.equal(extractRoundaboutExitNumber("Döner kavşaktan 1. çıkıştan çıkın"), 1);
});
check("a road number is never mistaken for an exit", () => {
  assert.equal(extractRoundaboutExitNumber("En la rotonda, continúa por A2"), undefined);
  assert.equal(extractRoundaboutExitNumber("Toma la salida hacia Ruta 5 norte"), undefined);
  assert.equal(extractRoundaboutExitNumber("На круге продолжайте движение по М7"), undefined);
});

console.log(`\n${passed} checks passed`);
