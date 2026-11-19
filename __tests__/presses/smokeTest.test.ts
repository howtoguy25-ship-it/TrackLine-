// The dev-build Smoke test screen's check for one screen: opened + no errors = pass; didn't open,
// or an error while it was up = fail with the reason.
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/navigation/deepLinks", () => ({ navigationRef: {} }));
import { openAndCheck } from "@/screens/SmokeTestScreen";

function fakeNav(opens: boolean, onOpen?: () => void) {
  let current = "SmokeTest";
  return {
    navigate: (n: string) => {
      if (opens) {
        current = n;
        onOpen?.();
      }
    },
    goBack: () => {
      current = "SmokeTest";
    },
    currentName: () => current,
  };
}

describe("smoke test: one screen", () => {
  it("opens cleanly -> pass, and comes back", async () => {
    const nav = fakeNav(true);
    expect(await openAndCheck("Inbox", nav, [], 10)).toEqual({ screen: "Inbox", ok: true, detail: "opened, no errors" });
    expect(nav.currentName()).toBe("SmokeTest");
  });
  it("an error while it's up -> fail with the error", async () => {
    const errors: string[] = [];
    const r = await openAndCheck("Inbox", fakeNav(true, () => errors.push("TypeError: x is undefined")), errors, 10);
    expect(r).toEqual({ screen: "Inbox", ok: false, detail: "TypeError: x is undefined" });
  });
  it("never opens -> fail, saying where it stayed", async () => {
    const r = await openAndCheck("Inbox", fakeNav(false), [], 10);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("didn't open (current: SmokeTest)");
  }, 10000);
});
