import { loadTensorflowModel, type TensorflowModel } from "react-native-fast-tflite";
import { NitroModules, type BoxedHybridObject } from "react-native-nitro-modules";
import { Sentry } from "@/services/sentry";

// TFLite_Detection_PostProcess SSD MobileNet v2 (COCO, quantized) -- real, explicit request for
// the strongest accuracy upgrade available while staying a real-time, on-device, drop-in swap:
// v2's deeper backbone (vs. the v1 model this replaced) is the well-documented, better-accuracy
// step up within the exact same SSD/MobileNet/TFLite_Detection_PostProcess family, so the app's
// entire downstream pipeline (frame preprocessing, output parsing, box math) needed zero
// structural changes -- only the model file and the class-id mapping (see VehicleDetectionScreen.tsx's
// own comment on that) actually differ. Sourced from Google Coral's own official, public test-data
// distribution of this exact model (google-coral/edgetpu, Apache-2.0) -- the same real, standard
// TF1-object-detection-API export pipeline used to originally build this family of models, not a
// third-party retrain. Verified directly against the downloaded .tflite file's own FlatBuffer
// tensors before this swap (not assumed): input tensor is [1,300,300,3] uint8 (matches
// TFLITE_INPUT_SIZE below exactly), and all 4 outputs are named TFLite_Detection_PostProcess(:1/
// :2/:3) -- the identical custom op, in the identical order, this app's parsing code already
// expects. Bundled directly (see metro.config.js's .tflite asset registration) so the very first
// open has zero network dependency, same reasoning as the old tfjs model bundling this replaces.
// Its 4-tensor output format (boxes/classes/scores/count) and the RAW (no offset) 0-indexed COCO
// class ids it was trained on are documented next to where they're parsed, inside the Frame
// Processor in VehicleDetectionScreen.tsx -- see assets/models/tflite_ssd_mobilenet_v2/labelmap.txt
// for the model's full class list.
const MODEL_ASSET = require("../../assets/models/tflite_ssd_mobilenet_v2/model.tflite");

export const TFLITE_INPUT_SIZE = 300;

let boxedModelPromise: Promise<BoxedHybridObject<TensorflowModel>> | null = null;

// Boxed once here (not inside the Frame Processor) so every call after the first just returns
// the same cached, already-boxed model. NitroModules.box() specifically exists so a Nitro
// HybridObject created on the JS thread (loadTensorflowModel resolves here) can still be safely
// referenced from inside a separate worklet Runtime -- this app's Frame Processor runs on
// react-native-worklets-core's own Runtime, which (per NitroModules' own documentation) doesn't
// yet support copying HybridObjects via its newer JSI NativeState APIs without this explicit
// box()/.unbox() step.
// Real, explicit request for faster/stronger detection ("connects quicker"). 'core-ml' routes
// this model's actual conv backbone (the vast majority of its real compute) to the iPhone's own
// GPU/Neural Engine via Apple's Core ML delegate -- TFLite_Detection_PostProcess itself is a
// custom op Core ML's delegate can't compile, but TFLite's own delegate mechanism partitions the
// graph automatically: whatever IS Core ML-compatible (the backbone) still runs accelerated, and
// only that small custom postprocess node falls back to CPU -- this is the standard, well-
// documented way this exact model family gets accelerated on iOS, not a guess specific to this
// app. A faster per-frame forward pass means the Frame Processor's own throttle (see
// FRAME_PROCESSOR_THROTTLE_MS in VehicleDetectionScreen.tsx) is less often the bottleneck,
// translating directly into a tighter, less laggy lock onto a moving vehicle. Falls back to the
// previously-shipped plain CPU delegate ([]) if Core ML delegate creation itself fails for any
// reason (e.g. an iOS/device combination that can't compile it at all) -- explicit, in-process
// fallback here rather than leaning on VehicleDetectionScreen's own load-retry loop, since that
// loop would otherwise just keep retrying the same failing delegate forever instead of ever
// reaching a working configuration.
export function loadBoxedTFLiteModel(): Promise<BoxedHybridObject<TensorflowModel>> {
  if (!boxedModelPromise) {
    const tStart = Date.now();
    boxedModelPromise = loadTensorflowModel(MODEL_ASSET, ["core-ml"])
      .catch((err) => {
        Sentry.logger.warn("tfliteVehicleModel: core-ml delegate failed, falling back to CPU", {
          error: String(err),
        });
        return loadTensorflowModel(MODEL_ASSET, []);
      })
      .then((model) => {
        Sentry.logger.info("perf: tfliteVehicleModel.load", {
          ms: Date.now() - tStart,
          delegates: model.delegates,
        });
        return NitroModules.box(model);
      })
      .catch((err) => {
        Sentry.logger.error("tfliteVehicleModel: load failed", { error: String(err) });
        boxedModelPromise = null;
        throw err;
      });
  }
  return boxedModelPromise;
}
