// Every Places / Routes / search request goes through here: a 10-second limit, one retry for
// a timeout, a dropped connection or a server error (never for a 4xx -- that won't change), and
// the real outcome recorded for Settings > About > Diagnostics. Logs show the host and HTTP
// status only, never the URL (it can carry an API key).
import { recordService, type ServiceName } from "@/diagnostics/diagnostics";

/** The most any request may keep a spinner going: 10 s, across both tries. */
export const REQUEST_BUDGET_MS = 10_000;
/** Each try gets half, so a first try and its one retry together stay inside the budget. */
export const REQUEST_TIMEOUT_MS = REQUEST_BUDGET_MS / 2;

export class RequestTimeoutError extends Error {
  constructor(readonly host: string) {
    super(`No answer from ${host} in ${REQUEST_TIMEOUT_MS / 1000} s`);
    this.name = "RequestTimeoutError";
  }
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1] : "unknown host";
}

async function once(url: string, init: RequestInit | undefined, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const outer = init?.signal;
  const onOuter = () => controller.abort();
  outer?.addEventListener?.("abort", onOuter);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new RequestTimeoutError(hostOf(url));
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.("abort", onOuter);
  }
}

export async function netFetch(
  service: ServiceName,
  url: string,
  init?: RequestInit,
  opts: { timeoutMs?: number; retries?: number; fetchImpl?: typeof fetch } = {}
): Promise<Response> {
  const host = hostOf(url);
  const retries = opts.retries ?? 1;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await once(url, init, opts.timeoutMs ?? REQUEST_TIMEOUT_MS, fetchImpl);
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      recordService(service, { host, status: res.status, ok: res.ok, message: res.ok ? "OK" : `HTTP ${res.status}` });
      if (!res.ok) console.warn(`[net] ${service} ${host} -> HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (init?.signal?.aborted) throw err; // cancelled by the caller, not a failure
      lastErr = err;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  recordService(service, { host, status: null, ok: false, message });
  console.warn(`[net] ${service} ${host} failed: ${message}`);
  throw lastErr;
}
