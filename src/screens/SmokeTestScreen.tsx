import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { navigationRef } from "@/navigation/deepLinks";
import { colors, radius, spacing } from "@/theme/tokens";

// Development builds only (Settings > About > Smoke test): opens every screen in the app, in
// turn, through the real navigator, and reports which ones opened cleanly. A screen fails if it
// doesn't become the current screen within 3 s or if any error is thrown / logged while it's up.

/** Screens that need something passed in to open at all, and what's passed. */
const PARAMS: Record<string, object | undefined> = {
  Settings: { category: undefined },
};
/** Not opened: the map is home (every run starts and ends there); this screen is itself. */
const SKIP = new Set(["Map", "SmokeTest"]);

export type SmokeResult = { screen: string; ok: boolean; detail: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GlobalWithErrorUtils = typeof globalThis & {
  ErrorUtils?: { setGlobalHandler: (fn: (e: unknown, fatal?: boolean) => void) => void; getGlobalHandler: () => (e: unknown, fatal?: boolean) => void };
};

/** Opens one screen and watches it for `settleMs`. Exported for tests. */
export async function openAndCheck(
  name: string,
  nav: { navigate: (n: string, p?: object) => void; goBack: () => void; currentName: () => string | undefined },
  errors: string[],
  settleMs = 800
): Promise<SmokeResult> {
  const before = errors.length;
  try {
    nav.navigate(name, PARAMS[name]);
  } catch (e) {
    return { screen: name, ok: false, detail: `navigate threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  let opened = false;
  for (let t = 0; t < 3000; t += 100) {
    if (nav.currentName() === name) {
      opened = true;
      break;
    }
    await wait(100);
  }
  if (opened) await wait(settleMs);
  const newErrors = errors.slice(before);
  const result: SmokeResult = !opened
    ? { screen: name, ok: false, detail: `didn't open (current: ${nav.currentName() ?? "none"})` }
    : newErrors.length
      ? { screen: name, ok: false, detail: newErrors[0].slice(0, 160) }
      : { screen: name, ok: true, detail: "opened, no errors" };
  if (opened) {
    nav.goBack();
    await wait(300);
  }
  return result;
}

export function SmokeTestScreen() {
  const [results, setResults] = useState<SmokeResult[]>([]);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  const run = async () => {
    if (!navigationRef.isReady()) return;
    setRunning(true);
    setResults([]);
    cancelled.current = false;
    const names = (navigationRef.getRootState()?.routeNames ?? []).filter((n) => !SKIP.has(n));
    // Watch for errors while the run goes: thrown (global handler) and logged (console.error).
    const errors: string[] = [];
    const g = globalThis as GlobalWithErrorUtils;
    const prevHandler = g.ErrorUtils?.getGlobalHandler();
    g.ErrorUtils?.setGlobalHandler((e, fatal) => {
      errors.push(`${fatal ? "fatal: " : ""}${e instanceof Error ? e.message : String(e)}`);
    });
    const prevConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
      prevConsoleError(...args);
    };
    const nav = {
      navigate: (n: string, p?: object) => (navigationRef.navigate as unknown as (n: string, p?: object) => void)(n, p),
      goBack: () => navigationRef.canGoBack() && navigationRef.goBack(),
      currentName: () => navigationRef.getCurrentRoute()?.name,
    };
    // Start from this screen: go back to it between screens by going back once each time.
    try {
      for (const name of names) {
        if (cancelled.current) break;
        const r = await openAndCheck(name, nav, errors);
        setResults((prev) => [...prev, r]);
        // Make sure we're back here before the next one.
        if (nav.currentName() !== "SmokeTest") navigationRef.navigate("SmokeTest" as never);
        await wait(200);
      }
    } finally {
      if (prevHandler) g.ErrorUtils?.setGlobalHandler(prevHandler);
      console.error = prevConsoleError;
      setRunning(false);
    }
  };

  const passed = results.filter((r) => r.ok).length;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="smoke-test-screen">
      <Text style={styles.helper}>Opens every screen in turn and reports which open without errors. Development builds only.</Text>
      <Button variant="primary" label={running ? "Running…" : "Run smoke test"} onPress={run} disabled={running} testID="smoke-run" />
      {running ? <Button variant="secondary" label="Stop" onPress={() => (cancelled.current = true)} /> : null}
      {results.length ? (
        <Text style={styles.summary}>
          {passed}/{results.length} passed{running ? " so far" : ""}
        </Text>
      ) : null}
      {results.map((r) => (
        <View key={r.screen} style={styles.row}>
          <Text style={styles.name}>
            {r.ok ? "✅" : "❌"} {r.screen}
          </Text>
          <Text style={styles.detail} selectable>
            {r.detail}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  content: { padding: spacing.lg, gap: spacing.sm },
  helper: { fontSize: 14, color: colors.textMuted },
  summary: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  detail: { fontSize: 13, color: colors.textMuted },
});
