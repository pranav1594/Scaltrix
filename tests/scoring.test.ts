import { describe, it, expect } from "vitest";
import { allocate, computeScores, sharesFromScores, splitProjectPayment, DEFAULT_SETTINGS, type PersonInputs } from "../src/engine";

const P = (id: string, rating: number, hours: number, hourWeight: number, taskPoints: number): PersonInputs => ({ id, rating, hours, hourWeight, taskPoints });
const team = [P("a", 8, 10, 1, 5), P("b", 6, 30, 1, 0), P("c", 6, 20, 2, 15)];

describe("scoring methods", () => {
  it("manual rating 8/6/6 -> 40/30/30", () => {
    expect(sharesFromScores(computeScores("manual_rating", team).scores)).toEqual([40, 30, 30]);
  });
  it("hours uses the role multiplier (10, 30, 40 -> 12.5/37.5/50)", () => {
    expect(sharesFromScores(computeScores("hours", team).scores)).toEqual([12.5, 37.5, 50]);
  });
  it("task points only count completed points (5,0,15 -> 25/0/75)", () => {
    expect(sharesFromScores(computeScores("task_points", team).scores)).toEqual([25, 0, 75]);
  });
  it("mix 40/40/20 blends percentages", () => {
    const r = computeScores("mix", team, { ratingBp: 4000, hoursBp: 4000, tasksBp: 2000 });
    const s = sharesFromScores(r.scores);
    // a: .4*40 + .4*12.5 + .2*25 = 26 ; b: .4*30+.4*37.5+0 = 27 ; c: .4*30+.4*50+.2*75 = 47
    expect(s[0]).toBeCloseTo(26, 6);
    expect(s[1]).toBeCloseTo(27, 6);
    expect(s[2]).toBeCloseTo(47, 6);
  });
  it("mix drops a component with no data and renormalises", () => {
    const noTasks = team.map((t) => ({ ...t, taskPoints: 0 }));
    const r = computeScores("mix", noTasks, { ratingBp: 4000, hoursBp: 4000, tasksBp: 2000 });
    expect(r.notes.length).toBe(1);
    expect(sharesFromScores(r.scores).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
  it("four methods give different splits on the same team", () => {
    const sets = (["manual_rating", "hours", "task_points", "mix"] as const).map((m) => sharesFromScores(computeScores(m, team).scores).map((x) => x.toFixed(2)).join());
    expect(new Set(sets).size).toBe(4);
  });
});

describe("exact allocation with big weights", () => {
  it("sums exactly to the total even for huge weights", () => {
    const parts = allocate(123_456_789_01, [333_333_333_333, 333_333_333_333, 333_333_333_334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(123_456_789_01);
  });
  it("employee payouts add up to the pool with mixed decimal scores", () => {
    const r = splitProjectPayment(3_000_000, {
      ...DEFAULT_SETTINGS,
      founders: [{ id: "f", name: "F", weightBp: 10000 }],
      employees: [
        { id: "a", name: "A", score: 26.123457 },
        { id: "b", name: "B", score: 27.000001 },
        { id: "c", name: "C", score: 46.876542 },
      ],
    });
    expect(r.employeePayouts.reduce((a, e) => a + e.paise, 0)).toBe(r.employeePoolPaise);
  });
});
