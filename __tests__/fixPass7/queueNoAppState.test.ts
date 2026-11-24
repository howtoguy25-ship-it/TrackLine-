// Regression (CI run 45502518718): a screen test whose react-native mock has no AppState asked
// for a permission and the queue crashed reading AppState.currentState. With no AppState the app
// counts as in front, so the request still goes through.
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

describe("permission queue without AppState", () => {
  it("runs the request instead of crashing", async () => {
    const { askPermission } = require("@/services/permissionQueue") as typeof import("@/services/permissionQueue");
    await expect(askPermission("location", async () => ({ granted: true }))).resolves.toEqual({ granted: true });
  });
});
