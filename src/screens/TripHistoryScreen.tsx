import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { SettingsActionRow, SettingsNoteRow, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { Segmented } from "@/components/ui/Segmented";
import { useSettings } from "@/context/SettingsContext";
import { avgKmh, clearTrips, deleteTrip, formatDuration, listTrips, statsFor, type StatsPeriod, type TripRecord } from "@/trips/tripLog";
import { formatDistance } from "@/utils/navFormat";

// Menu › Trip history (gap item 17): every navigated trip, measured from your phone's own GPS
// while it ran, and totals for this week / month / all time. Kept on this phone only.

type Load = { state: "loading" } | { state: "ready"; trips: TripRecord[] } | { state: "error" };

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

function when(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function TripHistoryScreen() {
  const { settings, updateSettings } = useSettings();
  const unit = settings.distanceUnit;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const [reload, setReload] = useState(0);
  // Week / month are judged from when the list was read.
  const [now, setNow] = useState(0);
  useEffect(() => {
    let live = true;
    listTrips().then(
      (trips) => {
        if (!live) return;
        setNow(Date.now());
        setLoad({ state: "ready", trips });
      },
      () => live && setLoad({ state: "error" })
    );
    return () => {
      live = false;
    };
  }, [reload]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const askDelete = (t: TripRecord) =>
    Alert.alert("Delete this trip?", `${t.to ?? "Trip"} · ${when(t.startMs)}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteTrip(t.id).then(refresh) },
    ]);
  const askClear = () =>
    Alert.alert("Clear all trip history?", "This deletes every saved trip from this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => clearTrips().then(refresh) },
    ]);

  const trips = load.state === "ready" ? load.trips : [];
  const s = statsFor(trips, period, now);
  return (
    <SettingsPage title="Trip history" testID="trip-history">
      <SettingsSection footer="Measured from your phone's GPS while you navigate. Kept on this phone only; nothing is uploaded.">
        <SettingsRow
          title="Keep trip history"
          icon="time"
          meaning="account"
          toggle={{ value: settings.tripHistory, onValueChange: (v: boolean) => updateSettings({ tripHistory: v }), testID: "trip-history-switch" }}
        />
      </SettingsSection>

      <SettingsSection title="Totals">
        <SettingsRow title="Period" icon="calendar" meaning="map">
          <Segmented options={PERIODS} value={period} onChange={setPeriod} testID="trip-period" />
        </SettingsRow>
        <SettingsRow title="Trips" value={String(s.trips)} icon="navigate" meaning="map" testID="stat-trips" />
        <SettingsRow title="Distance" value={formatDistance(s.distanceM, unit)} icon="map" meaning="map" testID="stat-distance" />
        <SettingsRow title="Time driving" value={formatDuration(s.driveS)} icon="time" meaning="map" testID="stat-time" />
        <SettingsRow title="Average moving speed" value={s.trips ? `${s.avgKmh} km/h` : "—"} icon="car" meaning="map" testID="stat-avg" />
        <SettingsRow title="Longest trip" value={s.trips ? formatDistance(s.longestM, unit) : "—"} icon="flag" meaning="map" testID="stat-longest" />
      </SettingsSection>

      <SettingsSection title="Trips">
        {load.state === "loading" ? <SettingsNoteRow text="Loading your trips…" icon="time" testID="trips-loading" /> : null}
        {load.state === "error" ? <SettingsNoteRow text="Couldn't read your trips on this phone." icon="alert-circle" testID="trips-error" /> : null}
        {load.state === "error" ? <SettingsActionRow title="Try again" onPress={refresh} testID="trips-retry" /> : null}
        {load.state === "ready" && trips.length === 0 ? (
          <SettingsNoteRow text={settings.tripHistory ? "No trips yet. Start a route and your trip is saved here when it ends." : "Trip history is off."} icon="navigate" testID="trips-empty" />
        ) : null}
        {trips.map((t) => (
          <SettingsRow
            key={t.id}
            title={t.to ? `To ${t.to}` : "Trip"}
            subtitle={`${when(t.startMs)}\n${formatDistance(t.distanceM, unit)} · ${formatDuration(t.durationS)} · avg ${avgKmh(t)} km/h · top ${t.maxKmh} km/h${t.overLimitS >= 30 ? ` · ${formatDuration(t.overLimitS)} over the limit` : ""} · ${t.arrived ? "Arrived" : "Stopped early"}`}
            icon={t.arrived ? "flag" : "navigate"}
            meaning="map"
            onPress={() => askDelete(t)}
            testID={`trip-${t.id}`}
          />
        ))}
        {trips.length > 0 ? <SettingsActionRow title="Clear trip history" onPress={askClear} destructive testID="trips-clear" /> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
