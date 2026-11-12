import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { View, Pressable, StyleSheet, SectionList, ActivityIndicator, Modal } from "react-native";
import { Text, TextInput } from "@/components/AppText";
import * as Speech from "expo-speech";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  getAllDeviceVoices,
  getVoiceConsentShownCount,
  incrementVoiceConsentShownCount,
  VOICE_CONSENT_MAX_SHOWS,
} from "@/services/voice";
import { PERSONA_VOICES, type PersonaVoice } from "@/services/personaVoices";
import { getPersonaVoicesAvailable } from "@/services/personaSpeech";
import { getRecordedClipUris, getRecordedVoiceName, totalClipCount } from "@/services/recordedVoices";
import { speakPlan, stopNavSpeech } from "@/services/navSpeech";
import {
  RECORDED_VOICE_IDENTIFIER,
  personaVoiceIdentifier,
  planStepAnnouncement,
} from "@/services/navSpeechPlan";
import {
  NAMED_LANGUAGE_VOICES,
  findVoiceForNamedLanguage,
  navLanguageForVoiceLanguage,
  sampleInstruction,
  type NamedLanguageVoice,
  type NavLanguage,
} from "@/services/navLanguage";
import { useSettings } from "@/context/SettingsContext";
import { colors, radius, shadow, spacing } from "@/theme/tokens";
import type { RootStackParamList } from "@/navigation/RootNavigator";

// Real, explicit request (Waze-style redesign, Phase 3) -- the "Current voice" picker screen,
// reached from both the Sound button's sheet and Settings > Voice & sound. Real search, real
// sections (Recommended / My recorded voices / All languages), real tap-to-preview-and-select
// against every voice actually installed on this device (expo-speech), plus the brief's four
// named persona voices shown honestly (locked/"not available yet") until a real ElevenLabs key
// exists -- see personaVoices.ts. The real "Record your own voice" guided-recorder flow is its
// own, separately-scoped build (see NOTES.md) -- this screen's "My recorded voices" section is
// a real, honest empty state plus the entry point into it, not a fake populated list.

// The preview is a real guidance call-out, built the same way navigation builds them -- so a
// recorded voice previews with the driver's own "In 400 metres" and "Turn left" clips (and the
// phone's voice for whichever of the two isn't recorded yet), exactly as it will sound driving.
// In another language the sample is in that language too -- a Russian voice previews with a
// Russian sentence, not by reading an English one aloud.
function previewPlan(language: NavLanguage) {
  return planStepAnnouncement(
    { step: { instruction: sampleInstruction(language), maneuver: "turn-left" }, distanceMeters: 400, kind: "early" },
    "km",
    language
  );
}

type Row =
  | { kind: "deviceDefault" }
  | { kind: "recorded"; name: string; recordedCount: number }
  | { kind: "persona"; persona: PersonaVoice }
  | { kind: "language"; entry: NamedLanguageVoice; voice: Speech.Voice | null }
  | { kind: "device"; voice: Speech.Voice };

interface Section {
  title: string;
  data: Row[];
}

function rowKey(row: Row): string {
  if (row.kind === "deviceDefault") return "device-default";
  if (row.kind === "recorded") return RECORDED_VOICE_IDENTIFIER;
  if (row.kind === "language") return `language:${row.entry.id}`;
  if (row.kind === "persona") return `persona:${row.persona.id}`;
  return row.voice.identifier;
}

