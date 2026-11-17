import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Device from "expo-device";
import { signInWithCustomToken } from "firebase/auth";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { auth } from "@/services/firebase";
import { colors, radius, spacing } from "@/theme/tokens";
import { deviceRegion } from "@/schoolZones/regions";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import {
  RECOVERY_CHAT,
  cancelContactChange,
  contactKind,
  maskPhoneForDisplay,
  parseMonth,
  sendRecoveryTicket,
  setNewPassword,
  startNewContact,
  startRecovery,
  toInternational,
  verifyNewContact,
  verifyRecoveryCode,
} from "@/account/recovery";
import { CallError } from "@/services/callable";

// Sign in > Forgot password / Can't sign in? Every rule (10-minute codes, 5 tries, 3 requests a
// day, no account fishing, the 24 h wait on a contact change) is enforced on the server.
type Step =
  | { s: "choose" }
  | { s: "identify" }
  | { s: "emailSent"; message: string }
  | { s: "code"; challengeId: string; masked: string }
  | { s: "password"; grant: string }
  | { s: "done"; text: string }
  | { s: "chat"; index: number; answers: Record<string, string> }
  | { s: "newContact"; answers: Record<string, string> }
  | { s: "newContactCode"; answers: Record<string, string>; challengeId: string }
  | { s: "cancel" };

function errText(err: unknown): string {
  if (err instanceof CallError) {
    const left = typeof err.details?.attemptsLeft === "number" ? ` ${err.details.attemptsLeft} tries left.` : "";
    return `${err.message}${left}`;
  }
  return "Something went wrong. Check your connection and try again.";
}

