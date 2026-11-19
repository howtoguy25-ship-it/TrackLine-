// Sign in / Create account: plain subtitle, every way in, show/hide password, errors under the
// field they belong to, the strength hint, the name on sign-up, and terms + privacy links.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { authErrorToField, passwordStrength, validateAuthForm } from "@/auth/signInForm";

jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => require("../presses/mockNavigation").mockNavigation,
}));
jest.mock("expo-apple-authentication", () => ({
  isAvailableAsync: () => Promise.resolve(false),
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock("expo-crypto", () => ({}));
jest.mock("@react-native-google-signin/google-signin", () => {
  const { Pressable } = require("react-native");
  const GoogleSigninButton = (p: object) => require("react").createElement(Pressable, { ...p, testID: "google-button" });
  GoogleSigninButton.Size = { Wide: 1 };
  GoogleSigninButton.Color = { Light: 1 };
  return { GoogleSignin: { configure: () => {} }, GoogleSigninButton, isErrorWithCode: () => false, statusCodes: {} };
});
const mockSignIn = jest.fn<(e: string, p: string) => Promise<unknown>>();
const mockSignUp = jest.fn<(e: string, p: string, n?: string) => Promise<unknown>>();
jest.mock("@/services/firebase", () => ({
  signInWithAppleCredential: jest.fn(),
  signInWithGoogleCredential: jest.fn(),
  signInWithEmail: (e: string, p: string) => mockSignIn(e, p),
  signUpWithEmail: (e: string, p: string, n?: string) => mockSignUp(e, p, n),
}));
jest.mock("@/services/sentry", () => ({ Sentry: { logger: { error: () => {}, info: () => {} } } }));

import { SignInScreen } from "@/screens/SignInScreen";
import { mockNavigation, resetMockNavigation } from "../presses/mockNavigation";

describe("form rules", () => {
  it("each missing or bad field gets its own message", () => {
    expect(validateAuthForm("signin", { name: "", email: "", password: "" })).toEqual({ email: "Enter your email.", password: "Enter your password." });
    expect(validateAuthForm("signup", { name: "", email: "a@b", password: "short" })).toEqual({
      name: "Enter your name.",
      email: "That email address doesn't look right.",
      password: "Use at least 8 characters.",
    });
    expect(validateAuthForm("signup", { name: "Sam", email: "sam@example.com", password: "long enough" })).toEqual({});
  });

  it("strength hint: short is weak, long and mixed is strong", () => {
    expect(passwordStrength("abc").level).toBe("weak");
    expect(passwordStrength("abcdefgh").level).toBe("weak");
    expect(passwordStrength("abcdefghij").level).toBe("okay");
    expect(passwordStrength("Abcdefgh12!x").level).toBe("strong");
  });

  it("Firebase errors land under the right field", () => {
    expect(authErrorToField("auth/invalid-credential", "x").field).toBe("password");
    expect(authErrorToField("auth/email-already-in-use", "x")).toEqual({ field: "email", message: "That email already has an account. Sign in instead." });
    expect(authErrorToField("auth/network-request-failed", "x").field).toBe("form");
    expect(authErrorToField("something-else", "Fallback")).toEqual({ field: "form", message: "Fallback" });
  });
});

describe("Sign in screen", () => {
  beforeEach(() => {
    resetMockNavigation();
    mockSignIn.mockReset();
    mockSignUp.mockReset();
  });

  it("plain subtitle, no '--', every way in, and the links", async () => {
    await render(<SignInScreen />);
    expect(screen.getByText("Optional. Save your places, reports and settings so they come back on a new phone.")).toBeTruthy();
    expect(screen.getByTestId("google-button")).toBeTruthy();
    expect(screen.getByTestId("phone-sign-in-button")).toBeTruthy();
    expect(screen.getByText("or")).toBeTruthy();
    expect(screen.getByText("Forgot password?")).toBeTruthy();
    expect(screen.getByText("Can't sign in?")).toBeTruthy();
    expect(screen.getByText("New here? Create account")).toBeTruthy();
    expect(screen.queryByText(/--/)).toBeNull();
    expect(screen.queryByText(/MainMenu/)).toBeNull();
    expect(mockNavigation.setOptions).toHaveBeenCalledWith({ title: "Sign in" });
  });

  it("show / hide password", async () => {
    await render(<SignInScreen />);
    expect(screen.getByTestId("sign-in-password").props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByTestId("sign-in-show-password"));
    expect(screen.getByTestId("sign-in-password").props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText("Hide password")).toBeTruthy();
  });

  it("empty submit shows errors under each field and doesn't call Firebase", async () => {
    await render(<SignInScreen />);
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(screen.getByText("Enter your email.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("a wrong password shows under the password field", async () => {
    mockSignIn.mockRejectedValue(Object.assign(new Error("bad"), { code: "auth/invalid-credential" }));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId("sign-in-email"), "sam@example.com");
    await fireEvent.changeText(screen.getByTestId("sign-in-password"), "whatever1");
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(mockSignIn).toHaveBeenCalledWith("sam@example.com", "whatever1");
    expect(screen.getByText("Incorrect email or password.")).toBeTruthy();
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });

  it("create account: name, strength hint, terms + privacy, and the name is saved", async () => {
    mockSignUp.mockResolvedValue({});
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByTestId("sign-in-switch-mode"));
    expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ title: "Create account" });
    expect(screen.getByTestId("sign-in-terms")).toBeTruthy();
    expect(screen.getByTestId("sign-in-privacy")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("sign-in-name"), "Sam Driver");
    await fireEvent.changeText(screen.getByTestId("sign-in-email"), "sam@example.com");
    await fireEvent.changeText(screen.getByTestId("sign-in-password"), "abc");
    expect(screen.getByTestId("password-strength")).toHaveTextContent(/Weak/);
    await fireEvent.changeText(screen.getByTestId("sign-in-password"), "Abcdefgh12!x");
    expect(screen.getByTestId("password-strength")).toHaveTextContent("Strong password.");
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(mockSignUp).toHaveBeenCalledWith("sam@example.com", "Abcdefgh12!x", "Sam Driver");
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});
