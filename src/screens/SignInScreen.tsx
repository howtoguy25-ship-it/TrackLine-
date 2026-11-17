import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { View, Pressable, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, Linking } from "react-native";
import { Text, TextInput } from "@/components/AppText";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { GoogleSignin, GoogleSigninButton, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  signInWithAppleCredential,
  signInWithGoogleCredential,
  signInWithEmail,
  signUpWithEmail,
} from "@/services/firebase";
import { env } from "@/config/env";
import { colors, radius, spacing, pressedOpacity } from "@/theme/tokens";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { Sentry } from "@/services/sentry";
import { Icon } from "@/components/ui/Icon";
import { authErrorToField, passwordStrength, validateAuthForm, type FieldErrors } from "@/auth/signInForm";

// Real Firebase-backed sign-in (Google/Apple/Email), optional -- the app already works fully
// signed in anonymously (see firebase.ts's ensureSignedIn), this just upgrades that same
// session to a real identity so it's recoverable across devices/reinstalls. Phone number
// sign-in is deliberately not offered here: Firebase's phone auth needs a browser reCAPTCHA
// that doesn't exist in a native app, unlike Google/Apple/Email which all work the same way
// on mobile as they logically do on web.
// iOS needs the iOS client ID; Android needs the web client ID (for the ID token Firebase checks).
const googleConfigured = Platform.OS === "android" ? !!env.googleWebClientId : !!env.googleIosClientId;

