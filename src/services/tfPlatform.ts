import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-cpu";
// Side-effect import, straight at the specific file rather than the package's main index (which
// would also pull in its camera/asyncStorageIO modules this app doesn't use) -- registers a
// *lazy* 'rn-webgl' GPU backend factory (real GPU acceleration via expo-gl, only actually
// creates a GL context if/when tf.setBackend('rn-webgl') below is called; importing this alone
// touches no camera/GPU resource). This same file also calls tf.setPlatform() with its own
// platform shim as an unconditional side effect of being imported -- ensureTfReady() below
// always re-asserts this file's own PlatformReactNative immediately after, so that call never
// actually stays in effect; only the backend registration is kept from this import.
import "@tensorflow/tfjs-react-native/dist/platform_react_native";
import { Sentry } from "@/services/sentry";

// @tensorflow/tfjs-react-native used to double as tfjs-core's *required* platform
// registration for React Native (fetch/now/encode/decode/isTypedArray) -- without it,
// tfjs-core detects neither "browser" (no window.document in RN) nor "node" and never
// registers any platform at all, so it needs a real replacement, not just a workaround.
// This is the same handful of methods tfjs-react-native's own platform shim implemented,
// backed directly by React Native/Hermes's built-in fetch/TextEncoder/TextDecoder instead
// of anything React-Native-specific from that now-unmaintained package.
// eslint-disable-next-line import/namespace -- Platform is a type-only export of tfjs-core (checked by tsc)
class PlatformReactNative implements tf.Platform {
  private textEncoder = new TextEncoder();

  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(path, init);
  }

  now(): number {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  encode(text: string, encoding: string): Uint8Array {
    if (encoding !== "utf-8" && encoding !== "utf8") {
      throw new Error(`Only utf-8 encoding is supported, got ${encoding}`);
    }
    return this.textEncoder.encode(text);
  }

  decode(bytes: Uint8Array, encoding: string): string {
    return new TextDecoder(encoding).decode(bytes);
  }

  isTypedArray(
    value: unknown
  ): value is Float32Array | Int32Array | Uint8Array | Uint8ClampedArray {
    return (
      value instanceof Float32Array ||
      value instanceof Int32Array ||
      value instanceof Uint8Array ||
      value instanceof Uint8ClampedArray
    );
  }
}

// Real kill switch, not just a hypothetical -- flip to false to instantly revert every device
// to the known-working CPU-only path (matching every build before this one) without touching
// anything else, the same DIAGNOSTIC_DISABLE_* pattern already used elsewhere in this app for
// exactly this kind of "can't fully verify without a real device" risk.
//
// Flipped off after a real-device report matching exactly the failure mode this switch exists
// for: the camera preview stays live (permission/device/session all fine) but not a single
// vehicle ever gets a box, on vehicles close enough and clear enough that a healthy CPU
// backend detects easily -- and with zero error/Retry banner ever surfacing either, meaning
// detectVehiclesInPhoto is resolving "successfully" every time with predictions that just never
// clear the confidence threshold. That's consistent with the GPU (rn-webgl) backend silently
// producing wrong/degenerate output on this device rather than throwing -- a real risk this
// backend was already flagged as unable to verify without a physical device. CPU-only is the
// safe, previously-confirmed-working path until GPU correctness can actually be verified on a
// real device rather than just "did it fail to initialize."
const GPU_BACKEND_ENABLED = false;

async function selectBackend(): Promise<void> {
  if (GPU_BACKEND_ENABLED) {
    try {
      Sentry.logger.info("tfPlatform: attempting rn-webgl (GPU) backend");
      const ok = await tf.setBackend("rn-webgl");
      if (!ok) throw new Error("tf.setBackend('rn-webgl') returned false");
      Sentry.logger.info("tfPlatform: rn-webgl (GPU) backend active");
      return;
    } catch (err) {
      // Real, expected fallback path on any device/OS combination where expo-gl's context
      // creation fails for any reason -- never lets a GPU-init problem take down detection
      // entirely, just quietly runs the same CPU backend every build before this one used.
      Sentry.logger.error("tfPlatform: rn-webgl backend unavailable, falling back to CPU", {
        error: String(err),
      });
      console.warn("[tfPlatform] GPU (rn-webgl) backend unavailable, falling back to CPU", err);
    }
  }
  await tf.setBackend("cpu");
}

let readyPromise: Promise<void> | null = null;

/** Registers the React Native platform shim and picks a backend (GPU with a CPU fallback)
 *  exactly once. */
export function ensureTfReady(): Promise<void> {
  if (!readyPromise) {
    tf.env().setPlatform("react-native", new PlatformReactNative());
    readyPromise = selectBackend().then(() => tf.ready());
  }
  return readyPromise;
}
