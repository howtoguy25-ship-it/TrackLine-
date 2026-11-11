import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, StyleSheet, SectionList, Alert } from "react-native";
import { Text, TextInput } from "@/components/AppText";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import {
  VOICE_CLIP_SECTIONS,
  totalClipCount,
  getRecordedClipUris,
  saveRecordedClip,
  deleteRecordedClip,
  getRecordedVoiceName,
  setRecordedVoiceName,
  getCustomStartPhrases,
  addCustomStartPhrase,
  removeCustomStartPhrase,
  isCustomStartPhraseKey,
  CUSTOM_START_PHRASE_MAX_LENGTH,
  CUSTOM_START_PHRASE_MAX_COUNT,
  type VoiceClipDef,
} from "@/services/recordedVoices";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Real, explicit request (Waze-style redesign, Phase 3) -- the guided recorder: every real clip
// is MAX 6 SECONDS, auto-stop, with a countdown ring, real playback, re-record and delete. No
// clip is ever fabricated/synthesized -- every row either has a real local recording or it
// genuinely doesn't exist yet, shown honestly via the "x of N recorded" progress count.

const MAX_CLIP_DURATION_MS = 6000;
const RING_SIZE = 28;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function RecordVoiceScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [voiceName, setVoiceNameState] = useState("");
  const [recorded, setRecorded] = useState<Record<string, string>>({});
  const [activeRecordingKey, setActiveRecordingKey] = useState<string | null>(null);
  const [activePlaybackKey, setActivePlaybackKey] = useState<string | null>(null);
  // Start-of-drive phrases the driver has added themselves, and the one being typed.
  const [customPhrases, setCustomPhrases] = useState<VoiceClipDef[]>([]);
  const [newPhrase, setNewPhrase] = useState("");

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 100);
  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    getRecordedClipUris().then(setRecorded);
    getCustomStartPhrases().then(setCustomPhrases);
    getRecordedVoiceName().then((name) => {
      if (name) setVoiceNameState(name);
    });
    setAudioModeAsync({ allowsRecording: true }).catch(() => {});
  }, []);

  const onChangeVoiceName = useCallback((text: string) => {
    setVoiceNameState(text);
    setRecordedVoiceName(text).catch(() => {});
  }, []);

  const startRecording = useCallback(
    async (key: string) => {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert(
          "Microphone access needed",
          "TrackLine needs microphone access to record your own voice clips. You can enable it in your phone's Settings."
        );
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActiveRecordingKey(key);
    },
    [recorder]
  );

  // Real, confirmed fix (audit finding) -- this used to be declared AFTER the auto-stop effect
  // below that calls it, which a real lint/React-Compiler pass flagged as a genuine ordering
  // hazard. Declared here, before that effect, so there's no doubt about initialization order.
  const stopRecording = useCallback(async () => {
    const key = activeRecordingKey;
    await recorder.stop();
    setActiveRecordingKey(null);
    if (!key || !recorder.uri) return;
    const savedUri = await saveRecordedClip(key, recorder.uri, user && !user.isAnonymous ? user.uid : null);
    setRecorded((prev) => ({ ...prev, [key]: savedUri }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecordingKey, recorder, user]);

  // Real auto-stop at 6 seconds -- recorderState.durationMillis is the recorder's own live,
  // real elapsed time, polled every 100ms (see useAudioRecorderState's interval above).
  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_CLIP_DURATION_MS) {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.isRecording, recorderState.durationMillis]);

  const onPlay = useCallback(
    (key: string) => {
      const uri = recorded[key];
      if (!uri) return;
      player.replace({ uri });
      player.play();
      setActivePlaybackKey(key);
    },
    [recorded, player]
  );

  const onDelete = useCallback((key: string) => {
    Alert.alert("Delete recording?", "This real clip will be removed for good.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteRecordedClip(key);
          setRecorded((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        },
      },
    ]);
  }, []);

  const onAddPhrase = useCallback(async () => {
    const next = await addCustomStartPhrase(newPhrase);
    if (!next) return;
    setCustomPhrases(next);
    setNewPhrase("");
  }, [newPhrase]);

  const onRemovePhrase = useCallback((clip: VoiceClipDef) => {
    Alert.alert("Remove this phrase?", `"${clip.label}" and its recording will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setCustomPhrases(await removeCustomStartPhrase(clip.key));
          setRecorded((prev) => {
            const next = { ...prev };
            delete next[clip.key];
            return next;
          });
        },
      },
    ]);
  }, []);

  const recordedCount = Object.keys(recorded).length;
  const total = totalClipCount() + customPhrases.length;

  // The driver's own start phrases sit in "Start of drive", right after the two built-in ones.
  const sections = useMemo(
    () =>
      VOICE_CLIP_SECTIONS.map((s) => ({
        title: s.title,
        data: s.title === "Start of drive" ? [...s.clips, ...customPhrases] : s.clips,
      })),
    [customPhrases]
  );
  const canAddPhrase =
    newPhrase.trim().length > 0 && customPhrases.length < CUSTOM_START_PHRASE_MAX_COUNT && activeRecordingKey === null;

  const renderClip = useCallback(
    (clip: VoiceClipDef) => {
      const isRecordingThis = activeRecordingKey === clip.key;
      const isPlayingThis = activePlaybackKey === clip.key && playerStatus.playing;
      const hasClip = !!recorded[clip.key];
      const progress = isRecordingThis ? Math.min(1, recorderState.durationMillis / MAX_CLIP_DURATION_MS) : 0;

      return (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{clip.label}</Text>
            {isRecordingThis && (
              <Text style={styles.rowSubtitle}>
                {Math.max(0, Math.ceil((MAX_CLIP_DURATION_MS - recorderState.durationMillis) / 1000))}s left
              </Text>
            )}
          </View>

          {isRecordingThis ? (
            <Pressable onPress={stopRecording} style={styles.ringButton} accessibilityLabel="Stop recording">
              <Svg width={RING_SIZE} height={RING_SIZE}>
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke={colors.border}
                  strokeWidth={RING_STROKE}
                  fill="none"
                />
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  stroke={colors.danger}
                  strokeWidth={RING_STROKE}
                  fill="none"
                  strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                  strokeLinecap="round"
                  rotation={-90}
                  origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
                />
              </Svg>
              <View style={styles.ringInnerDot} />
            </Pressable>
          ) : (
            <View style={styles.rowActions}>
              {hasClip && (
                <>
                  <Pressable onPress={() => onPlay(clip.key)} hitSlop={8} accessibilityLabel="Play">
                    <Ionicons
                      name={isPlayingThis ? "pause-circle" : "play-circle"}
                      size={26}
                      color={colors.accent}
                    />
                  </Pressable>
                  <Pressable onPress={() => onDelete(clip.key)} hitSlop={8} accessibilityLabel="Delete recording">
                    <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                  </Pressable>
                </>
              )}
              {isCustomStartPhraseKey(clip.key) && (
                <Pressable onPress={() => onRemovePhrase(clip)} hitSlop={8} accessibilityLabel="Remove this phrase">
                  <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                </Pressable>
              )}
              <Pressable
                onPress={() => startRecording(clip.key)}
                style={({ pressed }) => [styles.recordButton, pressed && { opacity: pressedOpacity }]}
                disabled={activeRecordingKey !== null}
              >
                <Ionicons name={hasClip ? "refresh" : "mic"} size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          )}
        </View>
      );
    },
    [
      activeRecordingKey,
      activePlaybackKey,
      playerStatus.playing,
      recorded,
      recorderState.durationMillis,
      stopRecording,
      startRecording,
      onPlay,
      onDelete,
      onRemovePhrase,
    ]
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Name this voice</Text>
        <TextInput
          value={voiceName}
          onChangeText={onChangeVoiceName}
          placeholder="e.g. My own voice"
          placeholderTextColor={colors.textFaint}
          style={styles.nameInput}
        />
        <Text style={styles.progressText}>
          {recordedCount} of {total} recorded
        </Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(clip) => clip.key}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderSectionFooter={({ section }) =>
          section.title === "Start of drive" ? (
            <View style={styles.addPhraseRow}>
              <TextInput
                value={newPhrase}
                onChangeText={setNewPhrase}
                placeholder={
                  customPhrases.length >= CUSTOM_START_PHRASE_MAX_COUNT
                    ? `That's the most you can add (${CUSTOM_START_PHRASE_MAX_COUNT})`
                    : "Add your own start phrase…"
                }
                placeholderTextColor={colors.textFaint}
                style={styles.addPhraseInput}
                maxLength={CUSTOM_START_PHRASE_MAX_LENGTH}
                editable={customPhrases.length < CUSTOM_START_PHRASE_MAX_COUNT}
                returnKeyType="done"
                onSubmitEditing={onAddPhrase}
              />
              <Pressable
                onPress={onAddPhrase}
                disabled={!canAddPhrase}
                style={({ pressed }) => [
                  styles.addPhraseButton,
                  !canAddPhrase && styles.addPhraseButtonDisabled,
                  pressed && { opacity: pressedOpacity },
                ]}
                accessibilityLabel="Add phrase"
              >
                <Ionicons name="add" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => renderClip(item)}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceMuted },
  header: { padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.xs },
  headerLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  nameInput: {
    fontSize: 16,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  progressText: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surfaceMuted,
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
  rowLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 12, color: colors.danger, marginTop: 2 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  recordButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhraseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  addPhraseInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: spacing.xs },
  addPhraseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhraseButtonDisabled: { backgroundColor: colors.border },
  ringButton: { width: RING_SIZE, height: RING_SIZE, alignItems: "center", justifyContent: "center" },
  ringInnerDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
});
