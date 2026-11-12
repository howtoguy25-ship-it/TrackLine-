# yamnet-siren (local Expo Module)

Native bridge that runs Google's pretrained **YAMNet** TFLite audio classifier on-device
and exposes a `siren` confidence score to the JS `sirenDetection` service
(`src/services/sirenDetection.ts`).

## Status: real, implemented (not scaffolding)

Both `android/src/main/java/expo/modules/yamnetsiren/YamnetSirenModule.kt` and
`ios/YamnetSirenModule.swift` run real on-device inference:

- The real, pretrained model (`yamnet.tflite`, downloaded from
  [TensorFlow Hub's YAMNet page](https://tfhub.dev/google/lite-model/yamnet/tflite/1), licensed
  **Apache License 2.0** per that page's own "License" field) and its real 521-class AudioSet
  label map (`yamnet_class_map.csv`, from
  [TensorFlow's own research repo](https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv),
  also Apache-2.0 -- the whole `tensorflow/models` repo is licensed that way) are bundled
  directly in this module -- `android/src/main/assets/` and `ios/`, picked up by each platform's
  own build (Gradle's `assets` source set on Android, the `YamnetSiren.bundle` CocoaPods
  resource bundle declared in `YamnetSiren.podspec` on iOS). See COPYRIGHT_AUDIT.md (repo root)
  for the rest of this app's bundled third-party assets and their licenses.
- `loadModel()` loads the real model + real labels and reports true only once both are usable.
- `classifyFile(uri)` -- the real path `sirenDetection.ts` calls -- reads the actual recorded
  audio file, decodes + resamples it to real 16kHz mono PCM natively (`AVAudioFile` +
  `AVAudioConverter` on iOS, `MediaExtractor` + `MediaCodec` on Android -- Android's
  `MediaRecorder` has no raw PCM/WAV output option at all, so a real decode step is unavoidable
  there), then runs it through the real TFLite interpreter and returns YAMNet's real top-10
  class scores.
- `classify(pcmSamples)` is kept for contract-compatibility with any future caller that already
  has real decoded PCM floats in hand; the live detection loop uses `classifyFile` instead.
- Model contract (verified directly against the actual bundled `.tflite`, not assumed): a single
  dynamic-length float32 `waveform` input; exactly 15,600 samples (YAMNet's own documented
  0.975s minimum window at 16kHz) produces exactly one `[1, 521]` row of class scores.

## Building it

Native code, so this needs a real dev/prod build, not Expo Go:

```
npx expo prebuild
eas build --profile development --platform ios     # and/or android
```

`src/native/yamnetNative.ts` detects whether the native module is present at all
(`isYamnetAvailable`) and no-ops with a console warning if it's missing (e.g. still running in
Expo Go) -- the rest of the app (navigation, alerts, settings) works normally either way.

## Contract

```ts
loadModel(): Promise<boolean>
classify(pcmSamples: number[]): Promise<{ label: string; confidence: number }[]>
classifyFile(uri: string): Promise<{ label: string; confidence: number }[]>
```

`sirenDetection.ts` only looks at the siren/emergency-vehicle-related labels from the real
AudioSet class list ("Siren", "Emergency vehicle", "Police car (siren)", "Ambulance (siren)",
"Fire engine, fire truck (siren)") and ignores the rest.

## Known limitation (honest, not yet verified)

The native code here compiles against real, documented, stable APIs (TensorFlowLiteSwift's
`Interpreter`, `org.tensorflow:tensorflow-lite`'s `Interpreter`, `AVAudioConverter`,
`MediaCodec`) and was verified against the real model's actual input/output contract, but this
module's real-world detection accuracy -- whether it actually fires on a real siren and stays
quiet on ordinary road noise -- has not been confirmed on a physical device with a real siren
sound. That verification needs an actual device test; it cannot be done from source alone.
