import type { AlertType } from "@/types/alert";

// The languages navigation can actually speak: English plus the four the voice picker names
// (Arabic, Russian, Spanish, Turkish).
//
// Choosing a voice in one of these does two things. Google's turn instructions are requested in
// that language (services/directions.ts), so "Turn left onto George St" arrives already
// translated. And the handful of phrases this app adds around them -- "in 400 metres", "and
// then", "re-routing", report call-outs -- come from the tables below.
//
// Before this, a Russian voice simply read English sentences aloud with a Russian accent.
//
// The non-English phrases here were written without review by a native speaker. They are
// standard navigation wording, but a native check before relying on them is worth doing.
//
// No imports beyond a type, so scripts/test-nav-language.ts checks all of it directly.

export type NavLanguage = "en" | "ar" | "ru" | "es" | "tr";

export const NAV_LANGUAGES: NavLanguage[] = ["en", "ar", "ru", "es", "tr"];

export function isNavLanguage(value: unknown): value is NavLanguage {
  return typeof value === "string" && (NAV_LANGUAGES as string[]).includes(value);
}

/** The navigation language for a voice's language tag ("ru-RU" -> "ru"); English for anything else. */
export function navLanguageForVoiceLanguage(languageTag: string | null | undefined): NavLanguage {
  const primary = (languageTag ?? "").toLowerCase().split(/[-_]/)[0];
  return isNavLanguage(primary) ? primary : "en";
}

export type PhraseKey = "andThen" | "start" | "rerouting" | "arrived" | "heavyTraffic";

interface LanguagePack {
  /** Metric distance cues, keyed by metres. */
  metric: Record<1500 | 1000 | 800 | 400 | 200, string>;
  /** Imperial distance cues, keyed by the metres each corresponds to. */
  imperial: Record<1609 | 805 | 402 | 183, string>;
  /** Punctuation that joins a cue to the instruction after it. */
  comma: string;
  phrases: Record<PhraseKey, string>;
  reports: Record<AlertType, string>;
  /** "Turn left", for the voice picker's preview -- real routes get theirs from Google. */
  sampleInstruction: string;
}

// English is deliberately absent: its wording lives in navSpeechPlan.ts, tied to the clips a
// driver can record, and stays the single source for it.
const PACKS: Record<Exclude<NavLanguage, "en">, LanguagePack> = {
  es: {
    sampleInstruction: "Gire a la izquierda",
    metric: {
      1500: "En un kilómetro y medio",
      1000: "En un kilómetro",
      800: "En 800 metros",
      400: "En 400 metros",
      200: "En 200 metros",
    },
    imperial: { 1609: "En una milla", 805: "En media milla", 402: "En un cuarto de milla", 183: "En 600 pies" },
    comma: ", ",
    phrases: {
      andThen: "y luego",
      start: "Todo listo. Vamos.",
      rerouting: "Recalculando la ruta",
      arrived: "Ha llegado a su destino",
      heavyTraffic: "Tráfico intenso más adelante",
    },
    reports: {
      police: "Policía reportada más adelante",
      crash: "Accidente reportado más adelante",
      hazard: "Peligro reportado más adelante",
      camera: "Radar de velocidad reportado más adelante",
      traffic_light: "Semáforo reportado más adelante",
      emergency_vehicle: "Vehículo de emergencia reportado más adelante",
    },
  },
  ru: {
    sampleInstruction: "Поверните налево",
    metric: {
      1500: "Через полтора километра",
      1000: "Через один километр",
      800: "Через 800 метров",
      400: "Через 400 метров",
      200: "Через 200 метров",
    },
    imperial: { 1609: "Через одну милю", 805: "Через полмили", 402: "Через четверть мили", 183: "Через 600 футов" },
    comma: ", ",
    phrases: {
      andThen: "а затем",
      start: "Всё готово. Поехали.",
      rerouting: "Маршрут перестраивается",
      arrived: "Вы прибыли в пункт назначения",
      heavyTraffic: "Впереди плотное движение",
    },
    reports: {
      police: "Впереди сообщают о полиции",
      crash: "Впереди сообщают об аварии",
      hazard: "Впереди сообщают об опасности на дороге",
      camera: "Впереди сообщают о камере контроля скорости",
      traffic_light: "Впереди сообщают о светофоре",
      emergency_vehicle: "Впереди сообщают о машине экстренных служб",
    },
  },
  tr: {
    sampleInstruction: "Sola dönün",
    metric: {
      1500: "Bir buçuk kilometre sonra",
      1000: "Bir kilometre sonra",
      800: "800 metre sonra",
      400: "400 metre sonra",
      200: "200 metre sonra",
    },
    imperial: { 1609: "Bir mil sonra", 805: "Yarım mil sonra", 402: "Çeyrek mil sonra", 183: "600 fit sonra" },
    comma: ", ",
    phrases: {
      andThen: "ve ardından",
      start: "Her şey hazır. Gidelim.",
      rerouting: "Rota yeniden hesaplanıyor",
      arrived: "Hedefinize ulaştınız",
      heavyTraffic: "İleride yoğun trafik var",
    },
    reports: {
      police: "İleride polis bildirildi",
      crash: "İleride kaza bildirildi",
      hazard: "İleride tehlike bildirildi",
      camera: "İleride hız kamerası bildirildi",
      traffic_light: "İleride trafik ışığı bildirildi",
      emergency_vehicle: "İleride acil durum aracı bildirildi",
    },
  },
  ar: {
    sampleInstruction: "انعطف يسارًا",
    metric: {
      1500: "بعد كيلومتر ونصف",
      1000: "بعد كيلومتر واحد",
      800: "بعد 800 متر",
      400: "بعد 400 متر",
      200: "بعد 200 متر",
    },
    imperial: { 1609: "بعد ميل واحد", 805: "بعد نصف ميل", 402: "بعد ربع ميل", 183: "بعد 600 قدم" },
    comma: "، ",
    phrases: {
      andThen: "ثم",
      start: "كل شيء جاهز. هيا بنا.",
      rerouting: "جارٍ إعادة حساب المسار",
      arrived: "لقد وصلت إلى وجهتك",
      heavyTraffic: "ازدحام مروري أمامك",
    },
    reports: {
      police: "تم الإبلاغ عن شرطة أمامك",
      crash: "تم الإبلاغ عن حادث أمامك",
      hazard: "تم الإبلاغ عن خطر أمامك",
      camera: "تم الإبلاغ عن كاميرا سرعة أمامك",
      traffic_light: "تم الإبلاغ عن إشارة مرور أمامك",
      emergency_vehicle: "تم الإبلاغ عن مركبة طوارئ أمامك",
    },
  },
};