export function VoicePickerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { voiceIdentifier, setVoiceIdentifier, voiceVolume } = useSettings();

  const [query, setQuery] = useState("");
  const [deviceVoices, setDeviceVoices] = useState<Speech.Voice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    identifier: string | null;
    key: string;
    language: NavLanguage;
  } | null>(null);

  // Whether the server can actually produce the character voices (its ElevenLabs key is set).
  // Starts false, so they show locked until the server has said otherwise.
  const [personasAvailable, setPersonasAvailable] = useState(false);
  const [recordedVoice, setRecordedVoice] = useState<{ name: string; recordedCount: number } | null>(null);

  useEffect(() => {
    getAllDeviceVoices()
      .then(setDeviceVoices)
      .catch(() => {})
      .finally(() => setLoaded(true));
    getPersonaVoicesAvailable()
      .then(setPersonasAvailable)
      .catch(() => {});
  }, []);

  // Re-read every time this screen comes back into view -- the driver may have just recorded
  // (or deleted) clips on the "Record your own" screen.
  useEffect(() => {
    const load = () => {
      Promise.all([getRecordedClipUris(), getRecordedVoiceName()])
        .then(([clips, name]) => {
          const recordedCount = Object.keys(clips).length;
          setRecordedVoice(recordedCount > 0 ? { name: name?.trim() || "My voice", recordedCount } : null);
        })
        .catch(() => {});
    };
    load();
    return navigation.addListener("focus", load);
  }, [navigation]);

  useEffect(() => {
    return () => stopNavSpeech();
  }, []);

  const commitSelection = useCallback(
    (identifier: string | null, key: string, language: NavLanguage = "en") => {
      // The language goes with the voice: from here on, turn instructions are requested in it.
      setVoiceIdentifier(identifier, language);
      setPreviewingKey(key);
      speakPlan(previewPlan(language), {
        voiceIdentifier: identifier,
        volume: voiceVolume,
        onDone: () => setPreviewingKey(null),
      });
    },
    [setVoiceIdentifier, voiceVolume]
  );

  // Real, explicit request -- "show this modal only the first 3 times ever (counter
  // persisted), then select directly."
  const onSelectRow = useCallback(
    async (identifier: string | null, key: string, language: NavLanguage = "en") => {
      const shownCount = await getVoiceConsentShownCount();
      if (shownCount >= VOICE_CONSENT_MAX_SHOWS) {
        commitSelection(identifier, key, language);
        return;
      }
      setPendingSelection({ identifier, key, language });
    },
    [commitSelection]
  );

  const confirmPendingSelection = useCallback(async () => {
    if (!pendingSelection) return;
    await incrementVoiceConsentShownCount();
    commitSelection(pendingSelection.identifier, pendingSelection.key, pendingSelection.language);
    setPendingSelection(null);
  }, [pendingSelection, commitSelection]);

  const recommended = useMemo<Row[]>(() => {
    const topDevice = deviceVoices.filter((v) => v.language?.toLowerCase().startsWith("en")).slice(0, 2);
    return [
      { kind: "deviceDefault" as const },
      ...PERSONA_VOICES.map((persona) => ({ kind: "persona" as const, persona })),
      ...topDevice.map((voice) => ({ kind: "device" as const, voice })),
    ];
  }, [deviceVoices]);

  const filteredDeviceVoices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deviceVoices;
    return deviceVoices.filter(
      (v) => v.name.toLowerCase().includes(q) || (v.language ?? "").toLowerCase().includes(q)
    );
  }, [deviceVoices, query]);

  const sections = useMemo<Section[]>(() => {
    if (query.trim()) {
      return [{ title: "All languages", data: filteredDeviceVoices.map((voice) => ({ kind: "device" as const, voice })) }];
    }
    return [
      { title: "Recommended", data: recommended },
      { title: "My recorded voices", data: recordedVoice ? [{ kind: "recorded" as const, ...recordedVoice }] : [] },
      // The named languages, each resolved to a voice that is really installed on this phone
      // -- or shown as not installed when there isn't one.
      {
        title: "Languages",
        data: NAMED_LANGUAGE_VOICES.map((entry) => ({
          kind: "language" as const,
          entry,
          voice: findVoiceForNamedLanguage(entry, deviceVoices),
        })),
      },
      { title: "All languages", data: filteredDeviceVoices.map((voice) => ({ kind: "device" as const, voice })) },
    ];
  }, [query, recommended, filteredDeviceVoices, recordedVoice, deviceVoices]);

  const renderRow = useCallback(
    (row: Row) => {
      if (row.kind === "deviceDefault") {
        const selected = voiceIdentifier === null;
        const previewing = previewingKey === "device-default";
        return (
          <VoiceRow
            name="Default (device)"
            subtitle="Your phone's own system voice"
            selected={selected}
            previewing={previewing}
            onPress={() => onSelectRow(null, "device-default")}
          />
        );
      }
      if (row.kind === "recorded") {
        const total = totalClipCount();
        return (
          <VoiceRow
            name={row.name}
            subtitle={
              row.recordedCount >= total
                ? "Your own recordings"
                : `${row.recordedCount} of ${total} recorded -- your phone's voice fills in the rest`
            }
            selected={voiceIdentifier === RECORDED_VOICE_IDENTIFIER}
            previewing={previewingKey === RECORDED_VOICE_IDENTIFIER}
            onPress={() => onSelectRow(RECORDED_VOICE_IDENTIFIER, RECORDED_VOICE_IDENTIFIER)}
          />
        );
      }
      if (row.kind === "persona") {
        const identifier = personaVoiceIdentifier(row.persona.id);
        return (
          <VoiceRow
            name={row.persona.name}
            subtitle={personasAvailable ? row.persona.description : "Voice not available yet"}
            selected={personasAvailable && voiceIdentifier === identifier}
            previewing={previewingKey === identifier}
            locked={!personasAvailable}
            onPress={() => onSelectRow(identifier, identifier)}
          />
        );
      }
      if (row.kind === "language") {
        const installed = row.voice;
        return (
          <VoiceRow
            name={row.entry.name}
            subtitle={
              installed
                ? `${installed.name} -- directions are spoken in this language`
                : "Not installed on this phone -- add it in your phone's text-to-speech settings"
            }
            enhanced={installed?.quality === "Enhanced"}
            selected={!!installed && voiceIdentifier === installed.identifier}
            previewing={!!installed && previewingKey === installed.identifier}
            locked={!installed}
            onPress={() => {
              if (installed) onSelectRow(installed.identifier, installed.identifier, row.entry.navLanguage);
            }}
          />
        );
      }
      const voice = row.voice;
      const selected = voiceIdentifier === voice.identifier;
      const previewing = previewingKey === voice.identifier;
      return (
        <VoiceRow
          name={voice.name}
          subtitle={voice.language ?? undefined}
          enhanced={voice.quality === "Enhanced"}
          selected={selected}
          previewing={previewing}
          // A voice in one of the supported languages brings its language with it, wherever in
          // this list it's picked from; any other voice reads English directions, as before.
          onPress={() => onSelectRow(voice.identifier, voice.identifier, navLanguageForVoiceLanguage(voice.language))}
        />
      );
    },
    [voiceIdentifier, previewingKey, onSelectRow, personasAvailable]
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search voices…"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Button
            variant="ghost"
            icon="close-circle"
            iconColor={colors.textFaint}
            onPress={() => setQuery("")}
            accessibilityLabel="Clear search"
          />
        )}
      </View>

      {!loaded ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : (
        <SectionList keyboardShouldPersistTaps="handled"
          sections={sections}
          keyExtractor={rowKey}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
              {section.title === "My recorded voices" && (
                <Pressable onPress={() => navigation.navigate("RecordVoice")} hitSlop={8}>
                  <Text style={styles.sectionHeaderAction}>Record your own</Text>
                </Pressable>
              )}
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.title === "My recorded voices" && section.data.length === 0 ? (
              <Text style={styles.emptySectionText}>
                No recorded voice yet. Tap &quot;Record your own&quot; above and record as many of the
                turn-by-turn phrases as you like -- your phone&apos;s voice fills in any you skip.
              </Text>
            ) : null
          }
          renderItem={({ item }) => renderRow(item)}
        />
      )}

      <Modal transparent visible={!!pendingSelection} animationType="fade" onRequestClose={() => setPendingSelection(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Use this voice?</Text>
            <Text style={styles.modalBody}>
              TrackLine will use this voice to speak your turn-by-turn directions and alerts.
            </Text>
            <View style={styles.modalActions}>
              <Button
                variant="secondary"
                label="Cancel"
                onPress={() => setPendingSelection(null)}
                style={{ flex: 1 }}
              />
              <Button
                variant="primary"
                label="Accept"
                onPress={confirmPendingSelection}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function VoiceRow({
  name,
  subtitle,
  selected,
  previewing,
  enhanced,
  locked,
  onPress,
}: {
  name: string;
  subtitle?: string;
  selected: boolean;
  previewing: boolean;
  enhanced?: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && !locked && styles.rowPressed, locked && styles.rowLocked]}
      onPress={onPress}
      disabled={locked}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowTitle, locked && styles.rowTitleLocked]} numberOfLines={1}>
            {name}
            {enhanced ? " ✦" : ""}
          </Text>
          {previewing && <Icon name="volume-high" size={14} color={colors.accent} />}
        </View>
        {!!subtitle && (
          <Text style={[styles.rowSubtitle, locked && styles.rowSubtitleLocked]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {locked ? (
        <Icon name="lock-outline" size={18} color={colors.textFaint} />
      ) : selected ? (
        <Icon name="checkmark-circle" size={22} color={colors.accent} />
      ) : (
        <View style={styles.rowRadio} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    ...shadow.low,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surfaceMuted,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sectionHeaderAction: { fontSize: 12, fontWeight: "700", color: colors.accent },
  emptySectionText: {
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  rowLocked: { opacity: 0.6 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowTitleLocked: { color: colors.textMuted },
  rowSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowSubtitleLocked: { color: colors.textFaint },
  rowRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.high,
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: colors.text, marginBottom: spacing.sm },
  modalBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, justifyContent: "flex-end" },
});
