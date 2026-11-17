import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, StyleSheet, FlatList, ScrollView, SectionList, ActivityIndicator, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Text, TextInput } from "@/components/AppText";
import { Button, Chip } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tracky } from "@/components/trackys/Tracky";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLocation } from "@/context/LocationContext";
import { useAuth } from "@/context/AuthContext";
import { searchPlaces, getPlaceDetails, type PlacePrediction, type PlaceDetails } from "@/services/places";
import { getSavedPlaces, type SavedPlaces } from "@/services/savedPlaces";
import { getSearchHistory } from "@/services/searchHistory";
import { getDirections } from "@/services/directions";
import { placesErrorText, routeErrorText } from "@/services/routingErrors";
import { deletePlannedDrive, savePlannedDrive, watchPlannedDrives } from "@/services/plannedDrivesStore";
import {
  dayChoices,
  groupDrives,
  hourChoices,
  planFor,
  timeSlots,
  type PlannedDrive,
  type PlannedPlace,
} from "@/travel/plannedDrives";
import { formatArrivalClock, formatDurationText } from "@/utils/navFormat";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";

// Plan a drive (main menu): your planned drives grouped by day, or Tracky's empty state; then
// pick where to, from where, which day, and arrive by / leave at one of the 15-minute times,
// each with Google's own predicted drive time for that moment. Saved drives live in Firestore;
// the server re-checks the traffic 30 minutes before and sends the reminder with the up-to-date
// leave time (refreshPlannedDrives).

type Step = "list" | "search" | "time";

const toPlanned = (p: PlaceDetails): PlannedPlace => ({ name: p.name, address: p.address, lat: p.location.latitude, lng: p.location.longitude, placeId: p.placeId });

export function PlanADriveScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const planRoute = useRoute<RouteProp<RootStackParamList, "PlanADrive">>();
  const initial = planRoute.params?.initialDestination ?? null;
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [step, setStep] = useState<Step>(initial ? "time" : "list");
  const [destination, setDestination] = useState<PlaceDetails | null>(initial);
  const [drives, setDrives] = useState<{ status: "loading" } | { status: "ok"; drives: PlannedDrive[] } | { status: "error"; message: string }>({ status: "loading" });

  useEffect(() => {
    if (!uid) return;
    return watchPlannedDrives(
      uid,
      (d) => setDrives({ status: "ok", drives: d }),
      (err) => setDrives({ status: "error", message: err.message })
    );
  }, [uid]);

  const close = () => (step === "list" ? navigation.goBack() : setStep(step === "time" && !initial ? "search" : "list"));
  const title = step === "list" ? "Plan a drive" : step === "search" ? "Where to?" : "When?";

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Button variant="ghost" icon={step === "list" ? "close" : "chevron-back"} iconColor={colors.text} onPress={close} accessibilityLabel={step === "list" ? "Close" : "Back"} testID="plan-back" />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {step === "list" ? (
        <DrivesList
          uid={uid}
          state={uid ? drives : { status: "ok", drives: [] }}
          onPlan={() => setStep("search")}
          onStart={(d) => navigation.navigate("Map", { planADriveDestination: { placeId: d.to.placeId ?? "", name: d.to.name, address: d.to.address ?? "", location: { latitude: d.to.lat, longitude: d.to.lng } } })}
          onDelete={(d) => uid && deletePlannedDrive(uid, d.id)}
          onSignIn={() => navigation.navigate("SignIn")}
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
          destination={destination}
          onChangeDestination={() => setStep("search")}
          canSave={!!uid}
          onSave={async (drive) => {
            if (!uid) return;
            await savePlannedDrive(uid, drive);
            setStep("list");
          }}
        />
      ) : null}
    </View>
  );
}

// ---- The list --------------------------------------------------------------------------------

function DrivesList({
  uid,
  state,
  onPlan,
  onStart,
  onDelete,
  onSignIn,
}: {
  uid: string | null;
  state: { status: "loading" } | { status: "ok"; drives: PlannedDrive[] } | { status: "error"; message: string };
  onPlan: () => void;
  onStart: (d: PlannedDrive) => void;
  onDelete: (d: PlannedDrive) => void;
  onSignIn: () => void;
}) {
  const [now] = useState(() => Date.now());
  const sections = useMemo(() => (state.status === "ok" ? groupDrives(state.drives, now) : []), [state, now]);

  if (!uid) {
    return (
      <EmptyState
        body="Sign in to save planned drives. We'll check the traffic 30 minutes before and tell you when to leave."
        action={<Button label="Sign in" onPress={onSignIn} size="large" fullWidth testID="plan-sign-in" />}
      />
    );
  }
  if (state.status === "loading") {
    return (
      <View style={styles.skeletonList} testID="plan-loading">
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonRow} />
        ))}
      </View>
    );
  }
  if (state.status === "error") {
    return <EmptyState body={`Couldn't load your planned drives: ${state.message}.`} action={<Button label="Plan a drive" onPress={onPlan} size="large" fullWidth />} />;
  }
  if (sections.length === 0) {
    return (
      <EmptyState
        body="Pick where you're going and when. We'll check the traffic 30 minutes before and tell you when to leave."
        action={<Button label="Plan a drive" icon="add" onPress={onPlan} size="large" fullWidth testID="plan-new" />}
      />
    );
  }
  return (
    <View style={styles.flex}>
      <SectionList
        sections={sections.map((s) => ({ title: s.title, data: s.drives }))}
        keyExtractor={(d) => d.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
        renderItem={({ item }) => <DriveRow drive={item} onStart={() => onStart(item)} onDelete={() => onDelete(item)} />}
        stickySectionHeadersEnabled={false}
        testID="plan-list"
      />
      <Button label="Plan a drive" icon="add" onPress={onPlan} size="large" fullWidth testID="plan-new" style={styles.bottomButton} />
    </View>
  );
}

