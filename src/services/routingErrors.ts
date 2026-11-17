// The real reason a route request failed, in words the driver can act on. Never "check your
// connection" unless the phone is actually offline.

export type RoutingErrorKind =
  | "key_missing" // no usable key in this build
  | "key_rejected" // 401: the service refused the key
  | "key_restricted" // 403: key valid but not allowed for this (URL/bundle restrictions, scopes)
  | "no_route" // the service answered: there's no way to do this trip
  | "bad_request" // 422 / InvalidInput
  | "rate_limited" // 429
  | "server" // 5xx
  | "timeout"
  | "offline";

export const ROUTING_ERROR_TEXT: Record<RoutingErrorKind, string> = {
  key_missing: "Map service key missing",
  key_rejected: "Map service rejected the key",
  key_restricted: "Map service rejected the key (it isn't allowed for this app)",
  no_route: "No route found",
  bad_request: "Map service couldn't read this trip",
  rate_limited: "Map service is busy -- try again in a moment",
  server: "Map service is having problems -- try again in a moment",
  timeout: "Map service didn't answer in time",
  offline: "No internet",
};

export class RoutingError extends Error {
  constructor(
    readonly kind: RoutingErrorKind,
    readonly status: number | null,
    detail?: string
  ) {
    super(`${ROUTING_ERROR_TEXT[kind]}${status != null ? ` (HTTP ${status})` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "RoutingError";
  }
  /** What's shown on screen. */
  get userText(): string {
    return ROUTING_ERROR_TEXT[this.kind];
  }
}

/** A Mapbox Directions answer → error kind (null = it's fine). Mapbox's own docs: 401 invalid
 * token, 403 forbidden (URL restrictions / scopes), 422 InvalidInput, 429 rate limit, and
 * "NoRoute"/"NoSegment" codes when there's genuinely no route. */
export function classifyMapboxAnswer(status: number, json: { code?: string; message?: string } | null): RoutingErrorKind | null {
  const code = json?.code;
  if (status === 401) return "key_rejected";
  if (status === 403) return "key_restricted";
  if (code === "NoRoute" || code === "NoSegment") return "no_route";
  if (status === 422 || code === "InvalidInput") return "bad_request";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 200 && status < 300 && code === "Ok") return null;
  if (status >= 400) return "bad_request";
  return "server";
}

/** A thrown fetch error → kind. `online` comes from the phone's network state when known. */
export function classifyFetchFailure(err: unknown, timedOut: boolean, online: boolean | null): RoutingErrorKind {
  if (timedOut) return online === false ? "offline" : "timeout";
  if (online === false) return "offline";
  // React Native's fetch rejects with TypeError "Network request failed" when there's no route
  // to the server at all.
  if (err instanceof TypeError && /network/i.test(err.message)) return "offline";
  return "server";
}

/** Errors worth retrying with the other provider (Google): anything but "there's no route". */
export function shouldFallBack(err: unknown): boolean {
  if (err instanceof RoutingError) return err.kind !== "no_route" && err.kind !== "offline";
  return true;
}

/**
 * Any route failure (Mapbox RoutingError, Google DirectionsApiError, a raw fetch error) → the one
 * line the driver sees. Google's statuses: REQUEST_DENIED / 403 = key refused, 401 = key bad,
 * ZERO_RESULTS / NOT_FOUND = no route, OVER_QUERY_LIMIT / 429 = busy, NETWORK_ERROR = offline.
 */
export function routeErrorText(err: unknown): string {
  if (err instanceof RoutingError) return err.userText;
  const e = err as { name?: string; status?: unknown; message?: string } | null;
  if (e && e.name === "DirectionsApiError") {
    const status = String(e.status ?? "");
    const msg = String(e.message ?? "");
    if (/billing/i.test(msg)) return "Routing unavailable -- billing isn't enabled on this app's Google Cloud project";
    if (status === "ZERO_RESULTS" || status === "NOT_FOUND") return ROUTING_ERROR_TEXT.no_route;
    if (status === "REQUEST_DENIED" || status === "403") return ROUTING_ERROR_TEXT.key_rejected;
    if (status === "401") return ROUTING_ERROR_TEXT.key_rejected;
    if (status === "OVER_QUERY_LIMIT" || status === "429") return ROUTING_ERROR_TEXT.rate_limited;
    if (status === "NETWORK_ERROR") return /network request failed/i.test(msg) ? ROUTING_ERROR_TEXT.offline : `Couldn't reach the map service (${msg.slice(0, 60)})`;
    if (status === "INVALID_REQUEST" || status === "400") return ROUTING_ERROR_TEXT.bad_request;
    if (/^5\d\d$/.test(status) || status === "UNKNOWN_ERROR") return ROUTING_ERROR_TEXT.server;
    return `Couldn't find a route (${status})`;
  }
  if (err instanceof TypeError && /network/i.test(err.message)) return ROUTING_ERROR_TEXT.offline;
  return `Couldn't find a route${err instanceof Error && err.message ? ` (${err.message.slice(0, 60)})` : ""}`;
}
