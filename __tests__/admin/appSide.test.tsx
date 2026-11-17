// Item 5, app side: remote config gates, account recovery screens, guest data protection,
// messages (inbox / banner / full screen) and Help requests.
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockCallable = jest.fn<(name: string, data: Record<string, unknown>) => Promise<{ data: unknown }>>();
jest.mock("@firebase/functions", () => ({ httpsCallable: (_f: unknown, name: string) => (data: Record<string, unknown>) => mockCallable(name, data) }));
jest.mock("firebase/firestore", () => ({
  ...require("../support/stubs").stubService(),
  doc: () => ({}),
  collection: () => ({}),
  query: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  serverTimestamp: () => 0,
}));
const mockCurrentUser: { current: { uid: string; isAnonymous: boolean } | null } = { current: { uid: "guest1", isAnonymous: true } };
jest.mock("@/services/firebase", () => ({
  db: {},
  functions: {},
  get auth() {
    return { currentUser: mockCurrentUser.current };
  },
}));
jest.mock("firebase/auth", () => ({ signInWithCustomToken: jest.fn(() => Promise.resolve()) }));
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;
jest.mock("@react-navigation/native", () => ({
  ...(jest.requireActual("@react-navigation/native") as object),
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const mockSendPhoneCode = jest.fn<(phone: string) => Promise<string>>();
const mockSignInExistingPhone = jest.fn<(vid: string, code: string) => Promise<unknown>>();
const mockConfirmPhoneCode = jest.fn<(vid: string, code: string) => Promise<unknown>>();
jest.mock("@/account/phoneAuth", () => ({
  ...(jest.requireActual("@/account/phoneAuth") as object),
  sendPhoneCode: (p: string) => mockSendPhoneCode(p),
  signInExistingPhone: (v: string, c: string) => mockSignInExistingPhone(v, c),
  confirmPhoneCode: (v: string, c: string) => mockConfirmPhoneCode(v, c),
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));

import { bucket, isFeatureOn, remoteGated, shouldShowWhatsNew, updateState, normalise, EMPTY_CONFIG, type RemoteConfig } from "@/remote/appConfig";
import { contactKind, maskPhoneForDisplay, parseMonth, toInternational, RECOVERY_CHAT } from "@/account/recovery";
import { EMPTY_PROMPT_STATE, GUEST_WARNING, shouldPrompt, maybePromptToSave, onSavePrompt, recordTripEnd } from "@/guest/savePrompt";
import { activeAnnouncement, activeBanner, localised, type InboxMessage } from "@/services/inboxMessages";
import { featureFlags, locationPatch, notificationPrefs, roundApprox } from "@/services/targeting";
import { deepLinkTarget } from "@/navigation/deepLinks";
import { DEFAULT_SETTINGS } from "@/services/settings";
import { AccountRecoveryScreen } from "@/screens/AccountRecoveryScreen";
import { SupportRequestsScreen } from "@/screens/SupportRequestsScreen";

const ok = (data: unknown) => Promise.resolve({ data });
const DAY = 86_400_000;

beforeEach(async () => {
  mockCallable.mockReset();
  mockGoBack.mockReset();
  mockNavigate.mockReset();
  mockRouteParams = undefined;
  await AsyncStorage.clear();
});

describe("remote config (App control)", () => {
  const cfg = (flags: RemoteConfig["flags"], extra: Partial<RemoteConfig> = {}): RemoteConfig => ({ ...EMPTY_CONFIG, flags, ...extra });
  it("a feature the dashboard never mentioned stays on; off means off", () => {
    expect(isFeatureOn(null, "vehicleCheck", {})).toBe(true);
    expect(isFeatureOn(cfg({ vehicleCheck: { enabled: false, percent: 100, countries: [] } }), "vehicleCheck", { uid: "u" })).toBe(false);
  });
  it("per country", () => {
    const c = cfg({ ads: { enabled: true, percent: 100, countries: ["AU"] } });
    expect(isFeatureOn(c, "ads", { country: "AU" })).toBe(true);
    expect(isFeatureOn(c, "ads", { country: "NZ" })).toBe(false);
  });
  it("per % of users: the same users every time, close to the % asked for", () => {
    const c = cfg({ trackys: { enabled: true, percent: 20, countries: [] } });
    const uids = Array.from({ length: 2000 }, (_, i) => `user${i}`);
    const on = uids.filter((u) => isFeatureOn(c, "trackys", { uid: u })).length;
    expect(on / 2000).toBeGreaterThan(0.17);
    expect(on / 2000).toBeLessThan(0.23);
    expect(bucket("user7", "trackys")).toBe(bucket("user7", "trackys"));
  });
  it("forced / soft update by platform and version", () => {
    const c = cfg({}, { minVersion: { ios: { soft: "2.1.0", force: "2.0.0" } } });
    expect(updateState(c, "ios", "1.9.9")).toBe("force");
    expect(updateState(c, "ios", "2.0.5")).toBe("soft");
    expect(updateState(c, "ios", "2.1.0")).toBe("none");
    expect(updateState(c, "android", "1.0.0")).toBe("none");
  });
  it("What's New shows once, for that version only", () => {
    const c = cfg({}, { whatsNew: { version: "2.1.0", title: "New", items: ["Lanes"] } });
    expect(shouldShowWhatsNew(c, "2.1.0", null)).toBe(true);
    expect(shouldShowWhatsNew(c, "2.1.0", "2.1.0")).toBe(false);
    expect(shouldShowWhatsNew(c, "2.2.0", null)).toBe(false);
  });
  it("kill switches apply on top of the driver's own settings", () => {
    const g = remoteGated(DEFAULT_SETTINGS, { trackys: false, schoolZones: true, liveTraffic: false });
    expect(g.showTrackysOnMap).toBe(false);
    expect(g.showLiveTraffic).toBe(false);
    expect(g.schoolZonesShowOnMap).toBe(DEFAULT_SETTINGS.schoolZonesShowOnMap);
    expect(remoteGated(DEFAULT_SETTINGS, { trackys: true, schoolZones: true, liveTraffic: true })).toBe(DEFAULT_SETTINGS);
  });
  it("a broken doc reads as 'nothing changed'", () => {
    expect(normalise({ maintenance: { mode: "explode" } }).maintenance.mode).toBe("off");
  });
});

describe("recovery helpers", () => {
  it("email or full phone; Australian mobiles get +61", () => {
    expect(contactKind("jane@example.com")).toBe("email");
    expect(contactKind(toInternational("0412 345 678"))).toBe("phone");
    expect(toInternational("0412 345 678")).toBe("+61412345678");
    expect(contactKind("hello")).toBe(null);
    expect(maskPhoneForDisplay("+61412343456")).toBe("•••• ••3 456");
  });
  it("months typed several ways", () => {
    expect(parseMonth("March 2025")).toBe("2025-03");
    expect(parseMonth("3/2025")).toBe("2025-03");
    expect(parseMonth("2025-3")).toBe("2025-03");
    expect(parseMonth("whenever")).toBe(null);
  });
  it("the chat asks for the sign-up contact first", () => {
    expect(RECOVERY_CHAT[0]).toMatchObject({ key: "signUpContact", required: true });
  });
});

describe("Forgot password / Can't sign in? screen", () => {
  it("phone: Firebase texts the code; the right code signs in, then a new password; other devices signed out", async () => {
    mockRouteParams = { mode: "forgot" };
    mockSendPhoneCode.mockResolvedValue("vid-1");
    mockSignInExistingPhone.mockResolvedValue({ uid: "u1", providerData: [{ providerId: "phone" }] });
    mockCallable.mockImplementation((name, data) => ok(data.op === "afterPhoneReset" ? { ok: true, customToken: null } : { ok: true }));
    await render(<AccountRecoveryScreen />);
    await fireEvent.changeText(screen.getByTestId("recovery-contact"), "0412 345 678");
    await fireEvent.press(screen.getByTestId("recovery-send"));
    expect(mockCallable.mock.calls[0][1]).toMatchObject({ op: "phoneStart", phone: "+61412345678" });
    expect(mockSendPhoneCode).toHaveBeenCalledWith("0412 345 678");
    expect(screen.getByText(/We texted a 6-digit code to •••• ••5 678/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("recovery-fb-code"), "123456");
    await fireEvent.press(screen.getByText("Continue"));
    expect(mockSignInExistingPhone).toHaveBeenCalledWith("vid-1", "123456");
    expect(mockCallable.mock.calls.some((c) => c[1].op === "afterPhoneReset")).toBe(true);
    expect(screen.getByText(/Every other device was signed out/)).toBeTruthy();
  });
  it("phone: a wrong code shows Firebase's message; no account for the number says so to its owner", async () => {
    mockRouteParams = { mode: "forgot" };
    mockSendPhoneCode.mockResolvedValue("vid-2");
    mockCallable.mockImplementation(() => ok({ ok: true }));
    mockSignInExistingPhone.mockRejectedValueOnce(new Error("That code isn't right."));
    await render(<AccountRecoveryScreen />);
    await fireEvent.changeText(screen.getByTestId("recovery-contact"), "+61412345678");
    await fireEvent.press(screen.getByTestId("recovery-send"));
    await fireEvent.changeText(screen.getByTestId("recovery-fb-code"), "000000");
    await fireEvent.press(screen.getByText("Continue"));
    expect(screen.getByTestId("recovery-error").props.children).toBe("That code isn't right.");
    mockSignInExistingPhone.mockResolvedValueOnce(null);
    await fireEvent.press(screen.getByText("Continue"));
    expect(screen.getByText(/No TrackLine account uses that number/)).toBeTruthy();
  });
  it("email: Firebase's reset link, same wording either way", async () => {
    mockRouteParams = { mode: "forgot" };
    mockCallable.mockImplementation(() => ok({ ok: true, channel: "email", message: "If an account exists for that email, we've sent a link to reset your password.", challengeId: null }));
    await render(<AccountRecoveryScreen />);
    await fireEvent.changeText(screen.getByTestId("recovery-contact"), "jane@example.com");
    await fireEvent.press(screen.getByTestId("recovery-send"));
    expect(screen.getByText(/If an account exists for that email/)).toBeTruthy();
  });
  it("assisted: chat -> verify the new contact -> ticket", async () => {
    mockCallable.mockImplementation((name, data) => {
      if (data.op === "newContactStart") return ok({ ok: true, challengeId: "n1" });
      if (data.op === "newContactVerify") return ok({ ok: true, proof: "p1" });
      if (data.op === "ticket") return ok({ ok: true, ticketId: "t1", message: "Thanks." });
      return ok({});
    });
    await render(<AccountRecoveryScreen />);
    await fireEvent.press(screen.getByTestId("recovery-assisted"));
    await fireEvent.changeText(screen.getByTestId("recovery-chat-input"), "jane@example.com");
    await fireEvent.press(screen.getByText("Next"));
    await fireEvent.changeText(screen.getByTestId("recovery-chat-input"), "March 2025");
    await fireEvent.press(screen.getByText("Next"));
    for (let i = 2; i < RECOVERY_CHAT.length; i++) await fireEvent.press(screen.getByText("Skip"));
    await fireEvent.changeText(screen.getByTestId("recovery-new-contact"), "new@example.com");
    await fireEvent.press(screen.getByText("Send code"));
    await fireEvent.changeText(screen.getByPlaceholderText("6-digit code"), "111111");
    await fireEvent.press(screen.getByText("Send to the TrackLine team"));
    const ticket = mockCallable.mock.calls.find((c) => c[1].op === "ticket")![1];
    expect(ticket).toMatchObject({ signUpEmail: "jane@example.com", approxSignupMonth: "2025-03", proof: "p1" });
    expect(screen.getByText(/24 hours later/)).toBeTruthy();
  });
  it("cancel a change with the reference and code", async () => {
    mockRouteParams = { mode: "cancel" };
    mockCallable.mockImplementation(() => ok({ ok: true }));
    await render(<AccountRecoveryScreen />);
    await fireEvent.changeText(screen.getByTestId("recovery-change-id"), "abc123");
    await fireEvent.changeText(screen.getByPlaceholderText("6-digit code"), "654321");
    await fireEvent.press(screen.getByText("Cancel the change"));
    expect(mockCallable.mock.calls[0][1]).toEqual({ op: "cancelChange", changeId: "abc123", code: "654321" });
  });
});

describe("guests: Save your TrackLine", () => {
  it("good moments only, not too often, and never for a real account", () => {
    const now = 10 * DAY;
    expect(shouldPrompt("savedHomeWork", EMPTY_PROMPT_STATE, true, now)).toBe(true);
    expect(shouldPrompt("savedHomeWork", EMPTY_PROMPT_STATE, false, now)).toBe(false);
    expect(shouldPrompt("purchase", { ...EMPTY_PROMPT_STATE, lastPromptAtMs: now - DAY }, true, now)).toBe(false);
    expect(shouldPrompt("tripEnded", { ...EMPTY_PROMPT_STATE, trips: 2 }, true, now)).toBe(false);
    expect(shouldPrompt("tripEnded", { ...EMPTY_PROMPT_STATE, trips: 3 }, true, now)).toBe(true);
    expect(shouldPrompt("purchase", { ...EMPTY_PROMPT_STATE, dismissals: 3 }, true, now)).toBe(false);
  });
  it("the 3rd trip prompts a guest, and trips are counted on the server", async () => {
    mockCallable.mockImplementation(() => ok({ counted: true }));
    const seen: string[] = [];
    const off = onSavePrompt((m) => seen.push(m));
    for (let i = 0; i < 3; i++) await recordTripEnd(1_000_000 + i * 3 * 60_000);
    off();
    expect(seen).toEqual(["tripEnded"]);
    expect(mockCallable.mock.calls.filter((c) => c[0] === "recordTrip")).toHaveLength(3);
  });
  it("a signed-in driver is never prompted", async () => {
    mockCurrentUser.current = { uid: "u1", isAnonymous: false };
    expect(await maybePromptToSave("purchase")).toBe(false);
    mockCurrentUser.current = { uid: "guest1", isAnonymous: true };
  });
  it("the warning says exactly what's at risk", () => {
    expect(GUEST_WARNING).toBe("If you delete the app or change phones, your saved places and settings will be lost unless you create an account.");
  });
});

describe("messages and targeting", () => {
  const msg = (over: Partial<InboxMessage>): InboxMessage => ({ id: "m", campaignId: "c", title: "Hi", body: "Body", category: "news", channels: ["inbox"], imageUrl: null, button: null, translations: {}, from: "TrackLine", createdAtMs: 1, openedAtMs: null, clickedAtMs: null, dismissedAtMs: null, ...over });
  it("the phone's language when the dashboard wrote one", () => {
    expect(localised(msg({ translations: { es: { title: "Hola", body: "Cuerpo" } } }), "es").title).toBe("Hola");
    expect(localised(msg({}), "es").title).toBe("Hi");
  });
  it("banner / full-screen: the newest one not dismissed or opened", () => {
    const list = [msg({ id: "a", channels: ["banner"], createdAtMs: 1 }), msg({ id: "b", channels: ["banner"], createdAtMs: 2, dismissedAtMs: 5 }), msg({ id: "c", channels: ["fullscreen"], createdAtMs: 3 })];
    expect(activeBanner(list)?.id).toBe("a");
    expect(activeAnnouncement(list)?.id).toBe("c");
    expect(activeAnnouncement([msg({ channels: ["fullscreen"], openedAtMs: 9 })])).toBeNull();
  });
  it("Notification settings go to the server as fun / news / traffic", () => {
    expect(notificationPrefs({ ...DEFAULT_SETTINGS, notifyTraffic: false })).toEqual({ fun: true, news: true, traffic: false });
    expect(featureFlags(DEFAULT_SETTINGS).trackys).toBe(true);
  });
  it("location is rounded to ~1 km and only re-sent after a move", () => {
    expect(roundApprox(-33.86882)).toBe(-33.87);
    const p = locationPatch(-33.8688, 151.2093, null);
    expect(p).toEqual({ approxLat: -33.87, approxLng: 151.21, state: "NSW" });
    expect(locationPatch(-33.8701, 151.2105, { lat: -33.87, lng: 151.21 })).toBeNull();
  });
  it("message buttons open real screens; unknown links do nothing", () => {
    expect(deepLinkTarget("trackline://vehicle-check")).toEqual({ screen: "VehicleCheck" });
    expect(deepLinkTarget("trackline://update")).toEqual({ external: "store" });
    expect(deepLinkTarget("https://evil.example")).toBeNull();
  });
});

describe("Help > Contact support", () => {
  it("sends a request and lists it", async () => {
    let tickets: unknown[] = [];
    mockCallable.mockImplementation((name, data) => {
      if (data.op === "list") return ok({ tickets });
      if (data.op === "create") {
        tickets = [{ id: "t1", subject: data.subject, status: "new", updatedAtMs: 1 }];
        return ok({ ok: true, id: "t1" });
      }
      return ok({});
    });
    await render(<SupportRequestsScreen />);
    await waitFor(() => expect(screen.getByText("None yet.")).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("support-subject"), "Map blank");
    await fireEvent.changeText(screen.getByTestId("support-text"), "Since the update");
    await fireEvent.press(screen.getByTestId("support-send"));
    expect(mockCallable.mock.calls.find((c) => c[1].op === "create")![1]).toMatchObject({ subject: "Map blank", text: "Since the update" });
    await waitFor(() => expect(screen.getByText("Map blank")).toBeTruthy());
    expect(screen.getByText("Sent")).toBeTruthy();
  });
});

describe("legal: accept a major change once", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pendingAcceptance } = require("@/components/LegalGate") as typeof import("@/components/LegalGate");
  it("asks only for a major version newer than the one accepted", () => {
    const docs = { privacy: { version: 3, lastMajorVersion: 2, text: "t" } };
    expect(pendingAcceptance(docs, {})).toBe("privacy");
    expect(pendingAcceptance(docs, { privacy: 2 })).toBe(null);
    expect(pendingAcceptance({ privacy: { version: 3, lastMajorVersion: null, text: "t" } }, {})).toBe(null);
  });
});

describe("phone number sign-in (Firebase SMS)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parsePhoneReturn, verifyPageUrl, phoneErrorText } = jest.requireActual("@/account/phoneAuth") as typeof import("@/account/phoneAuth");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PhoneSignInScreen } = require("@/screens/PhoneSignInScreen") as typeof import("@/screens/PhoneSignInScreen");
  it("the hosted page is on the project's own site and only returns to the app", () => {
    expect(verifyPageUrl("+61412345678", "demo-proj")).toBe("https://demo-proj.web.app/phone-verify.html?phone=%2B61412345678&return=trackline%3A%2F%2Fphone-auth");
    expect(parsePhoneReturn("trackline://phone-auth?vid=abc%3D")).toEqual({ vid: "abc=" });
    expect(parsePhoneReturn("trackline://phone-auth?error=too-many-requests")).toEqual({ error: "too-many-requests" });
    expect(phoneErrorText("auth/invalid-verification-code")).toBe("That code isn't right.");
  });
  it("number -> code -> signed in (a guest's account becomes the phone account)", async () => {
    mockSendPhoneCode.mockResolvedValue("vid-9");
    mockConfirmPhoneCode.mockResolvedValue({ user: { uid: "guest1" }, isNewUser: false });
    await render(<PhoneSignInScreen />);
    await fireEvent.changeText(screen.getByTestId("phone-number"), "0412 345 678");
    await fireEvent.press(screen.getByTestId("phone-send"));
    await fireEvent.changeText(screen.getByTestId("phone-code"), "246810");
    await fireEvent.press(screen.getByTestId("phone-confirm"));
    expect(mockConfirmPhoneCode).toHaveBeenCalledWith("vid-9", "246810");
    expect(mockGoBack).toHaveBeenCalled();
  });
  it("shows why the code wasn't sent", async () => {
    mockSendPhoneCode.mockRejectedValue(new Error("Too many tries from this phone. Wait a while and try again."));
    await render(<PhoneSignInScreen />);
    await fireEvent.changeText(screen.getByTestId("phone-number"), "+61412345678");
    await fireEvent.press(screen.getByTestId("phone-send"));
    expect(screen.getByTestId("phone-error").props.children).toMatch(/Too many tries/);
  });
});