function DriveRow({ drive, onStart, onDelete }: { drive: PlannedDrive; onStart: () => void; onDelete: () => void }) {
  const arrive = drive.leaveAtMs + drive.durationSeconds * 1000;
  const line = `Leave ${formatArrivalClock(drive.leaveAtMs)} · arrive ${formatArrivalClock(arrive)} · ${formatDurationText(drive.durationSeconds)}`;
  return (
    <View style={styles.driveRow} accessible={false} testID={`plan-drive-${drive.id}`}>
      <View style={styles.driveIcon}>
        <Icon name="flag" size={18} color={colors.accent} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.driveTitle} numberOfLines={1}>
          {drive.to.name}
        </Text>
        <Text style={styles.driveSub} numberOfLines={1}>
          {line}
        </Text>
        <Text style={styles.driveFrom} numberOfLines={1}>
          From {drive.from.name}
          {drive.recheckedAt ? " · traffic re-checked" : ""}
        </Text>
      </View>
      <Button variant="secondary" label="Go" onPress={onStart} accessibilityLabel={`Start the drive to ${drive.to.name} now`} testID={`plan-go-${drive.id}`} />
      <Button variant="ghost" icon="trash" iconColor={colors.danger} onPress={onDelete} accessibilityLabel={`Delete the drive to ${drive.to.name}`} testID={`plan-delete-${drive.id}`} />
    </View>
  );
}

function EmptyState({ body, action }: { body: string; action: React.ReactNode }) {
  return (
    <View style={styles.empty} testID="plan-empty">
      <Tracky mood="excited" size={120} />
      <Text style={styles.emptyTitle}>Plan your next drive</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
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
            </Pressable>
          );
        }}
      />
    </View>
  );
}

// ---- When ------------------------------------------------------------------------------------

type SlotResult = { status: "ok"; leaveAtMs: number; durationSeconds: number } | { status: "error"; message: string };

function TimePicker({
  destination,
  onChangeDestination,
  canSave,
  onSave,
}: {
  destination: PlaceDetails;
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
  const [dayStartMs, setDayStartMs] = useState(days[0].dayStartMs);
  const hours = useMemo(() => hourChoices(dayStartMs, now), [dayStartMs, now]);
  const [pickedHour, setPickedHour] = useState<number | null>(null);
  const hour = pickedHour != null && hours.includes(pickedHour) ? pickedHour : hours[0] ?? 8;
  const [mode, setMode] = useState<PlannedDrive["mode"]>("arrive");
  const [selected, setSelected] = useState<number | null>(null);
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
      planFor(mode, slot, predict)
        .then((r) => ({ status: "ok" as const, ...r }))
        .catch((err: unknown) => ({ status: "error" as const, message: routeErrorText(err) }))
        .then((res) => {
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
      setSaving({ error: `Couldn't save the drive: ${err instanceof Error ? err.message : "unknown error"}. Try again.`, busy: false });
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
              accessibilityLabel={`${mode === "arrive" ? "Arrive by" : "Leave at"} ${clock}. ${label ?? "Loading drive time"}${quickest === slot ? ". Quickest" : ""}`}
              testID={`plan-slot-${slot}`}
            >
              <Text style={styles.slotClock}>{clock}</Text>
              {label ? (
                <Text style={[styles.slotDetail, r?.status === "error" && styles.slotError]} numberOfLines={2}>
                  {label}
                </Text>
              ) : (
                <View style={styles.slotSkeleton} />
              )}
              {quickest === slot ? <Text style={styles.quickTag}>Quickest</Text> : null}
              {isSel ? <Icon name="checkmark" size={20} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
        <Text style={styles.quiet}>Drive times are Google&apos;s traffic predictions for each time. We&apos;ll re-check 30 minutes before you leave.</Text>
        {saving.error ? <Text style={styles.errorText}>{saving.error}</Text> : null}
      </ScrollView>
      <Button
        label={canSave ? "Save drive" : "Sign in to save drives"}
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
  driveRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  driveIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
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
