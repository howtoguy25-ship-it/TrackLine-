import React, { useEffect, useState, useSyncExternalStore } from "react";
import { doc, getDocFromServer } from "firebase/firestore";
import { SettingsActionRow, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { env } from "@/config/env";
import { getBuildStamp } from "@/config/getBuildStamp";
import { TOKEN_STATE_TEXT, mapboxTokenState, mapboxTokenTail } from "@/config/mapboxToken";
import { getDiagnostics, subscribeDiagnostics, type DirectionsRecord, type ServiceRecord } from "@/diagnostics/diagnostics";
import { isMapboxNativeLinked } from "@/map-v2/mapbox";
import { auth, db } from "@/services/firebase";

// Settings > About > Diagnostics: what's really working in this build, checkable on the phone.
// Keys are never shown -- only yes/no, and the last 4 characters of the Mapbox public token.

export const DIRECTIONS_ROWS: [key: string, label: string][] = [
  ["drive", "Drive"],
  ["motorbike", "Motorbike"],
  ["bike", "Bike"],
  ["walk", "Walk"],
  ["navigation", "Navigation route (Mapbox)"],
  ["reroute", "Reroute (Mapbox)"],
];

export function directionsLine(rec: DirectionsRecord | undefined): string {
  if (!rec) return "Not asked yet this session";
  const who = rec.provider === "mapbox" ? "Mapbox" : "Google";
  const status = rec.status != null ? `HTTP ${rec.status}` : "no answer";
  return `${rec.ok ? "OK" : "Failed"} · ${who} · ${status} · ${rec.message}`;
}

function serviceRow(label: string, rec: ServiceRecord | undefined): [string, string, boolean | null] {
  if (!rec) return [label, "Not asked yet this session", null];
  return [label, `${rec.ok ? "OK" : "Failed"} · ${rec.host} · ${rec.status != null ? `HTTP ${rec.status}` : "no answer"} · ${rec.message}`, rec.ok];
}

type FirebaseCheck = { state: "checking" } | { state: "ok"; uid: string | null } | { state: "failed"; reason: string };

/** A real round trip to Firestore (not the local cache): the public app config document. */
async function probeFirebase(): Promise<FirebaseCheck> {
  try {
    await Promise.race([
      getDocFromServer(doc(db, "appConfig", "current")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in 8 s")), 8000)),
    ]);
    return { state: "ok", uid: auth.currentUser?.uid ?? null };
  } catch (err) {
    return { state: "failed", reason: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  }
}

export function DiagnosticsScreen() {
  const diag = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getDiagnostics);
  const [firebase, setFirebase] = useState<FirebaseCheck>({ state: "checking" });

  const [checkRun, setCheckRun] = useState(0);
  useEffect(() => {
    let live = true;
    probeFirebase().then((r) => {
      if (live) setFirebase(r);
    });
    return () => {
      live = false;
    };
  }, [checkRun]);
  const checkFirebase = () => {
    setFirebase({ state: "checking" });
    setCheckRun((n) => n + 1);
  };

  const tokenState = mapboxTokenState(env.mapboxPublicToken);
  const tail = mapboxTokenTail();
  const style = diag.mapStyle;

  const rows: [string, string, boolean | null][] = [
    ["Mapbox token present", tokenState === "ok" ? `Yes (…${tail})` : `No — ${TOKEN_STATE_TEXT[tokenState]}`, tokenState === "ok"],
    ["Mapbox map engine in this build", isMapboxNativeLinked() ? "Yes" : "No", isMapboxNativeLinked()],
    [
      "Mapbox style loaded",
      style == null ? "Map not opened yet" : style.loaded ? "Yes" : `No — ${style.error ?? "unknown error"}`,
      style == null ? null : style.loaded,
    ],
    ...DIRECTIONS_ROWS.map(([key, label]): [string, string, boolean | null] => {
      const rec = diag.directions[key];
      return [`Directions: ${label}`, directionsLine(rec), rec ? rec.ok : null];
    }),
    ["Places key present", /^AIza[0-9A-Za-z_-]{35}$/.test(env.googlePlacesApiKey ?? "") ? `Yes (…${env.googlePlacesApiKey.slice(-4)})` : "No — Places key missing or not a Google key", /^AIza[0-9A-Za-z_-]{35}$/.test(env.googlePlacesApiKey ?? "")],
    serviceRow("Last Places request", diag.services.places),
    serviceRow("Last Routes request", diag.services.routes),
    serviceRow("Last petrol prices request", diag.services.fuel),
    ["Google key present", env.googleDirectionsApiKey && env.googlePlacesApiKey ? "Yes" : "No", !!(env.googleDirectionsApiKey && env.googlePlacesApiKey)],
    [
      "Firebase connected",
      firebase.state === "checking" ? "Checking…" : firebase.state === "ok" ? `Yes${firebase.uid ? " (signed in)" : " (not signed in)"}` : `No — ${firebase.reason}`,
      firebase.state === "checking" ? null : firebase.state === "ok",
    ],
    ["Build", getBuildStamp(), null],
  ];

  return (
    <SettingsPage title="Diagnostics" testID="diagnostics-screen">
      <SettingsSection footer="What's working in this build right now. Directions rows fill in as you look up routes.">
        {rows.map(([label, value, ok]) => (
          <SettingsRow
            key={label}
            icon={ok === true ? "checkmark-circle" : ok === false ? "close-circle" : "information-circle"}
            meaning={ok === true ? "privacy" : ok === false ? "safety" : "account"}
            title={label}
            subtitle={value}
            testID={`diag-${label}`}
          />
        ))}
      </SettingsSection>
      <SettingsSection>
        <SettingsActionRow title="Check again" onPress={checkFirebase} testID="diag-recheck" />
      </SettingsSection>
    </SettingsPage>
  );
}
