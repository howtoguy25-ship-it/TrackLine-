import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Text } from "@/components/AppText";
import { Button } from "@/components/ui/Button";
import { colors, radius, spacing } from "@/theme/tokens";
import { confirmPhoneCode, sendPhoneCode } from "@/account/phoneAuth";
import { contactKind, maskPhoneForDisplay, toInternational } from "@/account/recovery";

// Sign in > Continue with phone number. Firebase sends the 6-digit SMS; a guest keeps
// everything (the guest account becomes the phone account).
export function PhoneSignInScreen() {
  const navigation = useNavigation();
  const [phone, setPhone] = useState("");
  const [vid, setVid] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = contactKind(toInternational(phone)) === "phone";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="phone-sign-in">
        {!vid ? (
          <>
            <Text style={styles.title}>Your mobile number</Text>
            <Text style={styles.help}>We&apos;ll text you a 6-digit code. Standard SMS rates may apply.</Text>
            <TextInput value={phone} onChangeText={setPhone} placeholder="0412 345 678 or +61…" placeholderTextColor={colors.textFaint} keyboardType="phone-pad" autoComplete="tel" style={styles.input} testID="phone-number" />
            <Button variant="primary" label="Send code" loading={busy} disabled={busy || !valid} fullWidth testID="phone-send" onPress={() => run(async () => setVid(await sendPhoneCode(phone)))} />
          </>
        ) : (
          <>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.help}>Sent to {maskPhoneForDisplay(toInternational(phone))}.</Text>
            <TextInput value={code} onChangeText={setCode} placeholder="6-digit code" placeholderTextColor={colors.textFaint} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} style={styles.input} testID="phone-code" />
            <Button
              variant="primary"
              label="Sign in"
              loading={busy}
              disabled={busy || code.length !== 6}
              fullWidth
              testID="phone-confirm"
              onPress={() =>
                run(async () => {
                  await confirmPhoneCode(vid, code);
                  navigation.goBack();
                })
              }
            />
            <Button variant="ghost" label="Use a different number" fullWidth onPress={() => (setVid(null), setCode(""))} />
          </>
        )}
        {error && <Text style={styles.error} testID="phone-error">{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  help: { fontSize: 15, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 18, color: colors.text, minHeight: 52 },
  error: { color: colors.danger, fontSize: 14 },
});