export function SignInScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // A plain `busy` state read is only as fresh as the closure it's captured in, and (per
  // onAppleSignIn's own comment) a fast enough double-tap can hit the exact same closure/render
  // twice before React ever re-renders with busy=true -- a ref is mutated synchronously and
  // shared across every closure regardless of render timing, so it's the only reliable guard
  // against that race.
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Defaults to true on iOS, not false -- isAvailableAsync() is a real async native call, and
  // starting from false meant the Apple button was invisible for that brief window on every
  // single mount, not just some rare edge case (worse under load -- a slow JS thread from
  // whatever else the app was doing right before navigating here stretches that window). Every
  // real device this ever needs to hide on is iOS 12 or earlier, which expo-apple-authentication
  // doesn't support running on at all, so optimistically-true is correct for the overwhelming
  // common case and only flips off in the genuine rare case the check itself says no.
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === "ios");

  // The header says which form this is; the back button keeps the previous screen's name.
  useEffect(() => {
    navigation.setOptions({ title: mode === "signup" ? "Create account" : "Sign in" });
  }, [mode, navigation]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  useEffect(() => {
    if (!googleConfigured) return;
    GoogleSignin.configure({ iosClientId: env.googleIosClientId || undefined, webClientId: env.googleWebClientId || undefined });
  }, []);

  const onAppleSignIn = useCallback(async () => {
    // Apple's own identity servers are the slow part of this flow, not anything this app does
    // -- on a weak connection (low signal, low battery throttling background network activity)
    // AppleAuthentication.signInAsync can hang for a long time with zero feedback, which reads
    // as "takes forever to load" even though the busy dimming below IS active the whole time.
    // Bounding each attempt with a real timeout turns an indefinite hang into a clear, actionable
    // error instead of a screen that looks frozen.
    const APPLE_SIGN_IN_TIMEOUT_MS = 20_000;
    function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error(message), { code: "TIMEOUT" })), ms);
        promise.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    }

    // Real, confirmed cause of "Firebase: Duplicate credential received... (auth/missing-or-
    // invalid-nonce)": AppleAuthenticationButton has no `disabled` prop at all (unlike
    // GoogleSigninButton right below it, which already had one), so a second tap while the
    // first request was still in flight fired this a second time, each generating its own fresh
    // rawNonce/hashedNonce pair. Apple's native sign-in sheet can then hand back a credential
    // tied to the EARLIER request's nonce while this second call is the one that reaches
    // signInWithAppleCredential with the newer rawNonce -- Firebase hashes that newer rawNonce,
    // it doesn't match the nonce baked into the identity token it actually received, and rejects
    // it as a mismatched/duplicate credential. busyRef (not the `busy` state -- see its own
    // comment) is checked and set synchronously, so it also holds even against two taps fast
    // enough to both hit this same closure before a re-render ever lands.
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);

    // A single native Apple sign-in + Firebase credential attempt -- pulled out so the catch
    // block below can retry it once with a completely fresh nonce/native request.
    const attempt = async () => {
      // Firebase's Apple provider requires a nonce for replay protection: Apple needs the
      // SHA-256 hash (hex) so it can embed it in the identity token's own "nonce" claim,
      // Firebase needs the original raw value back so it can hash it itself and compare.
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await withTimeout(
        AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        }),
        APPLE_SIGN_IN_TIMEOUT_MS,
        "Apple sign-in is taking too long to respond -- check your connection and try again."
      );
      if (!credential.identityToken) {
        throw new Error("Apple didn't return an identity token -- try again.");
      }
      await signInWithAppleCredential(credential.identityToken, rawNonce);
    };

    try {
      try {
        await attempt();
      } catch (err: any) {
        if (err?.code === "ERR_REQUEST_CANCELED" || err?.code === "TIMEOUT") throw err;
        // Real, observed behavior distinct from the double-tap race this screen already
        // guards against: Apple's own ASAuthorizationController can, particularly during rapid
        // repeated sign-in attempts (exactly what testing looks like), hand back an
        // identityToken whose baked-in nonce claim doesn't match the nonce just requested --
        // nothing wrong on this app's side to fix, since a brand new nonce/native request is
        // generated correctly every single call (see rawNonce above). A fresh, fully separate
        // attempt with a NEW nonce/native request commonly clears it immediately; only surface
        // the raw error if the retry ALSO fails. Not retried on a timeout -- a slow/weak
        // connection is the far more likely cause there, and silently doubling the wait would
        // make "takes forever" worse, not better.
        if (err?.code !== "auth/missing-or-invalid-nonce" && err?.code !== "auth/invalid-credential") {
          throw err;
        }
        Sentry.logger.info("sign-in: Apple sign-in nonce mismatch, retrying once", { code: err.code });
        await attempt();
      }
      Sentry.logger.info("sign-in: Apple sign-in succeeded");
      navigation.goBack();
    } catch (err: any) {
      // A real, expected outcome (user tapped Cancel on the system sheet), not an error to
      // show -- matches how the Google branch below treats its own cancel code.
      if (err?.code === "ERR_REQUEST_CANCELED") return;
      Sentry.logger.error("sign-in: Apple sign-in failed", { error: String(err), code: err?.code });
      setError(
        err?.code === "TIMEOUT"
          ? err.message
          : err?.code === "auth/missing-or-invalid-nonce" || err?.code === "auth/invalid-credential"
            ? "Apple sign-in didn't complete correctly, likely due to a weak connection. Try again on a strong WiFi or cellular signal with Low Power Mode off."
            : err instanceof Error
              ? err.message
              : "Apple sign-in failed."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [navigation]);

  const onGoogleSignIn = useCallback(async () => {
    setError(null);
    if (!env.googleIosClientId) {
      setError("Google sign-in isn't configured for this build yet.");
      return;
    }
    setBusy(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (response.type !== "success") {
        Sentry.logger.info("sign-in: Google sign-in returned non-success", { type: response.type });
        return; // user cancelled the native sheet -- not an error
      }
      if (!response.data.idToken) {
        // A real, confirmed failure mode, not a cancellation -- the native picker completed
        // (an account was actually chosen) but Google didn't hand back a usable ID token, so
        // there's nothing to give Firebase. Previously this fell into the same silent `return`
        // as an actual cancel, which is exactly what looked like the whole flow "just resets"
        // with zero explanation -- the picker visibly ran and "succeeded" from the user's
        // side, then nothing happened and Settings still showed not signed in.
        Sentry.logger.error("sign-in: Google sign-in succeeded with no idToken", {
          hasUser: !!response.data.user,
        });
        setError("Google didn't return a usable sign-in token -- try again.");
        return;
      }
      await signInWithGoogleCredential(response.data.idToken);
      Sentry.logger.info("sign-in: Google sign-in succeeded");
      navigation.goBack();
    } catch (err: any) {
      if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return;
      Sentry.logger.error("sign-in: Google sign-in failed", {
        error: String(err),
        code: isErrorWithCode(err) ? err.code : undefined,
      });
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, [navigation]);

  const onEmailSubmit = useCallback(async () => {
    setError(null);
    const errs = validateAuthForm(mode, { name, email, password });
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email.trim(), password, name);
      } else {
        await signInWithEmail(email.trim(), password);
      }
      navigation.goBack();
    } catch (err: any) {
      const { field, message } = authErrorToField(err?.code, err instanceof Error ? err.message : "Something went wrong. Try again.");
      if (field === "form") setError(message);
      else setFieldErrors({ [field]: message });
    } finally {
      setBusy(false);
    }
  }, [email, password, name, mode, navigation]);

  const switchMode = () => {
    setError(null);
    setFieldErrors({});
    setMode((m) => (m === "signup" ? "signin" : "signup"));
  };
  const strength = mode === "signup" && password ? passwordStrength(password) : null;
  const policyBase = env.firebase.projectId ? `https://${env.firebase.projectId}.web.app` : null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" testID="sign-in-scroll">
        <Text style={styles.title} accessibilityRole="header">
          {mode === "signup" ? "Create account" : "Sign in"}
        </Text>
        <Text style={styles.subtitle}>Optional. Save your places, reports and settings so they come back on a new phone.</Text>

        {Platform.OS === "ios" && appleAvailable && (
          <View pointerEvents={busy ? "none" : "auto"} style={busy && styles.appleButtonBusy}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.md}
              style={styles.appleButton}
              onPress={onAppleSignIn}
            />
          </View>
        )}

        <GoogleSigninButton
          style={styles.googleButton}
          size={GoogleSigninButton.Size.Wide}
          color={GoogleSigninButton.Color.Light}
          onPress={onGoogleSignIn}
          disabled={busy || !googleConfigured}
        />
        {!googleConfigured && <Text style={styles.disabledNote}>Google sign-in isn&apos;t set up in this build yet.</Text>}

        <Button
          variant="secondary"
          icon="call"
          label="Continue with phone number"
          onPress={() => navigation.navigate("PhoneSignIn")}
          disabled={busy}
          fullWidth
          testID="phone-sign-in-button"
        />

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {mode === "signup" ? (
          <FieldBlock error={fieldErrors.name}>
            <TextInput
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (fieldErrors.name) setFieldErrors((e) => ({ ...e, name: undefined }));
              }}
              placeholder="Name"
              placeholderTextColor={colors.textFaint}
              autoComplete="name"
              textContentType="name"
              style={[styles.input, fieldErrors.name && styles.inputError]}
              accessibilityLabel="Name"
              testID="sign-in-name"
            />
          </FieldBlock>
        ) : null}

        <FieldBlock error={fieldErrors.email}>
          <TextInput
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (fieldErrors.email) setFieldErrors((e) => ({ ...e, email: undefined }));
            }}
            placeholder="Email"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            style={[styles.input, fieldErrors.email && styles.inputError]}
            accessibilityLabel="Email"
            testID="sign-in-email"
          />
        </FieldBlock>

        <FieldBlock error={fieldErrors.password} hint={!fieldErrors.password ? strength?.hint : undefined} hintTone={strength?.level}>
          <View style={[styles.input, styles.passwordRow, fieldErrors.password && styles.inputError]}>
            <TextInput
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: undefined }));
              }}
              placeholder="Password"
              placeholderTextColor={colors.textFaint}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              textContentType={mode === "signup" ? "newPassword" : "password"}
              style={styles.passwordInput}
              accessibilityLabel="Password"
              testID="sign-in-password"
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              testID="sign-in-show-password"
            >
              <Icon name={showPassword ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        </FieldBlock>

        {mode === "signup" ? (
          <Text style={styles.legal}>
            By creating an account you agree to the{" "}
            <Text style={styles.link} onPress={() => policyBase && Linking.openURL(`${policyBase}/terms.html`).catch(() => {})} accessibilityRole="link" testID="sign-in-terms">
              Terms of use
            </Text>{" "}
            and{" "}
            <Text style={styles.link} onPress={() => policyBase && Linking.openURL(`${policyBase}/privacy.html`).catch(() => {})} accessibilityRole="link" testID="sign-in-privacy">
              Privacy policy
            </Text>
            .
          </Text>
        ) : null}

        {error ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite" testID="sign-in-error">
            {error}
          </Text>
        ) : null}

        <Button
          variant="primary"
          label={mode === "signup" ? "Create account" : "Sign in"}
          onPress={onEmailSubmit}
          disabled={busy}
          size="large"
          fullWidth
          loading={busy}
          testID="sign-in-submit"
        />

        <View style={styles.links}>
          {mode !== "signup" ? (
            <>
              <Pressable onPress={() => navigation.navigate("AccountRecovery", { mode: "forgot" })} hitSlop={8} accessibilityRole="link" testID="forgot-password">
                <Text style={styles.linkText}>Forgot password?</Text>
              </Pressable>
              <Text style={styles.linkDot}>·</Text>
            </>
          ) : null}
          <Pressable onPress={() => navigation.navigate("AccountRecovery", {})} hitSlop={8} accessibilityRole="link" testID="cant-sign-in">
            <Text style={styles.linkText}>Can&apos;t sign in?</Text>
          </Pressable>
        </View>
        <Pressable onPress={switchMode} hitSlop={8} accessibilityRole="button" testID="sign-in-switch-mode">
          <Text style={styles.linkText}>{mode === "signup" ? "Have an account? Sign in" : "New here? Create account"}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A field with its error (red) or hint right under it. */
