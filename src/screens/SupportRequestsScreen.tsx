import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { colors, pressedOpacity, radius, spacing } from "@/theme/tokens";
import { createHelpTicket, helpTicketThread, myHelpTickets, replyToHelpTicket, statusLabel, type TicketSummary } from "@/services/helpTickets";
import { CallError } from "@/services/callable";

// Help > Contact support: requests go to the owner dashboard's support inbox; replies come
// back here (and as an Inbox message). Works for guests too.
type Thread = Awaited<ReturnType<typeof helpTicketThread>>;

export function SupportRequestsScreen() {
  const [list, setList] = useState<TicketSummary[] | null>(null);
  const [open, setOpen] = useState<Thread | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    myHelpTickets()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof CallError ? err.message : "Couldn't send. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} testID="support-thread">
          <Button variant="ghost" label="All requests" icon="chevron-back" onPress={() => (setOpen(null), load())} />
          <Text style={styles.title}>{open.ticket.subject}</Text>
          <Text style={styles.muted}>{statusLabel(open.ticket.status)}</Text>
          {open.messages.map((m, i) => (
            <View key={i} style={m.from === "user" ? styles.me : styles.them}>
              <Text style={m.from === "user" ? styles.meText : styles.themText}>{m.text}</Text>
            </View>
          ))}
          <TextInput value={text} onChangeText={setText} placeholder="Reply" placeholderTextColor={colors.textFaint} style={[styles.input, styles.multi]} multiline />
          <Button variant="primary" label="Send reply" loading={busy} disabled={busy || !text.trim()} fullWidth onPress={() => run(async () => (setOpen(await replyToHelpTicket(open.ticket.id, text.trim())), setText("")))} />
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="support-requests">
        <Text style={styles.title}>Contact support</Text>
        <Text style={styles.muted}>Tell us what&apos;s wrong. We reply here and in your Inbox. Never send a password or a code.</Text>
        <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.textFaint} style={styles.input} testID="support-subject" />
        <TextInput value={text} onChangeText={setText} placeholder="What happened?" placeholderTextColor={colors.textFaint} style={[styles.input, styles.multi]} multiline testID="support-text" />
        <Button
          variant="primary"
          label="Send"
          loading={busy}
          disabled={busy || !subject.trim() || !text.trim()}
          fullWidth
          testID="support-send"
          onPress={() =>
            run(async () => {
              await createHelpTicket(subject.trim(), text.trim());
              setSubject("");
              setText("");
              load();
            })
          }
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.section}>Your requests</Text>
        {list === null && <Text style={styles.muted}>Loading...</Text>}
        {list?.length === 0 && <Text style={styles.muted}>None yet.</Text>}
        {list?.map((t) => (
          <Pressable key={t.id} onPress={() => run(async () => setOpen(await helpTicketThread(t.id)))} style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]} accessibilityRole="button">
            <Text style={styles.rowTitle}>{t.subject}</Text>
            <Text style={styles.muted}>{statusLabel(t.status)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: spacing.lg },
  muted: { fontSize: 14, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 16, color: colors.text, minHeight: 48 },
  multi: { minHeight: 110, textAlignVertical: "top" },
  error: { color: colors.danger },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 56 },
  rowTitle: { fontSize: 16, color: colors.text, fontWeight: "600" },
  me: { alignSelf: "flex-end", backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, maxWidth: "85%" },
  meText: { color: "#FFFFFF", fontSize: 15 },
  them: { alignSelf: "flex-start", backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, maxWidth: "85%" },
  themText: { color: colors.text, fontSize: 15 },
});
