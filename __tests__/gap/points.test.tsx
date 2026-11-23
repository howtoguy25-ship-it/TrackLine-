// Gap 15 (app side): level progress, badges, this week's points, the leaderboard's privacy, the
// same week as the server, and the screen's real states (loading, error + Try again, empty).
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockFetchMyScore = jest.fn<(uid: string) => Promise<unknown>>();
const mockFetchLeaderboard = jest.fn<(now: number, uid: string | null) => Promise<unknown>>();
jest.mock("@/services/firebase", () => ({ db: {} }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ setOptions: () => {}, navigate: () => {}, goBack: () => {} }) }));
jest.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ settings: { appearance: "light" }, updateSettings: () => Promise.resolve() }) }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { uid: "me" } }) }));
jest.mock("@/gamification/points", () => {
  const actual = jest.requireActual("@/gamification/points") as Record<string, unknown>;
  return { ...actual, fetchMyScore: (u: string) => mockFetchMyScore(u), fetchLeaderboard: (n: number, u: string | null) => mockFetchLeaderboard(n, u) };
});

import { EMPTY_SCORE, badgesFor, leaderRows, levelProgress, pointsThisWeek, weekKey } from "@/gamification/points";
import { PointsScreen } from "@/screens/PointsScreen";
const server = require("../../firebase/functions/reports/scores.js");

describe("points rules", () => {
  it("levels and progress to the next one", () => {
    expect(levelProgress(0)).toMatchObject({ name: "Learner", toNext: 50 });
    expect(levelProgress(125)).toMatchObject({ name: "P-plater", next: { name: "Road regular", min: 200 }, toNext: 75 });
    expect(levelProgress(125).fraction).toBeCloseTo(0.5);
    expect(levelProgress(10_000)).toMatchObject({ name: "Road legend", next: null, fraction: 1 });
    for (const p of [0, 49, 50, 600, 3999, 4000]) expect(levelProgress(p).name).toBe(server.levelFor(p));
  });
  it("the same week as the server, Monday start in Sydney", () => {
    for (const t of [Date.UTC(2026, 10, 23, 12), Date.UTC(2026, 10, 22, 13, 59), Date.UTC(2026, 10, 22, 14, 1), Date.UTC(2027, 0, 1)]) expect(weekKey(t)).toBe(server.weekKey(t));
  });
  it("badges from the server's counters; this week only counts this week", () => {
    const s = { ...EMPTY_SCORE, reports: 12, votes: 3, confirmationsReceived: 25 };
    const b = Object.fromEntries(badgesFor(s).map((x) => [x.id, x]));
    expect(b.firstReport.earned).toBe(true);
    expect(b.tenReports.earned).toBe(true);
    expect(b.trusted.earned).toBe(true);
    expect(b.helper).toMatchObject({ earned: false, have: 3, need: 20 });
    expect(b.centurion).toMatchObject({ earned: false, have: 12, need: 100 });
    const now = Date.UTC(2026, 10, 23, 12);
    expect(pointsThisWeek({ ...s, weekKey: weekKey(now), weekPoints: 40 }, now)).toBe(40);
    expect(pointsThisWeek({ ...s, weekKey: "2026-W01", weekPoints: 40 }, now)).toBe(0);
  });
  it("leaderboard: only names drivers chose to show; you are 'You'", () => {
    const rows = leaderRows(
      [
        { id: "a", data: { name: "Sam", weekPoints: 30, points: 300 } },
        { id: "b", data: { name: null, weekPoints: 20, points: 20 } },
        { id: "me", data: { name: "Me", weekPoints: 10, points: 60 } },
      ],
      "me"
    );
    expect(rows.map((r) => r.name)).toEqual(["Sam", "A TrackLine driver", "You"]);
    expect(rows[0].level).toBe("Road regular");
    expect(rows[2].you).toBe(true);
  });
});

describe("Points & badges screen", () => {
  beforeEach(() => {
    mockFetchMyScore.mockReset();
    mockFetchLeaderboard.mockReset();
  });

  it("shows your level, badges and the board", async () => {
    mockFetchMyScore.mockResolvedValue({ ...EMPTY_SCORE, points: 125, reports: 1, weekKey: weekKey(Date.now()), weekPoints: 15 });
    mockFetchLeaderboard.mockResolvedValue([{ uid: "a", name: "Sam", weekPoints: 30, level: "Road regular", you: false }]);
    const r = await render(<PointsScreen />);
    await act(async () => {});
    expect(r.getByText("P-plater")).toBeTruthy();
    expect(r.getByText("125 points · 15 this week")).toBeTruthy();
    expect(r.getByTestId("points-next").props.children).toBe("75 points to Road regular");
    expect(r.getByTestId("badge-firstReport")).toBeTruthy();
    expect(r.getByText("1. Sam")).toBeTruthy();
  });

  it("errors say why and Try again reloads; an empty week says so", async () => {
    mockFetchMyScore.mockRejectedValueOnce(new Error("Points timed out after 10000ms"));
    mockFetchLeaderboard.mockRejectedValueOnce(new Error("The query requires an index"));
    const r = await render(<PointsScreen />);
    await act(async () => {});
    expect(r.getByText("Couldn't load in 10 seconds — check your connection.")).toBeTruthy();
    expect(r.getByText("The leaderboard isn't switched on yet (it needs the latest server update).")).toBeTruthy();
    mockFetchMyScore.mockResolvedValue(EMPTY_SCORE);
    mockFetchLeaderboard.mockResolvedValue([]);
    await fireEvent.press(r.getByTestId("points-retry"));
    await act(async () => {});
    expect(mockFetchMyScore).toHaveBeenCalledTimes(2);
    expect(r.getByTestId("board-empty")).toBeTruthy();
    expect(r.getByText("Learner")).toBeTruthy();
  });
});
