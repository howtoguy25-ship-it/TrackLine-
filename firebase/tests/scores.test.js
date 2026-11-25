// Gap item 15 (server): points only for what the server saw -- a report going live, others
// confirming it, voting on someone else's report; weekly reset; levels; never below zero.
const { applyScore, levelFor, weekKey, SCORES } = require("../functions/reports/scores");

const MON = Date.UTC(2026, 10, 23, 2); // Mon 23 Nov 2026, 1 pm Sydney

test("a live report, confirmations and votes add up; counters for badges", () => {
  let s = applyScore(null, "reportPublished", MON, "Sam");
  s = applyScore(s, "confirmedByOther", MON + 1000);
  s = applyScore(s, "vote", MON + 2000);
  expect(s).toMatchObject({ points: 9, weekPoints: 9, reports: 1, confirmationsReceived: 1, votes: 1, name: "Sam", level: "Learner" });
});

test("a new week starts the weekly points again, total kept", () => {
  const s = applyScore(applyScore(null, "reportPublished", MON), "vote", MON + 7 * 86400_000);
  expect(s.points).toBe(6);
  expect(s.weekPoints).toBe(1);
  expect(s.weekKey).not.toBe(weekKey(MON));
});

test("removed reports cost points but never below zero; levels by total", () => {
  expect(applyScore(null, "reportRemoved", MON).points).toBe(0);
  expect(levelFor(0)).toBe("Learner");
  expect(levelFor(SCORES.levels[2].min)).toBe(SCORES.levels[2].name);
  expect(levelFor(1e9)).toBe("Road legend");
});

test("week keys are Monday-start in Sydney", () => {
  expect(weekKey(MON)).toBe("2026-W48");
  expect(weekKey(MON - 3 * 3600_000)).toBe("2026-W48"); // Mon 10 am Sydney
  expect(weekKey(MON - 14 * 3600_000)).toBe("2026-W47"); // Sun 11 pm Sydney
});
