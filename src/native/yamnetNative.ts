import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export interface ClassificationResult {
  label: string;
  confidence: number;
}

interface YamnetSirenNativeModule {
  /** Loads the bundled yamnet.tflite model. Safe to call multiple times. */
  loadModel(): Promise<boolean>;
  /**
   * Runs inference on one ~1s window of mono 16kHz PCM float samples and returns the
   * top classification results (label + confidence), matching YAMNet's 521 AudioSet classes.
   * Kept for contract-compatibility with direct-PCM callers; sirenDetection.ts uses
   * classifyFile below instead, since this app never has raw PCM on hand (see its own comment).
   */
  classify(pcmSamples: number[]): Promise<ClassificationResult[]>;
  /**
   * Real end-to-end path: reads the real recorded audio file at `uri` (whatever compressed
   * format expo-audio's recorder actually produced -- AAC/m4a on both platforms), decodes and
   * resamples it to real 16kHz mono PCM natively (AVFoundation on iOS, MediaCodec on Android),
   * then classifies it. Returns the same shape as classify().
   */
  classifyFile(uri: string): Promise<ClassificationResult[]>;
}

// This native module is provided by the local "yamnet-siren" Expo module (see
// /modules/yamnet-siren). It only exists in a custom dev/prod build produced via
// `expo prebuild` + EAS Build — it is NOT available in Expo Go. When it's missing we
// fall back to a no-op stub so the rest of the app still runs; siren detection simply
// stays inactive and logs a warning instead of crashing.
const nativeModule = requireOptionalNativeModule<YamnetSirenNativeModule>("YamnetSiren");

export const isYamnetAvailable = !!nativeModule;

export const YamnetSiren: YamnetSirenNativeModule = nativeModule ?? {
  async loadModel() {
    console.warn(
      "[yamnet] Native YamnetSiren module not found. Siren detection requires an Expo " +
        "Dev Build (expo prebuild + EAS Build) — it does not run in Expo Go. " +
        `Platform: ${Platform.OS}.`
    );
    return false;
  },
  async classify() {
    return [];
  },
  async classifyFile() {
    return [];
  },
};