function FieldBlock({ children, error, hint, hintTone }: { children: React.ReactNode; error?: string; hint?: string; hintTone?: "weak" | "okay" | "strong" }) {
  return (
    <View style={styles.field}>
      {children}
      {error ? (
        <Text style={styles.fieldError} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.fieldHint, hintTone === "strong" ? styles.hintStrong : hintTone === "weak" ? styles.hintWeak : null]} testID="password-strength">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surfaceMuted },
  container: {
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xl,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.md,
  },
  field: { gap: 4 },
  inputError: { borderColor: colors.danger },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  passwordInput: { flex: 1, fontSize: 15, color: colors.text, height: 46 },
  fieldError: { fontSize: 13, color: colors.danger },
  fieldHint: { fontSize: 13, color: colors.textMuted },
  hintWeak: { color: colors.warning },
  hintStrong: { color: colors.goodText },
  legal: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  link: { color: colors.accent, fontWeight: "600" },
  links: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  linkText: { fontSize: 14, color: colors.accent, textAlign: "center", fontWeight: "600" },
  linkDot: { fontSize: 14, color: colors.textMuted },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 21,
  },
  appleButton: {
    height: 48,
    width: "100%",
  },
  appleButtonBusy: {
    opacity: pressedOpacity,
  },
  googleButton: {
    width: "100%",
    height: 48,
  },
  disabledNote: {
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: 12,
    color: colors.textFaint,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 48,
    fontSize: 15,
    color: colors.text,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
});
