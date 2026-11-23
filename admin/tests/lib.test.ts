import { describe, expect, it } from "vitest";
import { IDLE_LIMIT_MS, isIdleExpired, minutesLeft } from "../lib/session";
import { canDo, navFor } from "../lib/nav";

describe("30-minute idle sign-out", () => {
  it("expires at 30 minutes without activity, not before", () => {
    expect(IDLE_LIMIT_MS).toBe(30 * 60 * 1000);
    expect(isIdleExpired(0, 29 * 60 * 1000)).toBe(false);
    expect(isIdleExpired(0, 30 * 60 * 1000)).toBe(true);
    expect(minutesLeft(0, 25 * 60 * 1000)).toBe(5);
  });
});

describe("sidebar and buttons by role (the server enforces the same rules)", () => {
  it("viewer reads but can't act; moderator sees moderation only; only the owner grants roles", () => {
    expect(navFor("viewer").map((n) => n.label)).not.toContain("Staff roles");
    expect(canDo("viewer", "users.act")).toBe(false);
    expect(navFor("moderator").map((n) => n.label)).toEqual(["Overview", "Users", "Moderation", "Map editor"]);
    expect(canDo("support", "users.billing")).toBe(false);
    expect(canDo("admin", "roles.grant")).toBe(false);
    expect(canDo("owner", "roles.grant")).toBe(true);
    expect(navFor(null)).toEqual([]);
  });
});
