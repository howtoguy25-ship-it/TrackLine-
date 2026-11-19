import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, StyleSheet, FlatList, ScrollView, SectionList, ActivityIndicator, Keyboard, Alert, Share, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Text, TextInput } from "@/components/AppText";
import { Button, Chip } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ArriveOnTimeArt } from "@/components/art/ArriveOnTimeArt";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLocation } from "@/context/LocationContext";
import { useAuth } from "@/context/AuthContext";
import { searchPlaces, getPlaceDetails, type PlacePrediction, type PlaceDetails } from "@/services/places";
import { getSavedPlaces, type SavedPlaces } from "@/services/savedPlaces";
import { getSearchHistory } from "@/services/searchHistory";
import { getDirections } from "@/services/directions";
import { placesErrorText, routeErrorText } from "@/services/routingErrors";
import { deletePlannedDrive, firebaseErrorCode, getLeaveReminders, plannedDrivesErrorText, savePlannedDrive, setLeaveReminders, watchPlannedDrives } from "@/services/plannedDrivesStore";
import { ensureSignedIn } from "@/services/firebase";
import { Sentry } from "@/services/sentry";
import { syncLeaveReminders } from "@/services/plannedDriveReminders";
import { getCalendarPermissionStatus, getUpcomingEventsWithLocation, requestCalendarAccess, type UpcomingDriveEvent } from "@/services/calendarEvents";
import { distanceKm } from "@/utils/geo";
import {
  dayChoices,
  groupDrives,
  hourChoices,
  planFor,
  timeSlots,
  type PlannedDrive,
  type PlannedPlace,
} from "@/travel/plannedDrives";
import { formatArrivalClock, formatDistance, formatDurationText } from "@/utils/navFormat";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Plan a drive (main menu): your planned drives grouped by day, or Tracky's empty state; then
// pick where to, from where, which day, and arrive by / leave at one of the 15-minute times,
// each with Google's own predicted drive time for that moment. Saved drives live in Firestore;
// the server re-checks the traffic 30 minutes before and sends the reminder with the up-to-date
// leave time (refreshPlannedDrives).

type Step = "list" | "search" | "time";

const placeOf = (p: PlannedPlace): PlaceDetails => ({ placeId: p.placeId ?? "", name: p.name, address: p.address ?? "", location: { latitude: p.lat, longitude: p.lng } });
const toPlanned = (p: PlaceDetails): PlannedPlace => ({ name: p.name, address: p.address, lat: p.location.latitude, lng: p.location.longitude, placeId: p.placeId });

