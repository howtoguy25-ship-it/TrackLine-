import { env } from "@/config/env";

// Whether the Mapbox token baked into this build can actually work.
//
// Build 202 shipped with the literal text "***** (This is a sensitive env variable. To access
// it, run command with --include-sensitive flag. Learn more.)" as its token: the EAS variable's
// value had been set to what `eas env:list` prints in place of a hidden value. A non-empty
// string looked "present", so the app handed it to Mapbox, which refused it -- blank map, and
// every Mapbox route failed. A real public token is "pk." followed by base64 with no spaces.

export type MapboxTokenState = "ok" | "missing" | "placeholder" | "secret" | "malformed";

export function mapboxTokenState(token: string | null | undefined): MapboxTokenState {
  const t = (token ?? "").trim();
  if (!t) return "missing";
  if (t.includes("*") || /include-sensitive|env variable/i.test(t)) return "placeholder";
  if (t.startsWith("sk.")) return "secret";
  if (!/^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return "malformed";
  return "ok";
}

/** The token if it can work, otherwise "" (callers treat "" as "no Mapbox"). */
export function usableMapboxToken(token: string = env.mapboxPublicToken): string {
  return mapboxTokenState(token) === "ok" ? token.trim() : "";
}

/** Last 4 characters, for Diagnostics -- only for a real public token, never anything else. */
export function mapboxTokenTail(token: string = env.mapboxPublicToken): string | null {
  return mapboxTokenState(token) === "ok" ? token.trim().slice(-4) : null;
}

/** What Diagnostics and the map banner say about the token. */
export const TOKEN_STATE_TEXT: Record<MapboxTokenState, string> = {
  ok: "Present",
  missing: "Map service key missing",
  placeholder: "Map service key missing (the build has placeholder text instead of the key)",
  secret: "Map service key is a secret (sk.) key — the app needs the public pk. key",
  malformed: "Map service key isn't a valid Mapbox public key",
};