/** A distance cue in this language, or null for English (handled by navSpeechPlan itself). */
export function localizedDistanceCue(language: NavLanguage, cueMeters: number): string | null {
  if (language === "en") return null;
  const pack = PACKS[language];
  return (pack.metric as Record<number, string>)[cueMeters] ?? (pack.imperial as Record<number, string>)[cueMeters] ?? null;
}

export function localizedPhrase(language: NavLanguage, key: PhraseKey): string | null {
  return language === "en" ? null : PACKS[language].phrases[key];
}

export function localizedReport(language: NavLanguage, alertType: AlertType): string | null {
  return language === "en" ? null : PACKS[language].reports[alertType];
}

export function sampleInstruction(language: NavLanguage): string {
  return language === "en" ? "Turn left" : PACKS[language].sampleInstruction;
}

/** What separates "in 400 metres" from the instruction that follows it. */
export function listComma(language: NavLanguage): string {
  return language === "en" ? ", " : PACKS[language].comma;
}

// ---------------------------------------------------------------------------------------------
// The named entries in the voice picker's "Languages" section.

export interface NamedLanguageVoice {
  id: string;
  /** As shown in the picker. */
  name: string;
  navLanguage: NavLanguage;
  /** Primary language subtag a matching phone voice must have. */
  language: string;
  /**
   * Region subtags that count. "Arabic (Levantine)" only accepts a voice from Lebanon, Syria,
   * Jordan or Palestine -- and Modern Standard Arabic deliberately excludes those -- so the two
   * Arabic entries can never both resolve to the same voice and pass it off as two.
   */
  regions?: string[];
  excludeRegions?: string[];
}

const LEVANT = ["lb", "sy", "jo", "ps"];

export const NAMED_LANGUAGE_VOICES: NamedLanguageVoice[] = [
  { id: "ar_msa", name: "Arabic (Modern Standard)", navLanguage: "ar", language: "ar", excludeRegions: LEVANT },
  { id: "ar_levantine", name: "Arabic (Levantine)", navLanguage: "ar", language: "ar", regions: LEVANT },
  { id: "ru", name: "Russian", navLanguage: "ru", language: "ru" },
  { id: "es", name: "Spanish", navLanguage: "es", language: "es" },
  { id: "tr", name: "Turkish", navLanguage: "tr", language: "tr" },
];

interface DeviceVoice {
  identifier: string;
  name: string;
  language?: string;
  quality?: string;
}

/**
 * The best voice actually installed on this phone for a named language, or null if there
 * isn't one -- in which case the picker shows the entry as not installed rather than
 * selecting a voice that would mispronounce everything.
 */
export function findVoiceForNamedLanguage<T extends DeviceVoice>(entry: NamedLanguageVoice, voices: T[]): T | null {
  const matches = voices.filter((voice) => {
    const [primary, ...rest] = (voice.language ?? "").toLowerCase().split(/[-_]/);
    if (primary !== entry.language) return false;
    const region = rest[rest.length - 1] ?? "";
    if (entry.regions && !entry.regions.includes(region)) return false;
    if (entry.excludeRegions && entry.excludeRegions.includes(region)) return false;
    return true;
  });
  if (matches.length === 0) return null;
  // Higher-quality voices first, then a stable order so the choice doesn't flip between visits.
  return [...matches].sort(
    (a, b) =>
      Number(b.quality === "Enhanced") - Number(a.quality === "Enhanced") || a.identifier.localeCompare(b.identifier)
  )[0];
}
