import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as jpeg from "jpeg-js";
import { File } from "expo-file-system";
import { ImageManipulator } from "expo-image-manipulator";
import { ensureTfReady } from "@/services/tfPlatform";
import { cachedModelIO } from "@/services/cachedModelIO";
import { bundledModelIO } from "@/services/modelAssetIO";
import { Sentry } from "@/services/sentry";

// Bundled directly into the app binary (require()'d so Metro packages these as local assets --
// see metro.config.js's .bin registration and modelAssetIO.ts) -- the real fix for "loads
// immediately," ahead of App Store submission: cachedModelIO's disk cache only helps from the
// *second* launch onward, so every fresh install's very first vehicle-detection open still had
// to fetch ~18MB from Google's CDN over the network before anything could load, with no bound
// on how slow/flaky that connection might be (exactly what an App Store reviewer or a driver on
// weak cellular could hit first). Bundling the same model.json + weight shards this app already
// fetches at runtime means the very first launch loads with zero network dependency at all,
// identical file bytes either way.
// Named model.json.bin (not model.json) deliberately -- Metro's default sourceExts already
// includes "json", meaning a plain require(".../model.json") would be parsed inline as a JS
// object at bundle time, not treated as a Metro *asset* the way modelAssetIO.ts's
// Asset.fromModule() needs (a numeric asset module id it can resolve to a local file URI).
// The ".bin" extension (registered as an assetExt in metro.config.js) is what makes this
// resolve as an asset; expo-file-system's File.json() parses it as JSON regardless of its
// actual file extension once downloaded, so the renamed file's content is unchanged.
const bundledCocoSsdModelJson = require("../../assets/models/ssdlite_mobilenet_v2/model.json.bin");
const bundledCocoSsdWeights = [
  require("../../assets/models/ssdlite_mobilenet_v2/group1-shard1of5.bin"),
  require("../../assets/models/ssdlite_mobilenet_v2/group1-shard2of5.bin"),
  require("../../assets/models/ssdlite_mobilenet_v2/group1-shard3of5.bin"),
  require("../../assets/models/ssdlite_mobilenet_v2/group1-shard4of5.bin"),
  require("../../assets/models/ssdlite_mobilenet_v2/group1-shard5of5.bin"),
];

// COCO-SSD fetches its own base model (several MB, model.json + weight shards) from
// Google's CDN on every single load by default -- there's no persistent cache without this,
// since tfPlatform.ts's minimal shim doesn't register one the way a browser's IndexedDB-
// backed handler would. cachedModelIO (below) intercepts that fetch and routes it through an
// on-device disk cache instead, so only the very first vehicle-detection session ever touches
// the network for this.
//
// This used to be wired up via tf.io.registerLoadRouter(), which registers a *global* router
// that competes with tfjs-core's own built-in generic HTTP router (also always registered,
// also matches any https:// URL). With two routers both claiming the same model URL, tfjs's
// router registry throws "Found more than one (2) load handlers for URL ..." -- confirmed
// exactly this error from a real device. Fixed by not registering a competing router at all:
// loadGraphModel (which coco-ssd calls internally) accepts either a URL string or an IOHandler
// directly, so the cached handler is passed straight in as `modelUrl` below instead.
const COCO_SSD_BASE = "lite_mobilenet_v2" as const;
// Matches coco-ssd's own BASE_PATH + getPrefix(base) + "/model.json" for this base model --
// see @tensorflow-models/coco-ssd's index.js. Not configurable, so safe to hardcode here.
const COCO_SSD_MODEL_URL =
  "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json";

// COCO-SSD (the pretrained model this runs) only knows generic COCO classes — "car" /
// "truck" / "bus" / "motorcycle" -- not "police car" or "ambulance". This app used to run a
// second, custom-trained classifier (src/services/vehicleClassifier.ts, still present but no
// longer called from here) behind each box to guess ambulance/firetruck/police-car. Dropped
// for the same reason the web app already dropped its identical model: repeated real-world
// testing kept producing confidently-wrong "Police car" results on ordinary cars even after
// tightening its confidence bar twice -- a ~500-image training set just isn't enough to be
// honest about on a live phone camera. Generic labels plus the real, evidence-based lightbar
// flash detector (lightbarDetector.ts) below replace it, matching
// web/src/components/LiveVehicleDetection.tsx's own fix.
const VEHICLE_CLASSES = new Set(["car", "truck", "bus", "motorcycle"]);
const HEAVY_VEHICLE_CLASSES = new Set(["truck", "bus"]);

