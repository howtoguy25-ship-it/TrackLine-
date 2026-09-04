import React, { useCallback, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Keyboard } from "react-native";
import { Camera, useCameraDevice, useCameraPermission, type PhotoFile } from "react-native-vision-camera";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { recognizeVinFromPhoto, recognizePlateFromPhoto } from "@/services/documentScan";
import { AU_STATES, DEFAULT_AU_STATE } from "@/utils/auStates";
import { colors, radius, shadow, spacing, pressedOpacity } from "@/theme/tokens";
import type { RootStackParamList } from "@/navigation/RootNavigator";

// vision-camera's PhotoFile.path is a bare filesystem path, not a URI -- same fix
// VehicleDetectionScreen's own toFileUri already applies for the same reason.
function toFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

type ScanStage = "camera" | "processing" | "confirm" | "notFound";

// Real, explicit request: "add real camera capture take photo for vin number and license
// registration 2 seperate sections and cameras built for each other" -- one screen, driven by
// `mode`, so the two really are two distinct, purpose-built capture experiences (own title, own
// guide overlay shape, own OCR target, own confirm step) without duplicating the entire camera/
// permission/capture machinery twice. Reached from RevCheckScreen's own "Scan plate"/"Scan VIN"
// buttons next to its manual entry fields.
export function DocumentScanScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "DocumentScan">>();
  const mode = route.params.mode;
  const isVin = mode === "vin";
  const insets = useSafeAreaInsets();

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  const cameraRef = useRef<Camera>(null);

  const [stage, setStage] = useState<ScanStage>("camera");
  const [editedValue, setEditedValue] = useState("");
  const [plateState, setPlateState] = useState(DEFAULT_AU_STATE);
  const [capturing, setCapturing] = useState(false);

  const onCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    setStage("processing");
    try {
      const photo: PhotoFile = await cameraRef.current.takePhoto({ enableShutterSound: false });
      const uri = toFileUri(photo.path);
      const value = isVin ? await recognizeVinFromPhoto(uri) : await recognizePlateFromPhoto(uri);
      if (value) {
        setEditedValue(value);
        setStage("confirm");
      } else {
        setStage("notFound");
      }
    } catch {
      setStage("notFound");
    } finally {
      setCapturing(false);
    }
  }, [isVin, capturing]);

  const onRetake = useCallback(() => {
    setEditedValue("");
    setStage("camera");
  }, []);

  const onUse = useCallback(() => {
    const trimmed = editedValue.trim().toUpperCase();
    if (!trimmed) return;
    // Navigating to a screen already on the stack pops back to that existing instance with
    // merged params, rather than pushing a duplicate -- RevCheckScreen is always the screen
    // that opened this one. Its own effects (added alongside these buttons) sync `plate`/`vin`/
    // `state` from route.params on every change, not just first mount, so this round-trip
    // actually lands in the visible text fields there.
    navigation.navigate("RevCheck", isVin ? { vin: trimmed } : { plate: trimmed, state: plateState });
  }, [editedValue, isVin, plateState, navigation]);

  const onClose = useCallback(() => navigation.goBack(), [navigation]);

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          TrackLine needs camera access to scan a {isVin ? "VIN" : "plate"}.
        </Text>
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant camera access</Text>
        </Pressable>
        <Pressable onPress={onClose}>
          <Text style={styles.closeLink}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator color="#FFFFFF" />
        <Text style={styles.permissionText}>Looking for a camera…</Text>
        <Pressable onPress={onClose}>
          <Text style={styles.closeLink}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* isActive only while actually framing a shot -- paused during processing/confirm/
          notFound so the session isn't burning power on a preview nobody's looking at. */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={stage === "camera"}
        photo={true}
        photoQualityBalance="quality"
      />

      <View style={[styles.header, { top: insets.top + spacing.md }]}>
        <Pressable style={styles.headerButton} onPress={onClose} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>{isVin ? "Scan VIN" : "Scan plate"}</Text>
        <View style={styles.headerButton} />
      </View>

      {stage === "camera" && (
        <>
          <View pointerEvents="none" style={styles.guideWrap}>
            <View style={[styles.guideBox, isVin ? styles.guideBoxVin : styles.guideBoxPlate]} />
            <Text style={styles.guideText}>
              {isVin
                ? "Line up the VIN -- compliance plate, windshield etch, or rego papers"
                : "Line up the number plate"}
            </Text>
          </View>
          <View style={[styles.captureRow, { bottom: insets.bottom + spacing.xl }]}>
            <Pressable style={styles.captureButton} onPress={onCapture} accessibilityLabel="Take photo">
              <View style={styles.captureButtonInner} />
            </Pressable>
          </View>
        </>
      )}

      {stage === "processing" && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.overlayText}>Reading {isVin ? "VIN" : "plate"}…</Text>
        </View>
      )}

      {stage === "notFound" && (
        <View style={styles.overlay}>
          <MaterialCommunityIcons name="alert-circle-outline" size={40} color="#FFFFFF" />
          <Text style={styles.overlayText}>
            Couldn't read a {isVin ? "VIN" : "plate"} from that photo -- move closer, fill the
            guide box, and avoid glare, then try again.
          </Text>
          <Pressable style={styles.retakeButton} onPress={onRetake}>
            <Text style={styles.retakeButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {stage === "confirm" && (
        <View style={[styles.confirmCard, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.confirmLabel}>{isVin ? "VIN READ -- CHECK IT'S RIGHT" : "PLATE READ -- CHECK IT'S RIGHT"}</Text>
          <TextInput
            value={editedValue}
            onChangeText={(t) => setEditedValue(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={isVin ? 17 : 10}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            style={styles.confirmInput}
          />

          {!isVin && (
            <>
              <Text style={styles.confirmSubLabel}>STATE / TERRITORY</Text>
              <View style={styles.stateGrid}>
                {AU_STATES.map((s) => {
                  const isSelected = plateState === s.code;
                  return (
                    <Pressable
                      key={s.code}
                      onPress={() => setPlateState(s.code)}
                      style={({ pressed }) => [
                        styles.stateChip,
                        isSelected && styles.stateChipSelected,
                        pressed && { opacity: pressedOpacity },
                      ]}
                      accessibilityLabel={s.label}
                    >
                      <Text style={[styles.stateChipText, isSelected && styles.stateChipTextSelected]}>
                        {s.code}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {isVin && (
            <Text style={styles.confirmHelper}>
              A REV check also needs a plate -- enter or scan one on the next screen if you
              haven't already.
            </Text>
          )}

          <View style={styles.confirmButtons}>
            <Pressable
              style={({ pressed }) => [styles.retakeButton, pressed && { opacity: pressedOpacity }]}
              onPress={onRetake}
            >
              <Text style={styles.retakeButtonText}>Retake</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.useButton,
                !editedValue.trim() && styles.useButtonDisabled,
                pressed && !!editedValue.trim() && { opacity: pressedOpacity },
              ]}
              onPress={onUse}
              disabled={!editedValue.trim()}
            >
              <Text style={styles.useButtonText}>Use this {isVin ? "VIN" : "plate"}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  permissionContainer: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  permissionText: { color: "#FFFFFF", fontSize: 15, textAlign: "center" },
  permissionButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  permissionButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  closeLink: { color: "#9CA3AF", fontSize: 14, marginTop: spacing.sm },
  header: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  guideWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  guideBox: {
    borderWidth: 3,
    borderColor: "#FFFFFF",
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  // Real plate aspect ratio (see plateLocator.ts's own PLATE_ASPECT_RATIO) -- wide and short.
  guideBoxPlate: { width: "78%", aspectRatio: 2.7 },
  // VINs are printed in plenty of real, different places (compliance plate, windshield etch,
  // rego papers) with no single universal shape -- a slightly taller, less extreme rectangle
  // than the plate guide, general enough to frame any of them close-up.
  guideBoxVin: { width: "82%", aspectRatio: 3.4 },
  guideText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 4,
  },
  captureRow: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  overlayText: { color: "#FFFFFF", fontSize: 14, textAlign: "center", lineHeight: 20 },
  confirmCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.high,
  },
  confirmLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  confirmInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 52,
    fontSize: 18,
    fontWeight: "800",
    fontFamily: "monospace",
    letterSpacing: 1.5,
    color: colors.text,
  },
  confirmSubLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
  confirmHelper: { fontSize: 12, color: colors.textFaint, lineHeight: 16 },
  stateGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  stateChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: "transparent",
  },
  stateChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  stateChipText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  stateChipTextSelected: { color: "#FFFFFF" },
  confirmButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  retakeButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  retakeButtonText: { fontSize: 14, fontWeight: "700", color: colors.text },
  useButton: {
    flex: 2,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  useButtonDisabled: { backgroundColor: colors.textFaint },
  useButtonText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
});
