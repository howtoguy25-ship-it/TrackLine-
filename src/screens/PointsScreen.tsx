import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { SettingsActionRow, SettingsNoteRow, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/SettingsKit";
import { useAuth } from "@/context/AuthContext";
import { badgesFor, fetchLeaderboard, fetchMyScore, levelProgress, pointsThisWeek, POINT_RULES, type LeaderRow, type Score } from "@/gamification/points";
import { colors, radius } from "@/theme/tokens";

// Menu › Points & badges (gap item 15): your points and level, badges, and this week's top
// drivers. Everything comes from scores/{uid}, which only the server writes when a report of yours
// goes live, other drivers confirm it, or you vote on someone else's -- nothing is counted here.

type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error"; message: string };

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/timed out/i.test(m)) return "Couldn't load in 10 seconds — check your connection.";
  if (/index/i.test(m)) return "The leaderboard isn't switched on yet (it needs the latest server update).";
  if (/permission/i.test(m)) return "Sign in to see points.";
  return "Couldn't load — try again.";
}

export function PointsScreen() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [mine, setMine] = useState<Load<Score>>({ state: "loading" });
  const [board, setBoard] = useState<Load<LeaderRow[]>>({ state: "loading" });
  const [reload, setReload] = useState(0);
  // "This week" is judged at load time (the same moment the leaderboard's week is chosen).
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    const now = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the load's own timestamp, set with the load
    setLoadedAt(now);
    fetchMyScore(uid).then(
      (value) => live && setMine({ state: "ready", value }),
      (e: unknown) => live && setMine({ state: "error", message: errorText(e) })
    );
    fetchLeaderboard(now, uid).then(
      (value) => live && setBoard({ state: "ready", value }),
      (e: unknown) => live && setBoard({ state: "error", message: errorText(e) })
    );
    return () => {
      live = false;
    };
  }, [uid, reload]);
  const retry = useCallback(() => {
    setMine({ state: "loading" });
    setBoard({ state: "loading" });
    setReload((n) => n + 1);
  }, []);

  if (!uid) {
    return (
      <SettingsPage title="Points & badges" testID="points-screen">
        <SettingsSection>
          <SettingsNoteRow text="Sign in to earn points for your reports." icon="person-circle" />
        </SettingsSection>
      </SettingsPage>
    );
  }

  const score = mine.state === "ready" ? mine.value : null;
  const lp = score ? levelProgress(score.points) : null;
  return (
    <SettingsPage title="Points & badges" testID="points-screen">
      <SettingsSection title="You" footer={`Points: report goes live +${POINT_RULES.reportPublished}, another driver confirms it +${POINT_RULES.confirmedByOther}, you vote on someone else's +${POINT_RULES.vote}, removed as wrong ${POINT_RULES.reportRemoved}.`}>
        {mine.state === "loading" ? <SettingsNoteRow text="Loading your points…" icon="time" testID="points-loading" /> : null}
        {mine.state === "error" ? <SettingsNoteRow text={mine.message} icon="alert-circle" testID="points-error" /> : null}
        {mine.state === "error" ? <SettingsActionRow title="Try again" onPress={retry} testID="points-retry" /> : null}
        {score && lp ? (
          <SettingsRow title={lp.name} subtitle={`${score.points} points · ${pointsThisWeek(score, loadedAt)} this week`} icon="star" meaning="account" testID="points-level">
            <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(lp.fraction * 100) }}>
              <View style={[styles.fill, { width: `${Math.round(lp.fraction * 100)}%` }]} />
            </View>
            <Text style={styles.next} testID="points-next">
              {lp.next ? `${lp.toNext} points to ${lp.next.name}` : "Top level"}
            </Text>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      {score ? (
        <SettingsSection title="Badges">
          {badgesFor(score).map((b) => (
            <SettingsRow
              key={b.id}
              title={b.name}
              subtitle={b.earned ? `Earned · ${b.how}` : `${b.how} (${b.have}/${b.need})`}
              icon={b.earned ? "checkmark-circle" : "ellipse-outline"}
              meaning={b.earned ? "safety" : "account"}
              testID={`badge-${b.id}`}
            />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection title="This week's top drivers" footer="Weeks start Monday (Sydney time). Names show only for drivers who chose to show their name on reports.">
        {board.state === "loading" ? <SettingsNoteRow text="Loading the leaderboard…" icon="time" testID="board-loading" /> : null}
        {board.state === "error" ? <SettingsNoteRow text={board.message} icon="alert-circle" testID="board-error" /> : null}
        {board.state === "error" ? <SettingsActionRow title="Try again" onPress={retry} testID="board-retry" /> : null}
        {board.state === "ready" && board.value.length === 0 ? <SettingsNoteRow text="No points yet this week. Report what you see on the road to be first." icon="flag" testID="board-empty" /> : null}
        {board.state === "ready"
          ? board.value.map((r, i) => (
              <SettingsRow key={r.uid} title={`${i + 1}. ${r.name}`} subtitle={r.level} value={`${r.weekPoints}`} icon={r.you ? "person-circle" : "person"} meaning="account" selected={r.you} testID={`board-row-${i}`} />
            ))
          : null}
      </SettingsSection>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: "hidden", marginTop: 8 },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
  next: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
});