export function PlanADriveScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const planRoute = useRoute<RouteProp<RootStackParamList, "PlanADrive">>();
  const initial = planRoute.params?.initialDestination ?? null;
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;
  // Drives belong to a signed-in user (a guest's anonymous account counts). Never load before
  // auth has settled, and if there's no user at all, sign in as a guest first -- no "sign in to
  // plan drives" dead end.
  const [signInFailed, setSignInFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (authLoading || uid) return;
    let cancelled = false;
    ensureSignedIn().catch((err) => {
      Sentry.logger.error("plan a drive: guest sign-in failed", { code: firebaseErrorCode(err) });
      if (!cancelled) setSignInFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, uid, retryKey]);

  const [step, setStep] = useState<Step>(initial ? "time" : "list");
  const [destination, setDestination] = useState<PlaceDetails | null>(initial);
  const [drives, setDrives] = useState<{ status: "loading" } | { status: "ok"; drives: PlannedDrive[] } | { status: "error"; message: string }>({ status: "loading" });
  const [remindersOn, setRemindersOn] = useState(true);
  // Editing an existing drive (saved as a new one, then the old one removed), or starting from a
  // calendar event (arrive by its start time).
  const [editing, setEditing] = useState<PlannedDrive | null>(null);
  const [initialTime, setInitialTime] = useState<{ mode: PlannedDrive["mode"]; targetMs: number } | null>(null);

  useEffect(() => {
    if (!uid) return;
    getLeaveReminders(uid).then(setRemindersOn).catch(() => {});
    return watchPlannedDrives(
      uid,
      (d) => setDrives({ status: "ok", drives: d }),
      (err) => {
        Sentry.logger.error("plan a drive: load failed", { code: firebaseErrorCode(err) });
        setDrives({ status: "error", message: plannedDrivesErrorText("load") });
      }
    );
  }, [uid, retryKey]);

  // The phone's own "time to leave" alerts follow the latest leave times.
  const driveList = drives.status === "ok" ? drives.drives : null;
  useEffect(() => {
    if (driveList) syncLeaveReminders(driveList, remindersOn).catch(() => {});
  }, [driveList, remindersOn]);

  const startPlanning = (opts: { place?: PlaceDetails; time?: { mode: PlannedDrive["mode"]; targetMs: number }; edit?: PlannedDrive } = {}) => {
    setEditing(opts.edit ?? null);
    setInitialTime(opts.time ?? null);
    if (opts.place) {
      setDestination(opts.place);
      setStep("time");
    } else setStep("search");
  };

  const close = () => (step === "list" ? navigation.goBack() : setStep(step === "time" && !initial ? "search" : "list"));
  const title = step === "list" ? "Plan a drive" : step === "search" ? "Plan drive" : editing ? "Edit drive" : "When?";

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Button variant="ghost" icon={step === "list" ? "close" : "chevron-back"} iconColor={colors.text} onPress={close} accessibilityLabel={step === "list" ? "Close" : "Back"} testID="plan-back" />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {step === "list" ? (
          <Button variant="ghost" icon="settings" iconColor={colors.text} onPress={() => navigation.navigate("Settings", { category: "plannedDrives" })} accessibilityLabel="Planned drive settings" testID="plan-settings" />
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {step === "list" ? (
        <DrivesList
          uid={uid}
          state={uid ? drives : { status: "ok", drives: [] }}
          onPlan={() => startPlanning()}
          onStart={(d) => navigation.navigate("Map", { planADriveDestination: placeOf(d.to) })}
          onDelete={(d) => uid && deletePlannedDrive(uid, d.id)}
          onEdit={(d) => startPlanning({ place: placeOf(d.to), time: { mode: d.mode, targetMs: d.targetMs }, edit: d })}
          onShare={(d) => {
            Share.share({ message: `I'm driving to ${d.to.name}${d.to.address ? `, ${d.to.address}` : ""}. Leaving ${formatArrivalClock(d.leaveAtMs)}, arriving about ${formatArrivalClock(d.leaveAtMs + d.durationSeconds * 1000)}.` }).catch(() => {});
          }}
          onCalendarPick={(place, startMs) => startPlanning({ place, time: { mode: "arrive", targetMs: startMs } })}
          remindersOn={remindersOn}
          onToggleReminders={(on) => {
            setRemindersOn(on);
            if (uid) setLeaveReminders(uid, on).catch(() => setRemindersOn(!on));
          }}
          onSignIn={() => navigation.navigate("SignIn")}
          signingIn={!uid && !signInFailed}
          onRetry={() => {
            setSignInFailed(false);
            setDrives({ status: "loading" });
            setRetryKey((k) => k + 1);
          }}
        />
      ) : step === "search" ? (
        <DestinationSearch
          onPick={(p) => {
            setDestination(p);
            setStep("time");
          }}
        />
      ) : destination ? (
        <TimePicker
          key={`${destination.placeId}|${initialTime?.targetMs ?? ""}`}
          destination={destination}
          initialTime={initialTime}
          saveLabel={editing ? "Save changes" : "Save drive"}
          onChangeDestination={() => setStep("search")}
          canSave={!!uid}
          onSave={async (drive) => {
            if (!uid) return;
            await savePlannedDrive(uid, drive);
            if (editing) await deletePlannedDrive(uid, editing.id);
            setEditing(null);
            setInitialTime(null);
            setStep("list");
            // Confirm, with the leave time it saved (the reminder follows from the list sync).
            setToast(`Drive saved — leave ${formatArrivalClock(drive.leaveAtMs)}${remindersOn ? ", we'll remind you" : ""}`);
          }}
        />
      ) : null}
      {toast ? (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + spacing.lg }]} testID="plan-toast" accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---- The list --------------------------------------------------------------------------------

type DrivesState = { status: "loading" } | { status: "ok"; drives: PlannedDrive[] } | { status: "error"; message: string };

function DrivesList({
  uid,
  state,
  onPlan,
  onStart,
  onDelete,
  onEdit,
  onShare,
  onCalendarPick,
  remindersOn,
  onToggleReminders,
  onSignIn,
  signingIn,
  onRetry,
}: {
  uid: string | null;
  state: DrivesState;
  onPlan: () => void;
  onStart: (d: PlannedDrive) => void;
  onDelete: (d: PlannedDrive) => void;
  onEdit: (d: PlannedDrive) => void;
  onShare: (d: PlannedDrive) => void;
  onCalendarPick: (place: PlaceDetails, startMs: number) => void;
  remindersOn: boolean;
  onToggleReminders: (on: boolean) => void;
  onSignIn: () => void;
  /** Auth hasn't settled / a guest sign-in is under way: show the loading rows. */
  signingIn: boolean;
  onRetry: () => void;
}) {
  const [now] = useState(() => Date.now());
  const sections = useMemo(() => (state.status === "ok" ? groupDrives(state.drives, now) : []), [state, now]);

  if (!uid && !signingIn) {
    return (
      <EmptyState
        note="Couldn't sign you in to save drives."
        action={
          <View style={styles.actionsCol}>
            <Button label="Try again" onPress={onRetry} size="large" fullWidth testID="plan-retry" />
            <Button variant="secondary" label="Sign in" onPress={onSignIn} size="large" fullWidth testID="plan-sign-in" />
          </View>
        }
      />
    );
  }
  if (!uid || state.status === "loading") {
    return (
      <View style={styles.skeletonList} testID="plan-loading">
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonRow} />
        ))}
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <EmptyState
        note={state.message}
        action={
          <View style={styles.actionsCol}>
            <Button label="Retry" onPress={onRetry} size="large" fullWidth testID="plan-retry" />
            <Button variant="secondary" label="Plan a drive" onPress={onPlan} size="large" fullWidth />
          </View>
        }
      />
    );
  }
  if (sections.length === 0) {
    return (
      <EmptyState
        calendar={<CalendarRow onPick={onCalendarPick} />}
        action={<Button label="Plan a drive" onPress={onPlan} size="large" fullWidth testID="plan-new" />}
      />
    );
  }
  return (
    <View style={styles.flex}>
      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={styles.toggleTitle}>Tell me when to leave</Text>
          <Text style={styles.toggleSub}>A heads-up 30 minutes before with the latest traffic, then an alert when it&apos;s time.</Text>
        </View>
        <Switch value={remindersOn} onValueChange={onToggleReminders} accessibilityLabel="Tell me when to leave" testID="plan-reminders" />
      </View>
      <SectionList
        sections={sections.map((sec) => ({ title: sec.title, data: sec.drives }))}
        keyExtractor={(d) => d.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
        renderItem={({ item }) => (
          <DriveCard drive={item} onStart={() => onStart(item)} onEdit={() => onEdit(item)} onShare={() => onShare(item)} onDelete={() => onDelete(item)} />
        )}
        stickySectionHeadersEnabled={false}
        testID="plan-list"
      />
      <Button label="Plan a drive" icon="add" onPress={onPlan} size="large" fullWidth testID="plan-new" style={styles.bottomButton} />
    </View>
  );
}