export interface VehicleBox {
  label: "Vehicle" | "Heavy Vehicle";
  score: number;
  // [x, y, width, height] in pixels, relative to the source image dimensions.
  bbox: [number, number, number, number];
}

export interface DecodedPhoto {
  width: number;
  height: number;
  // RGB, 3 bytes per pixel -- shared between COCO-SSD detection and the lightbar flash
  // sampler below so a single capture only ever gets JPEG-decoded once.
  data: Uint8Array;
}

// coco-ssd's own load() isn't just a download -- it also runs a real warmup inference (a
// tf.zeros([1,300,300,3]) tensor through the *entire* SSD-MobileNet graph, awaiting every
// output tensor's .data()) before resolving. On this app's CPU-only tfjs backend (no WebGL/GPU
// acceleration -- that needs expo-gl + real device verification, a bigger, riskier change than
// this) that warmup pass is a genuinely heavy synchronous-ish computation, and was almost all
// of "takes long to load" -- the actual network fetch (especially once disk-cached) is fast.
// Below skips that warmup entirely and only does the fetch/parse, matching the "load
// immediately" ask directly: the model graph exists but nothing has run through it yet, so the
// very first real detection pass (in detectVehiclesInPhoto) absorbs that one-time compute
// instead of a dedicated loading screen doing it up front. That trade -- a slightly slower
// first detected frame vs. a screen that's immediately live and interactive (Close/Switch
// camera responsive right away, not fighting a blocked JS thread) -- is a straightforward win
// for how this feature is actually used.
async function loadModelSkippingWarmup(): Promise<cocoSsd.ObjectDetection> {
  const tStart = Date.now();
  Sentry.logger.info("vehicleDetection: loadModelSkippingWarmup start");
  const objectDetection = new cocoSsd.ObjectDetection(COCO_SSD_BASE);

  let model: tf.GraphModel;
  try {
    // Primary path: the exact same model file, already bundled into the app binary -- zero
    // network involved, so this resolves in however long it takes to read ~18MB off local
    // disk (effectively instant), not however long the user's connection to Google's CDN
    // happens to take on any given launch.
    const tBundledStart = Date.now();
    model = await tf.loadGraphModel(
      bundledModelIO(bundledCocoSsdModelJson, bundledCocoSsdWeights, "graph-model")
    );
    Sentry.logger.info("perf: vehicleDetection.bundledModelLoad", { ms: Date.now() - tBundledStart });
  } catch (err) {
    // Defensive fallback only -- the bundled assets are always present in a real build (they're
    // require()'d above, so Metro can't produce a build missing them), but this keeps the
    // previously-working network+disk-cache path as a safety net rather than a hard failure if
    // the bundled read ever does fail for some unforeseen reason.
    Sentry.logger.error("vehicleDetection: bundled model load failed, falling back to network", {
      error: String(err),
    });
    console.warn("[vehicleDetection] bundled model load failed, falling back to network", err);
    const tNetworkStart = Date.now();
    model = await tf.loadGraphModel(cachedModelIO(COCO_SSD_MODEL_URL, "ssdlite_mobilenet_v2"));
    Sentry.logger.info("perf: vehicleDetection.networkModelLoad", { ms: Date.now() - tNetworkStart });
  }

  // ObjectDetection.model is only "private" in its .d.ts -- a real, plain instance property
  // at runtime, which is exactly what coco-ssd's own load() sets it to internally. Only
  // reaching around the type here to skip the warmup call load() would otherwise also do.
  (objectDetection as unknown as { model: tf.GraphModel }).model = model;
  Sentry.logger.info("perf: vehicleDetection.loadModelSkippingWarmupTotal", { ms: Date.now() - tStart });
  return objectDetection;
}

const MODEL_LOAD_TIMEOUT_MS = 25000;

let modelPromise: Promise<cocoSsd.ObjectDetection> | null = null;

