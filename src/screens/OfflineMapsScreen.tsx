import React, { useCallback, useEffect, useRef, useState } from "react";
import { SettingsActionRow, SettingsNoteRow, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { Segmented } from "@/components/ui/Segmented";
import { useLocation } from "@/context/LocationContext";
import {
  AREA_RADII_KM,
  deleteOfflineArea,
  downloadArea,
  formatBytes,
  listOfflineAreas,
  offlineMapsAvailable,
  type AreaRadiusKm,
  type DownloadProgress,
  type OfflineArea,
} from "@/map-v2/offlineArea";

// Settings > Map > Offline maps (gap item 10): download the map around you to use without a
// signal, see what's saved (real size and progress from the phone's own map store) and delete it.
// Recent drives' route areas are saved automatically and listed here too. Only the map drawing is
// offline: searching places, live traffic and new routes still need a connection (a route saved
// for an offline start is separate, nav/routeCache.ts). Tested in __tests__/gap/offlineMaps.test.tsx.

type ListState = { state: "loading" } | { state: "ready"; areas: OfflineArea[] } | { state: "error"; message: string };

export function OfflineMapsScreen() {
  const available = offlineMapsAvailable();
  const { location, permissionGranted, requestPermission } = useLocation();
  const [radius, setRadius] = useState<AreaRadiusKm>(25);
  const [list, setList] = useState<ListState>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState<{ name: string; progress: DownloadProgress } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!available) return;
    let live = true;
    listOfflineAreas().then(
      (areas) => live && setList({ state: "ready", areas }),
      (e: unknown) => live && setList({ state: "error", message: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
  }, [available, reload]);
  const refresh = useCallback(() => {
    setList({ state: "loading" });
    setReload((n) => n + 1);
  }, []);

  const start = async () => {
    if (!location) return;
    setDownloadError(null);
    try {
      const name = await downloadArea(
        location.coords,
        radius,
        (progress) => {
          if (!mounted.current) return;
          setActive((a) => (a ? { ...a, progress } : a));
          if (progress.complete) {
            setActive(null);
            refresh();
          }
        },
        (message) => {
          if (!mounted.current) return;
          setActive(null);
          setDownloadError(message);
          refresh();
        }
      );
      if (mounted.current) setActive((a) => a ?? { name, progress: { percentage: 0, bytes: 0, complete: false } });
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (name: string) => {
    setBusy(name);
    try {
      await deleteOfflineArea(name);
      if (active?.name === name) setActive(null);
    } catch (e) {
      setDownloadError(`Couldn't delete it: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (!available) {
    return (
      <SettingsPage title="Offline maps" testID="offline-maps-screen">
        <SettingsSection>
          <SettingsNoteRow
            icon="cloud-offline"
            meaning="map"
            text="Not available yet: offline maps need the Mapbox map, which this version can't load (Settings › About › Diagnostics shows why)."
            testID="offline-unavailable"
          />
        </SettingsSection>
      </SettingsPage>
    );
  }

  const areas = list.state === "ready" ? list.areas : [];
  return (
    <SettingsPage title="Offline maps" testID="offline-maps-screen">
      <SettingsSection
        title="Download area"
        footer="Saves the map drawing around you (streets and names) so it still shows without a signal. Searching, live traffic and new routes still need a connection."
      >
        <SettingsRow title="How far around you" icon="radio" meaning="map">
          <Segmented
            options={AREA_RADII_KM.map((km) => ({ key: String(km), label: `${km} km` }))}
            value={String(radius)}
            onChange={(k) => setRadius(Number(k) as AreaRadiusKm)}
            testID="offline-radius"
          />
        </SettingsRow>
        {!permissionGranted || !location ? (
          <SettingsActionRow title={permissionGranted ? "Waiting for your location…" : "Allow location to download the area around you"} onPress={requestPermission} disabled={permissionGranted} testID="offline-need-location" />
        ) : active ? (
          <SettingsRow
            title={`Downloading… ${active.progress.percentage}%`}
            subtitle={active.progress.bytes ? `${formatBytes(active.progress.bytes)} so far` : "Starting"}
            icon="download"
            meaning="map"
            testID="offline-progress"
          />
        ) : (
          <SettingsActionRow title="Download area around me" onPress={start} testID="offline-download" />
        )}
        {active ? <SettingsActionRow title="Cancel download" destructive onPress={() => remove(active.name)} loading={busy === active.name} testID="offline-cancel" /> : null}
        {downloadError ? <SettingsNoteRow icon="alert-circle" meaning="safety" text={`Download failed: ${downloadError}`} testID="offline-download-error" /> : null}
      </SettingsSection>

      <SettingsSection title="Saved on this phone">
        {list.state === "loading" ? <SettingsNoteRow icon="time" meaning="map" text="Checking what's saved…" testID="offline-list-loading" /> : null}
        {list.state === "error" ? <SettingsNoteRow icon="alert-circle" meaning="safety" text={`Couldn't read saved maps: ${list.message}`} testID="offline-list-error" /> : null}
        {list.state === "error" ? <SettingsActionRow title="Try again" onPress={refresh} testID="offline-list-retry" /> : null}
        {list.state === "ready" && !areas.length ? <SettingsNoteRow icon="map" meaning="map" text="No offline maps yet. Recent drives are saved here automatically." testID="offline-empty" /> : null}
        {areas.flatMap((a) => [
          <SettingsRow
            key={a.name}
            title={a.label}
            subtitle={`${a.complete ? "Ready" : `${a.percentage}% downloaded`} · ${formatBytes(a.bytes)}${a.createdAt ? ` · ${new Date(a.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""}`}
            icon={a.kind === "route" ? "navigate" : "map"}
            meaning="map"
            testID={`offline-area-${a.name}`}
          />,
          <SettingsActionRow key={`${a.name}-del`} title={`Delete ${a.label.toLowerCase()}`} destructive onPress={() => remove(a.name)} loading={busy === a.name} testID={`offline-delete-${a.name}`} />,
        ])}
      </SettingsSection>
    </SettingsPage>
  );
}