export function AccountRecoveryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "AccountRecovery">>();
  const initial: Step = route.params?.mode === "cancel" ? { s: "cancel" } : route.params?.mode === "forgot" ? { s: "identify" } : { s: "choose" };
  const [step, setStep] = useState<Step>(initial);
  const [input, setInput] = useState("");
  const [input2, setInput2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (next: Step) => {
    setError(null);
    setInput("");
    setInput2("");
    setStep(next);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (value: string, set: (v: string) => void, placeholder: string, opts: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <TextInput value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={colors.textFaint} autoCapitalize="none" style={styles.input} {...opts} />
  );

  let body: React.ReactNode = null;
  switch (step.s) {
    case "choose":
      body = (
        <>
          <Text style={styles.title}>Can&apos;t sign in?</Text>
          <Button variant="primary" label="Reset my password" onPress={() => go({ s: "identify" })} fullWidth testID="recovery-forgot" />
          <Text style={styles.help}>We&apos;ll send a link to your email, or a code to your phone.</Text>
          <Button variant="secondary" label="I can't use my email or phone any more" onPress={() => go({ s: "chat", index: 0, answers: {} })} fullWidth testID="recovery-assisted" />
          <Text style={styles.help}>Answer a few questions and our team will check it&apos;s you.</Text>
          <Button variant="ghost" label="Cancel a change to my account" onPress={() => go({ s: "cancel" })} fullWidth testID="recovery-cancel" />
        </>
      );
      break;
    case "identify":
      body = (
        <>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.help}>Enter the email you signed up with, or your full mobile number.</Text>
          {field(input, setInput, "Email or mobile (e.g. 0412 345 678)", { keyboardType: "email-address", testID: "recovery-contact" })}
          <Button
            variant="primary"
            label="Send"
            loading={busy}
            disabled={busy || !contactKind(toInternational(input))}
            fullWidth
            testID="recovery-send"
            onPress={() =>
              run(async () => {
                const r = await startRecovery(input);
                if (r.channel === "email") go({ s: "emailSent", message: r.message });
                else go({ s: "code", challengeId: r.challengeId as string, masked: r.masked || maskPhoneForDisplay(input) });
              })
            }
          />
        </>
      );
      break;
    case "emailSent":
      body = (
        <>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.help}>{step.message} Open the link to choose a new password, then sign in. Every other device is signed out when you change it.</Text>
          <Button variant="primary" label="Back to sign in" onPress={() => navigation.goBack()} fullWidth />
        </>
      );
      break;
    case "code":
      body = (
        <>
          <Text style={styles.title}>Enter the code</Text>
          <Text style={styles.help}>If an account uses {step.masked}, we&apos;ve sent it a 6-digit code. It works for 10 minutes.</Text>
          {field(input, setInput, "6-digit code", { keyboardType: "number-pad", maxLength: 6, testID: "recovery-code" })}
          <Button variant="primary" label="Continue" loading={busy} disabled={busy || input.length !== 6} fullWidth onPress={() => run(async () => go({ s: "password", grant: (await verifyRecoveryCode(step.challengeId, input)).grant }))} />
        </>
      );
      break;
    case "password":
      body = (
        <>
          <Text style={styles.title}>Choose a new password</Text>
          {field(input, setInput, "New password (8+ characters)", { secureTextEntry: true, autoComplete: "new-password", testID: "recovery-pass" })}
          {field(input2, setInput2, "Type it again", { secureTextEntry: true, autoComplete: "new-password" })}
          {input2.length > 0 && input !== input2 && <Text style={styles.error}>The two passwords don&apos;t match.</Text>}
          <Button
            variant="primary"
            label="Save password"
            loading={busy}
            disabled={busy || input.length < 8 || input !== input2}
            fullWidth
            onPress={() =>
              run(async () => {
                const r = await setNewPassword(step.grant, input);
                if (r.customToken) {
                  await signInWithCustomToken(auth, r.customToken);
                  go({ s: "done", text: "Password changed and you're signed in. Every other device was signed out." });
                } else {
                  go({ s: "done", text: `Password changed. Sign in with ${r.email ?? "your email"} and the new password. Every other device was signed out.` });
                }
              })
            }
          />
        </>
      );
      break;
    case "done":
      body = (
        <>
          <Text style={styles.title}>All set</Text>
          <Text style={styles.help}>{step.text}</Text>
          <Button variant="primary" label="Done" onPress={() => navigation.goBack()} fullWidth />
        </>
      );
      break;
    case "chat": {
      const q = RECOVERY_CHAT[step.index];
      body = (
        <>
          <Text style={styles.title}>Let&apos;s check it&apos;s you</Text>
          {RECOVERY_CHAT.slice(0, step.index).map((prev) => (
            <View key={prev.key}>
              <View style={styles.bubbleThem}>
                <Text style={styles.bubbleText}>{prev.ask}</Text>
              </View>
              <View style={styles.bubbleMe}>
                <Text style={styles.bubbleMeText}>{step.answers[prev.key] || "(skipped)"}</Text>
              </View>
            </View>
          ))}
          <View style={styles.bubbleThem}>
            <Text style={styles.bubbleText}>{q.ask}</Text>
          </View>
          {field(input, setInput, "Your answer", { testID: "recovery-chat-input", multiline: q.key === "message" })}
          <Button
            variant="primary"
            label="Next"
            fullWidth
            disabled={q.required && !contactKind(toInternational(input))}
            onPress={() => {
              const answers = { ...step.answers, [q.key]: input.trim() };
              if (step.index + 1 < RECOVERY_CHAT.length) go({ s: "chat", index: step.index + 1, answers });
              else go({ s: "newContact", answers });
            }}
          />
          {!q.required && <Button variant="ghost" label="Skip" fullWidth onPress={() => (step.index + 1 < RECOVERY_CHAT.length ? go({ s: "chat", index: step.index + 1, answers: step.answers }) : go({ s: "newContact", answers: step.answers }))} />}
        </>
      );
      break;
    }
    case "newContact":
      body = (
        <>
          <Text style={styles.title}>Where can we reach you now?</Text>
          <Text style={styles.help}>Enter an email or mobile you can use today. We&apos;ll send it a code to make sure it&apos;s yours.</Text>
          {field(input, setInput, "New email or mobile", { keyboardType: "email-address", testID: "recovery-new-contact" })}
          <Button variant="primary" label="Send code" loading={busy} disabled={busy || !contactKind(toInternational(input))} fullWidth onPress={() => run(async () => go({ s: "newContactCode", answers: step.answers, challengeId: (await startNewContact(input)).challengeId }))} />
        </>
      );
      break;
    case "newContactCode":
      body = (
        <>
          <Text style={styles.title}>Enter the code</Text>
          <Text style={styles.help}>We sent a 6-digit code to the new contact. It works for 10 minutes.</Text>
          {field(input, setInput, "6-digit code", { keyboardType: "number-pad", maxLength: 6 })}
          <Button
            variant="primary"
            label="Send to the TrackLine team"
            loading={busy}
            disabled={busy || input.length !== 6}
            fullWidth
            onPress={() =>
              run(async () => {
                const { proof } = await verifyNewContact(step.challengeId, input);
                const a = step.answers;
                const r = await sendRecoveryTicket({
                  signUpContact: a.signUpContact,
                  approxSignupMonth: a.approxSignupMonth ? parseMonth(a.approxSignupMonth) : null,
                  deviceModel: a.deviceModel || Device.modelName || null,
                  lastPlaces: a.lastPlaces ? a.lastPlaces.split(/,| and /).map((p) => p.trim()).filter(Boolean) : [],
                  purchases: a.purchases || null,
                  message: a.message || "",
                  proof,
                  country: deviceRegion(),
                });
                go({ s: "done", text: `${r.message} If we approve it, the change happens 24 hours later, and we tell your old email or phone first so the real owner can stop it.` });
              })
            }
          />
        </>
      );
      break;
    case "cancel":
      body = (
        <>
          <Text style={styles.title}>Cancel a change</Text>
          <Text style={styles.help}>Got a message saying someone asked to change your email or phone? Enter the reference and code from it.</Text>
          {field(input, setInput, "Reference", { testID: "recovery-change-id" })}
          {field(input2, setInput2, "6-digit code", { keyboardType: "number-pad", maxLength: 6 })}
          <Button variant="destructive" label="Cancel the change" loading={busy} disabled={busy || !input || input2.length !== 6} fullWidth onPress={() => run(async () => (await cancelContactChange(input, input2), go({ s: "done", text: "Cancelled. Nothing on your account changed. If you didn't ask for it, change your password now." })))} />
        </>
      );
      break;
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={`recovery-step-${step.s}`}>
        {body}
        {error && <Text style={styles.error} testID="recovery-error">{error}</Text>}
        <Text style={styles.footnote}>TrackLine staff will never ask for your password or a code.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  help: { fontSize: 15, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 16, color: colors.text, minHeight: 48 },
  error: { color: colors.danger, fontSize: 14 },
  footnote: { fontSize: 12, color: colors.textFaint, marginTop: spacing.lg },
  bubbleThem: { alignSelf: "flex-start", backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, maxWidth: "85%" },
  bubbleText: { color: colors.text, fontSize: 15 },
  bubbleMe: { alignSelf: "flex-end", backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, maxWidth: "85%", marginTop: spacing.xs },
  bubbleMeText: { color: "#FFFFFF", fontSize: 15 },
});