function loadModel(): Promise<cocoSsd.ObjectDetection> {
  if (!modelPromise) {
    const tReadyStart = Date.now();
    modelPromise = ensureTfReady()
      .then(() => {
        Sentry.logger.info("perf: vehicleDetection.ensureTfReady", { ms: Date.now() - tReadyStart });
        return loadModelSkippingWarmup();
      })
      .catch((err) => {
        // Don't leave a permanently-rejected promise cached -- without this, one failed
        // load (a network blip, a cold CDN fetch that timed out) would keep failing
        // instantly forever, even after connectivity recovers, until the app fully restarts.
        Sentry.logger.error("vehicleDetection: loadModel failed", { error: String(err) });
        modelPromise = null;
        throw err;
      });
  }
  return modelPromise;
}

export async function warmUpModel(): Promise<void> {
  const tStart = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      Sentry.logger.error("vehicleDetection: warmUpModel timed out", { timeoutMs: MODEL_LOAD_TIMEOUT_MS });
      reject(
        new Error(
          "Detection model is taking unusually long to load -- check your connection, or try again."
        )
      );
    }, MODEL_LOAD_TIMEOUT_MS);
  });
  try {
    await Promise.race([loadModel(), timeout]);
    Sentry.logger.info("perf: vehicleDetection.warmUpModelTotal", { ms: Date.now() - tStart });
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/** Decodes a captured JPEG photo into raw RGB pixels, without the unmaintained
 *  @tensorflow/tfjs-react-native's decodeJpeg -- jpeg-js is a plain, actively-maintained
 *  pure-JS decoder with no native/platform dependency of its own. */
export async function decodePhotoForDetection(uri: string): Promise<DecodedPhoto> {
  const tReadStart = Date.now();
  const buffer = await new File(uri).arrayBuffer();
  const tDecodeStart = Date.now();
  Sentry.logger.info("perf: vehicleDetection.fileRead", { ms: tDecodeStart - tReadStart });
  const { width, height, data } = jpeg.decode(new Uint8Array(buffer), {
    useTArray: true,
    formatAsRGBA: false,
  });
  Sentry.logger.info("perf: vehicleDetection.jpegDecode", { ms: Date.now() - tDecodeStart });
  // Real, confirmed-possible failure mode: formatAsRGBA: false isn't honored for every JPEG
  // variant a real phone camera can produce (chroma subsampling mode, in particular), and
  // jpeg-js just returns whatever it actually decoded regardless of what was asked for. Left
  // unchecked, that mismatched byte length would either throw deep inside tf.tensor3d's own
  // shape validation (a much less diagnosable error than this one) or, worse, get silently
  // reinterpreted against the wrong shape -- garbage pixel data the model can genuinely never
  // detect anything real in, with no thrown error to ever surface as feedback. Caught here with
  // a clear, specific message instead, and treated as a real capture failure (retried on the
  // next tick, same as any other) rather than quietly feeding the model nonsense.
  const expectedLength = width * height * 3;
  if (data.length !== expectedLength) {
    Sentry.logger.error("vehicleDetection: decoded pixel data size mismatch", {
      width,
      height,
      expectedLength,
      actualLength: data.length,
    });
    throw new Error(
      `Decoded photo has ${data.length} bytes, expected ${expectedLength} for ${width}x${height} RGB`
    );
  }
  return { width, height, data };
}

// Real, confirmed regression this was raised to fix WITHOUT reintroducing (see
// VehicleDetectionScreen.tsx's own photoResolution comment): jpeg.decode() above is a pure-JS
// decode, and its cost is directly proportional to total pixel count -- decoding a full capture
// at true 4K on every ~0.9-1.4s side-capture tick caused real, confirmed on-device lag. The
// lightbar flash sampler (lightbarDetector.ts) only needs to tell whether a small crop near a
// vehicle's roofline is showing a strobing red/blue color -- it never needed full-resolution
// detail, it was just riding along on the same decode the plate-crop coordinate math used to
// need too (mapUprightBoxToRawPhoto's rawWidth/rawHeight -- now sourced from the PhotoFile's own
// already-known width/height metadata instead, see captureForPlateAndLightbar, so nothing else
// needs this function's full decode anymore). Resizing down to a small, FIXED width first (a
// native, hardware-accelerated resize via expo-image-manipulator -- the same real crop pipeline
// plateOcr.ts already uses, not a JS operation) means this decode's cost stays pinned to that
// small size regardless of how high photoResolution is set, so the still-photo capture is free
// to be genuinely high-res for plate/zoom clarity without paying for it here.
const LIGHTBAR_SAMPLE_WIDTH = 640;

/** Same as decodePhotoForDetection, but decodes a small, natively-resized copy of the photo
 *  instead of the original -- see LIGHTBAR_SAMPLE_WIDTH's own comment for why. Returned
 *  dimensions are the RESIZED image's own (preserving the original's aspect ratio), not the
 *  original photo's -- any bbox passed alongside this result needs to be scaled to match. */
export async function decodePhotoForLightbarSampling(uri: string): Promise<DecodedPhoto> {
  const resized = await ImageManipulator.manipulate(uri).resize({ width: LIGHTBAR_SAMPLE_WIDTH }).renderAsync();
  const saved = await resized.saveAsync();
  try {
    return await decodePhotoForDetection(saved.uri);
  } finally {
    // Same best-effort temp-file cleanup as plateOcr.ts's own crop -- this resize writes a
    // brand-new file to disk on every side-capture tick, and never deleting it would leak one
    // small JPEG per tick for the entire length of a driving session.
    try {
      new File(saved.uri).delete();
    } catch {}
  }
}

/** Runs detection on an already-decoded photo (see decodePhotoForDetection) and returns
 *  generic vehicle-class boxes. */
// coco-ssd's own default (0.5) was tuned for general-purpose accuracy across all 90 COCO
// classes on a clean, close, well-lit reference photo -- real-world dashcam-style conditions
// (a vehicle at a real driving distance, partial occlusion by foliage/other cars, shooting
// through glass/a window screen, glare) push a real, present vehicle's score below that more
// often than not on this app's smallest/fastest base model (lite_mobilenet_v2). Lowered to a
// still-reasonable 0.35 -- a real, direct trade of a few more false positives for meaningfully
// fewer real vehicles going completely undetected, which is the failure mode actually reported.
const MIN_DETECTION_SCORE = 0.35;

export async function detectVehiclesInPhoto(photo: DecodedPhoto): Promise<VehicleBox[]> {
  const tLoadStart = Date.now();
  const model = await loadModel();
  const tLoadMs = Date.now() - tLoadStart;
  // Only logged when non-trivial -- loadModel() resolves near-instantly on every call after
  // the very first (it's just returning the already-cached modelPromise), so a real number
  // here on anything but the first-ever capture is itself a signal something's wrong (the
  // module-level cache not actually holding, e.g.).
  if (tLoadMs > 5) Sentry.logger.info("perf: vehicleDetection.loadModelAwait", { ms: tLoadMs });

  const tTensorStart = Date.now();
  const imageTensor = tf.tensor3d(photo.data, [photo.height, photo.width, 3], "int32");
  Sentry.logger.info("perf: vehicleDetection.tensorConstruct", { ms: Date.now() - tTensorStart });

  try {
    const tInferStart = Date.now();
    const predictions = await model.detect(imageTensor, 20, MIN_DETECTION_SCORE);
    // This is the real number to look at first -- the actual SSD-MobileNet forward pass on
    // this app's CPU (or GPU, see tfPlatform.ts) backend, independent of everything else in
    // the capture cycle (shutter, decode, React state/render). If this alone is multiple
    // seconds, no amount of resolution/timing tuning elsewhere can fix the freeze -- the
    // model itself needs to move off the JS thread (Phase 2), not run faster on it.
    Sentry.logger.info("perf: vehicleDetection.modelInference", { ms: Date.now() - tInferStart });
    return predictions
      .filter((p) => VEHICLE_CLASSES.has(p.class))
      .map((p) => ({
        label: HEAVY_VEHICLE_CLASSES.has(p.class) ? ("Heavy Vehicle" as const) : ("Vehicle" as const),
        score: p.score,
        bbox: p.bbox as [number, number, number, number],
      }));
  } finally {
    imageTensor.dispose();
  }
}