/** Live drive time right now, from Google with live traffic, for one card. */
function useLiveDriveTime(to: PlannedPlace): { seconds: number | null; error: string | null } {
  const { location } = useLocation();
  const [result, setResult] = useState<{ key: string; seconds: number | null; error: string | null } | null>(null);
  const hasLoc = !!location;
  const key = hasLoc ? `${to.lat},${to.lng}` : "";
  const locRef = useRef(location);
  useEffect(() => {
    locRef.current = location;
  }, [location]);
  useEffect(() => {
    const loc = locRef.current;
    if (!key || !loc) return;
    let cancelled = false;
    getDirections(loc.coords, { latitude: to.lat, longitude: to.lng }, { useTraffic: true })
      .then((r) => !cancelled && setResult({ key, seconds: r.durationInTrafficSeconds ?? r.durationSeconds, error: null }))
      .catch((err) => !cancelled && setResult({ key, seconds: null, error: routeErrorText(err) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the destination; location read from the ref
  }, [key]);
  return result && result.key === key ? result : { seconds: null, error: null };
}

function DriveCard({ drive, onStart, onEdit, onShare, onDelete }: { drive: PlannedDrive; onStart: () => void; onEdit: () => void; onShare: () => void; onDelete: () => void }) {
  const live = useLiveDriveTime(drive.to);
  const openMenu = () =>
    Alert.alert(drive.to.name, undefined, [
      { text: "Edit", onPress: onEdit },
      { text: "Share", onPress: onShare },
      { text: "Delete", style: "destructive", onPress: onDelete },
      { text: "Cancel", style: "cancel" },
    ]);
  return (
    <View style={styles.driveCard} testID={`plan-drive-${drive.id}`}>
      <View style={styles.driveTop}>
        <Icon name="alarm" size={22} color={colors.text} />
        <View style={styles.flex}>
          <Text style={styles.driveTime}>{formatArrivalClock(drive.leaveAtMs)}</Text>
          <Text style={styles.driveTitle} numberOfLines={1}>
            {drive.to.name}
          </Text>
          {drive.to.address ? (
            <Text style={styles.driveSub} numberOfLines={1}>
              {drive.to.address}
            </Text>
          ) : null}
          <Text style={styles.driveFrom} numberOfLines={1}>
            {drive.mode === "arrive" ? `Arrive by ${formatArrivalClock(drive.targetMs)}` : `Arrive about ${formatArrivalClock(drive.leaveAtMs + drive.durationSeconds * 1000)}`} · from {drive.from.name}
            {drive.recheckedAt ? " · traffic re-checked" : ""}
          </Text>
        </View>
        <Button variant="ghost" icon="ellipsis-horizontal" iconColor={colors.text} onPress={openMenu} accessibilityLabel={`More for the drive to ${drive.to.name}`} testID={`plan-menu-${drive.id}`} />
      </View>
      <View style={styles.driveBottom}>
        <Text style={styles.liveTime} testID={`plan-live-${drive.id}`}>
          {live.seconds != null ? `${formatDurationText(live.seconds)} now` : live.error ? "Drive time unavailable" : " "}
        </Text>
        <Button variant="secondary" label="Go" onPress={onStart} accessibilityLabel={`Start the drive to ${drive.to.name} now`} testID={`plan-go-${drive.id}`} />
      </View>
    </View>
  );
}

function EmptyState({ note, calendar, action }: { note?: string; calendar?: React.ReactNode; action: React.ReactNode }) {
  return (
    <View style={styles.empty} testID="plan-empty">
      <ArriveOnTimeArt size={150} />
      <Text style={styles.emptyTitle}>Arrive on time</Text>
      <Text style={styles.emptyBody}>Wherever you&apos;re going, TrackLine tells you when to leave based on live traffic.</Text>
      {note ? <Text style={styles.errorText}>{note}</Text> : null}
      {calendar}
      {action}
    </View>
  );
}

/** "Connect calendar": upcoming events with a place, each opening an arrive-by plan. */
function CalendarRow({ onPick }: { onPick: (place: PlaceDetails, startMs: number) => void }) {
  const [state, setState] = useState<{ status: "idle" | "loading" } | { status: "events"; events: UpcomingDriveEvent[] } | { status: "error"; message: string }>({ status: "idle" });
  const load = async (ask: boolean) => {
    setState({ status: "loading" });
    try {
      const granted = ask ? await requestCalendarAccess() : (await getCalendarPermissionStatus()) === "granted";
      if (!granted) {
        setState(ask ? { status: "error", message: "Calendar access is off. Turn it on in Settings to plan from events." } : { status: "idle" });
        return;
      }
      setState({ status: "events", events: await getUpcomingEventsWithLocation() });
    } catch (err) {
      setState({ status: "error", message: `Couldn't read your calendar: ${err instanceof Error ? err.message : "unknown error"}.` });
    }
  };
  const pick = async (e: UpcomingDriveEvent) => {
    try {
      const [first] = await searchPlaces(e.location);
      if (!first) {
        setState({ status: "error", message: `Couldn't find “${e.location}” on the map.` });
        return;
      }
      onPick(await getPlaceDetails(first.placeId), e.startDate.getTime());
    } catch (err) {
      setState({ status: "error", message: placesErrorText(e.location, err) });
    }
  };
  if (state.status === "events") {
    return (
      <View style={styles.calendarList}>
        {state.events.length === 0 ? <Text style={styles.quiet}>No events with a place in the next 7 days.</Text> : null}
        {state.events.map((e) => (
          <Pressable key={e.id} onPress={() => pick(e)} style={({ pressed }) => [styles.placeRow, pressed && { opacity: pressedOpacity }]} accessibilityRole="button" accessibilityLabel={`${e.title} at ${e.location}`}>
            <Icon name="calendar" size={20} color={colors.accent} />
            <View style={styles.flex}>
              <Text style={styles.placePrimary} numberOfLines={1}>
                {e.title}
              </Text>
              <Text style={styles.placeSecondary} numberOfLines={1}>
                {formatArrivalClock(e.startDate.getTime())} · {e.location}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <Pressable onPress={() => load(true)} style={({ pressed }) => [styles.calendarRow, pressed && { opacity: pressedOpacity }]} accessibilityRole="button" accessibilityLabel="Connect calendar. Get to events on time" testID="plan-calendar">
      <Icon name="calendar" size={22} color={colors.accent} />
      <View style={styles.flex}>
        <Text style={styles.placePrimary}>Connect calendar</Text>
        <Text style={styles.placeSecondary}>{state.status === "error" ? state.message : "Get to events on time"}</Text>
      </View>
      {state.status === "loading" ? <ActivityIndicator color={colors.accent} /> : <Icon name="chevron-forward" size={18} color={colors.textMuted} />}
    </Pressable>
  );
}

// ---- Where to --------------------------------------------------------------------------------

function DestinationSearch({ onPick }: { onPick: (p: PlaceDetails) => void }) {
  const { location } = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; predictions: PlacePrediction[]; error: string | null } | null>(null);
  const [saved, setSaved] = useState<SavedPlaces>({ home: null, work: null, custom: [] });
  const [history, setHistory] = useState<PlaceDetails[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSavedPlaces().then(setSaved);
    getSearchHistory().then(setHistory);
  }, []);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const q = query.trim();
  const searching = q !== "" && results?.q !== q;

  const onChangeText = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const t = text.trim();
    if (!t) return;
    debounceRef.current = setTimeout(() => {
      searchPlaces(t, location?.coords)
        .then((predictions) => setResults({ q: t, predictions, error: null }))
        .catch((err) => setResults({ q: t, predictions: [], error: placesErrorText("places", err) }));
    }, 350);
  };

  const pickPrediction = async (p: PlacePrediction) => {
    Keyboard.dismiss();
    try {
      onPick(await getPlaceDetails(p.placeId));
    } catch (err) {
      setResults({ q, predictions: results?.predictions ?? [], error: placesErrorText("that place", err) });
    }
  };

  const quick: PlaceDetails[] = [...(saved.home ? [saved.home] : []), ...(saved.work ? [saved.work] : []), ...saved.custom, ...history].slice(0, 8);

  return (
    <View style={styles.flex}>
      <View style={styles.searchRow}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={onChangeText}
          placeholder="Search for a place or address"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          autoFocus
          accessibilityLabel="Search for a place or address"
          testID="plan-search"
        />
        {searching ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      </View>
      {q && results?.q === q && results.error ? (
        <Pressable onPress={() => onChangeText(query)} accessibilityRole="button">
          <Text style={styles.errorText}>{results.error}</Text>
        </Pressable>
      ) : null}
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={(q ? (results?.q === q ? results.predictions : []) : quick) as (PlacePrediction | PlaceDetails)[]}
        keyExtractor={(item) => item.placeId}
        ListHeaderComponent={!q && quick.length ? <Text style={styles.sectionLabel}>Saved and recent</Text> : null}
        ListEmptyComponent={q && results?.q === q && !results.error ? <Text style={styles.quiet}>No places match “{q}”</Text> : null}
        renderItem={({ item }) => {
          const isPrediction = "primaryText" in item;
          const primary = isPrediction ? item.primaryText : item.name;
          const secondary = isPrediction ? item.secondaryText : item.address;
          const away =
            !isPrediction && location
              ? formatDistance(distanceKm(location.coords.latitude, location.coords.longitude, item.location.latitude, item.location.longitude) * 1000)
              : isPrediction && typeof item.distanceMeters === "number"
                ? formatDistance(item.distanceMeters)
                : null;
          return (
            <Pressable
              style={({ pressed }) => [styles.placeRow, pressed && { opacity: pressedOpacity }]}
              onPress={() => (isPrediction ? pickPrediction(item) : onPick(item))}
              accessibilityRole="button"
              accessibilityLabel={`${primary}, ${secondary}`}
            >
              <Icon name={isPrediction ? "location-outline" : "time-outline"} size={20} color={colors.textMuted} />
              <View style={styles.flex}>
                <Text style={styles.placePrimary} numberOfLines={1}>
                  {primary}
                </Text>
                <Text style={styles.placeSecondary} numberOfLines={1}>
                  {secondary}
                </Text>
              </View>
              {away ? <Text style={styles.placeAway}>{away}</Text> : null}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

// ---- When ------------------------------------------------------------------------------------

type SlotResult = { status: "ok"; leaveAtMs: number; durationSeconds: number } | { status: "error"; message: string };

// Predictions already asked for in the last 10 minutes, so going back to an hour doesn't ask again.
const predictionCache = new Map<string, { at: number; result: SlotResult }>();
const CACHE_MS = 10 * 60_000;

function TimePicker({
  destination,
  initialTime,
  saveLabel,
  onChangeDestination,
  canSave,
  onSave,
}: {
  destination: PlaceDetails;
  initialTime: { mode: PlannedDrive["mode"]; targetMs: number } | null;
  saveLabel: string;
  onChangeDestination: () => void;
  canSave: boolean;
  onSave: (d: Omit<PlannedDrive, "id">) => Promise<void>;
}) {
  const { location } = useLocation();
  const [saved, setSaved] = useState<SavedPlaces>({ home: null, work: null, custom: [] });
  useEffect(() => {
    getSavedPlaces().then(setSaved);
  }, []);

  const [now] = useState(() => Date.now());
  const days = useMemo(() => dayChoices(now), [now]);
  const [fromKey, setFromKey] = useState<"here" | "home" | "work">("here");
  const initialDay = initialTime ? new Date(new Date(initialTime.targetMs).setHours(0, 0, 0, 0)).getTime() : null;
  const [dayStartMs, setDayStartMs] = useState(initialDay && days.some((d) => d.dayStartMs === initialDay) ? initialDay : days[0].dayStartMs);
  const hours = useMemo(() => hourChoices(dayStartMs, now), [dayStartMs, now]);
  const [pickedHour, setPickedHour] = useState<number | null>(initialTime ? new Date(initialTime.targetMs).getHours() : null);
  const hour = pickedHour != null && hours.includes(pickedHour) ? pickedHour : hours[0] ?? 8;
  const [mode, setMode] = useState<PlannedDrive["mode"]>(initialTime?.mode ?? "arrive");
  // A calendar event's start isn't always on a quarter hour: round up to the next one shown.
  const [selected, setSelected] = useState<number | null>(initialTime ? Math.ceil(initialTime.targetMs / 900_000) * 900_000 : null);
  const [saving, setSaving] = useState<{ error: string | null; busy: boolean }>({ error: null, busy: false });

  const fromOptions: { key: "here" | "home" | "work"; label: string; place: PlannedPlace | null }[] = [
    { key: "here", label: "Current location", place: location ? { name: "Current location", lat: location.coords.latitude, lng: location.coords.longitude } : null },
    ...(saved.home ? [{ key: "home" as const, label: "Home", place: { ...toPlanned(saved.home), name: "Home" } }] : []),
    ...(saved.work ? [{ key: "work" as const, label: "Work", place: { ...toPlanned(saved.work), name: "Work" } }] : []),
  ];
  const from = fromOptions.find((o) => o.key === fromKey)?.place ?? null;

  const slots = useMemo(() => (hours.length ? timeSlots(dayStartMs, hour, now) : []), [dayStartMs, hour, now, hours.length]);
  const key = from ? `${from.lat},${from.lng}|${destination.placeId}|${mode}|${slots.join(",")}` : null;
  const [results, setResults] = useState<{ key: string; bySlot: Record<number, SlotResult> } | null>(null);
  const bySlot = useMemo<Record<number, SlotResult>>(() => (results && results.key === key ? results.bySlot : {}), [results, key]);

  // Each 15-minute time gets Google's own prediction for that moment; they fill in as they land.
  useEffect(() => {
    if (!key || !from) return;
    let cancelled = false;
    const origin = { latitude: from.lat, longitude: from.lng };
    const predict = (departMs: number) =>
      getDirections(origin, destination.location, { useTraffic: departMs > Date.now() + 60_000 ? Math.round(departMs / 1000) : true }).then(
        (r) => r.durationInTrafficSeconds ?? r.durationSeconds
      );
    for (const slot of slots) {
      const cacheKey = `${key}|${slot}`;
      const hit = predictionCache.get(cacheKey);
      const cached = hit && Date.now() - hit.at < CACHE_MS ? hit.result : null;
      if (cached) {
        setTimeout(() => !cancelled && setResults((prev) => ({ key, bySlot: { ...(prev && prev.key === key ? prev.bySlot : {}), [slot]: cached } })), 0);
        continue;
      }
      planFor(mode, slot, predict)
        .then((r) => ({ status: "ok" as const, ...r }))
        .catch((err: unknown) => ({ status: "error" as const, message: routeErrorText(err) }))
        .then((res) => {
          if (res.status === "ok") predictionCache.set(cacheKey, { at: Date.now(), result: res });
          if (cancelled) return;
          setResults((prev) => ({ key, bySlot: { ...(prev && prev.key === key ? prev.bySlot : {}), [slot]: res } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `key` (from, to, mode and the slots)
  }, [key]);

  const quickest = useMemo(() => {
    let best: number | null = null;
    for (const s of slots) {
      const r = bySlot[s];
      if (r?.status !== "ok") continue;
      const cur = best != null ? bySlot[best] : null;
      if (!cur || (cur.status === "ok" && r.durationSeconds < cur.durationSeconds)) best = s;
    }
    return best;
  }, [slots, bySlot]);

  const longest = Math.max(1, ...slots.map((sl) => (bySlot[sl]?.status === "ok" ? (bySlot[sl] as { durationSeconds: number }).durationSeconds : 0)));
  const chosen = selected != null && slots.includes(selected) ? bySlot[selected] : undefined;

  const save = async () => {
    if (!from || selected == null || chosen?.status !== "ok") return;
    setSaving({ error: null, busy: true });
    try {
      await onSave({
        from,
        to: toPlanned(destination),
        mode,
        targetMs: selected,
        leaveAtMs: chosen.leaveAtMs,
        durationSeconds: chosen.durationSeconds,
        createdAt: Date.now(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (err) {
      Sentry.logger.error("plan a drive: save failed", { code: firebaseErrorCode(err) });
      setSaving({ error: plannedDrivesErrorText("save"), busy: false });
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.timeContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.fromToRow}>
            <Text style={styles.fromToLabel}>From</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {fromOptions.map((o) => (
                <Chip key={o.key} label={o.label} selected={fromKey === o.key} onPress={() => setFromKey(o.key)} disabled={!o.place} testID={`plan-from-${o.key}`} />
              ))}
            </ScrollView>
          </View>
          <Pressable style={styles.fromToRow} onPress={onChangeDestination} accessibilityRole="button" accessibilityLabel={`To ${destination.name}. Change`}>
            <Text style={styles.fromToLabel}>To</Text>
            <Text style={styles.toName} numberOfLines={1} testID="plan-to">
              {destination.name}
            </Text>
            <Icon name="pencil" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {days.map((d) => (
            <Chip key={d.dayStartMs} label={d.label} selected={dayStartMs === d.dayStartMs} onPress={() => setDayStartMs(d.dayStartMs)} testID={`plan-day-${d.label}`} />
          ))}
        </ScrollView>

        <View style={styles.chipRow}>
          <Chip label="Arrive by" selected={mode === "arrive"} onPress={() => setMode("arrive")} testID="plan-mode-arrive" />
          <Chip label="Leave at" selected={mode === "leave"} onPress={() => setMode("leave")} testID="plan-mode-leave" />
        </View>

        {hours.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {hours.map((h) => (
              <Chip key={h} label={formatArrivalClock(new Date(dayStartMs).setHours(h, 0, 0, 0))} selected={hour === h} onPress={() => setPickedHour(h)} />
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.quiet}>No times left today. Pick another day.</Text>
        )}

        {!from ? <Text style={styles.errorText}>Turn on location, or pick Home or Work, to plan from there.</Text> : null}

        {slots.map((slot) => {
          const r = bySlot[slot];
          const clock = formatArrivalClock(slot);
          const isSel = selected === slot;
          const label =
            r?.status === "ok"
              ? mode === "arrive"
                ? `Leave ${formatArrivalClock(r.leaveAtMs)} · ${formatDurationText(r.durationSeconds)}`
                : `${formatDurationText(r.durationSeconds)} · arrive ${formatArrivalClock(r.leaveAtMs + r.durationSeconds * 1000)}`
              : r?.status === "error"
                ? `Couldn't get a time: ${r.message}`
                : null;
          return (
            <Pressable
              key={slot}
              onPress={() => r?.status === "ok" && setSelected(slot)}
              disabled={r?.status !== "ok"}
              style={({ pressed }) => [styles.slotRow, isSel && styles.slotRowSelected, pressed && { opacity: pressedOpacity }]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel, disabled: r?.status !== "ok" }}
              accessibilityLabel={`${mode === "arrive" ? "Arrive by" : "Leave at"} ${clock}. ${label ?? "Loading drive time"}${quickest === slot ? ". Best time" : ""}`}
              testID={`plan-slot-${slot}`}
            >
              <Text style={styles.slotClock}>{clock}</Text>
              {label ? (
                <View style={styles.flex}>
                  <Text style={[styles.slotDetail, r?.status === "error" && styles.slotError]} numberOfLines={2}>
                    {label}
                  </Text>
                  {r?.status === "ok" ? <View style={[styles.slotBar, { width: `${Math.round((r.durationSeconds / longest) * 100)}%` }]} /> : null}
                </View>
              ) : (
                <View style={styles.slotSkeleton} />
              )}
              {quickest === slot ? <Text style={styles.quickTag}>Best time</Text> : null}
              {isSel ? <Icon name="checkmark" size={20} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
        <Text style={styles.quiet}>Drive times are Google&apos;s traffic predictions for each time. We&apos;ll re-check 30 minutes before you leave.</Text>
        {saving.error ? <Text style={styles.errorText}>{saving.error}</Text> : null}
      </ScrollView>
      <Button
        label={canSave ? saveLabel : "Getting ready…"}
        onPress={save}
        disabled={!canSave || chosen?.status !== "ok" || saving.busy}
        loading={saving.busy}
        size="large"
        fullWidth
        style={styles.bottomButton}
        testID="plan-save"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionsCol: { alignSelf: "stretch", gap: spacing.sm },
  toast: { position: "absolute", left: spacing.lg, right: spacing.lg, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.text },
  toastText: { color: colors.surface, fontSize: 15, fontWeight: "600", textAlign: "center" },
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  headerSpacer: { width: 44 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800", color: colors.text },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.4 },
  quiet: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
  errorText: { fontSize: 14, color: colors.danger, marginVertical: spacing.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingBottom: spacing.xxl },
  emptyTitle: { fontSize: 22, fontWeight: "800", color: colors.text },
  emptyBody: { fontSize: 15, color: colors.textMuted, textAlign: "center", lineHeight: 21 },
  skeletonList: { gap: spacing.sm, marginTop: spacing.md },
  skeletonRow: { height: 72, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  toggleTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  toggleSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  driveCard: { borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, padding: spacing.md, marginBottom: spacing.sm },
  driveTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  driveTime: { fontSize: 22, fontWeight: "800", color: colors.text },
  driveBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  liveTime: { fontSize: 16, fontWeight: "800", color: colors.accent },
  calendarRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, alignSelf: "stretch", minHeight: 60, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  calendarList: { alignSelf: "stretch" },
  placeAway: { fontSize: 13, color: colors.textMuted },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 36 },
  slotBar: { height: 4, borderRadius: 2, backgroundColor: colors.routePurple, marginTop: 4 },
  driveTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  driveSub: { fontSize: 14, color: colors.text, marginTop: 2 },
  driveFrom: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  bottomButton: { marginTop: spacing.sm, marginBottom: spacing.lg },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 10 },
  placeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60 },
  placePrimary: { fontSize: 16, fontWeight: "700", color: colors.text },
  placeSecondary: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  timeContent: { gap: spacing.sm, paddingBottom: spacing.lg },
  card: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  fromToRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52 },
  fromToLabel: { width: 40, fontSize: 13, fontWeight: "700", color: colors.textMuted },
  toName: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 2 },
  slotRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  slotRowSelected: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  slotClock: { width: 72, fontSize: 16, fontWeight: "800", color: colors.text },
  slotDetail: { flex: 1, fontSize: 14, color: colors.text },
  slotError: { color: colors.danger },
  slotSkeleton: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.surfaceMuted },
  quickTag: { fontSize: 12, fontWeight: "800", color: colors.goodText },
});
