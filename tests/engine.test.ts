import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  allocate,
  bondOutcome,
  equalizingAdvance,
  extraPercent,
  formatINR,
  recoverFromShare,
  recoverySchedule,
  rupeesToPaise,
  splitProjectPayment,
  loanAdvance,
  planPayment,
} from "../src/engine";

const founders = [
  { id: "f1", name: "Founder 1", weightBp: 5000 },
  { id: "f2", name: "Founder 2", weightBp: 3000 },
  { id: "f3", name: "Founder 3", weightBp: 2000 },
];
const employees = [
  { id: "a", name: "A", score: 40 },
  { id: "b", name: "B", score: 35 },
  { id: "c", name: "C", score: 25 },
];
const settings = { ...DEFAULT_SETTINGS, founders, employees };
const R = rupeesToPaise;

describe("money helpers", () => {
  it("formats Indian grouping", () => {
    expect(formatINR(R(100000))).toBe("₹1,00,000.00");
    expect(formatINR(R(1234567.5))).toBe("₹12,34,567.50");
    expect(formatINR(R(999))).toBe("₹999.00");
  });
  it("allocate always sums exactly to the total", () => {
    const parts = allocate(10001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10001);
    expect(parts).toEqual([3334, 3334, 3333]);
  });
  it("allocate gives leftover paise to the largest remainder", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});

describe("project split (docs Steps 1-4)", () => {
  const r = splitProjectPayment(R(100000), settings);
  it("splits 50/50 then 80/20", () => {
    expect(r.companySharePaise).toBe(R(50000));
    expect(r.employeePoolPaise).toBe(R(50000));
    expect(r.reservePaise).toBe(R(40000));
    expect(r.foundersPoolPaise).toBe(R(10000));
  });
  it("pays founders 5000 / 3000 / 2000", () => {
    expect(r.founderPayouts.map((f) => f.paise)).toEqual([R(5000), R(3000), R(2000)]);
  });
  it("pays employees 20000 / 17500 / 12500", () => {
    expect(r.employeePayouts.map((e) => e.paise)).toEqual([R(20000), R(17500), R(12500)]);
  });
  it("the person who contributed most gets the most", () => {
    const p = r.employeePayouts.map((e) => e.paise);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[2]);
  });
  it("every rupee is accounted for, even with awkward numbers", () => {
    const odd = splitProjectPayment(R(33333.33), settings);
    const out =
      odd.reservePaise +
      odd.founderPayouts.reduce((a, f) => a + f.paise, 0) +
      odd.employeePayouts.reduce((a, e) => a + e.paise, 0);
    expect(out).toBe(odd.netPaise);
  });
  it("respects edited percentages", () => {
    const x = splitProjectPayment(R(100000), { ...settings, companyBp: 4000, reserveBp: 7000 });
    expect(x.companySharePaise).toBe(R(40000));
    expect(x.reservePaise).toBe(R(28000));
    expect(x.foundersPoolPaise).toBe(R(12000));
  });
  it("rejects founder weights that do not total 100%", () => {
    const bad = [{ id: "f1", name: "x", weightBp: 5000 }];
    expect(() => splitProjectPayment(R(1000), { ...settings, founders: bad })).toThrow();
  });
  it("deducts GST and TDS only when switched on", () => {
    const t = splitProjectPayment(R(118000), {
      ...settings,
      gst: { enabled: true, rateBp: 1800 },
      tds: { enabled: true, rateBp: 1000 },
    });
    expect(t.gstPaise).toBe(R(18000));
    expect(t.tdsPaise).toBe(R(10000));
    expect(t.netPaise).toBe(R(90000));
  });
});

describe("founder advance (docs Step 6)", () => {
  it("Founder 1 takes 5000 -> total 10000 (5000/3000/2000)", () => {
    const a = equalizingAdvance("f1", R(5000), founders, R(40000));
    expect(a.totalWithdrawalPaise).toBe(R(10000));
    expect(a.perFounder.map((f) => f.paise)).toEqual([R(5000), R(3000), R(2000)]);
  });
  it("lowest-ranked founder takes 5000 -> total 25000 (12500/7500/5000)", () => {
    const a = equalizingAdvance("f3", R(5000), founders);
    expect(a.totalWithdrawalPaise).toBe(R(25000));
    expect(a.perFounder.map((f) => f.paise)).toEqual([R(12500), R(7500), R(5000)]);
  });
  it("blocks a withdrawal bigger than the reserve", () => {
    expect(() => equalizingAdvance("f3", R(5000), founders, R(20000))).toThrow(/too low/);
  });
  it("loan model records a debt for the taker only", () => {
    expect(loanAdvance("f2", R(3000), R(40000)).outstandingPaise).toBe(R(3000));
  });
});

describe("employee extra payout (docs Step 7)", () => {
  it("3000 extra on a 20000 share is 15%", () => {
    expect(extraPercent(R(3000), R(20000)).label).toBe("15.00%");
  });
  it("3 installments of 1000", () => {
    expect(recoverySchedule(R(3000), { kind: "installments", count: 3 })).toEqual([R(1000), R(1000), R(1000)]);
  });
  it("installments never lose a paisa", () => {
    const s = recoverySchedule(10001, { kind: "installments", count: 3 });
    expect(s.reduce((a, b) => a + b, 0)).toBe(10001);
  });
  it("per-project recovery takes 10% and stops when cleared", () => {
    expect(recoverFromShare(R(20000), R(3000), 1000).deductPaise).toBe(R(2000));
    expect(recoverFromShare(R(20000), R(500), 1000).deductPaise).toBe(R(500));
    expect(recoverFromShare(R(20000), R(500), 1000).remainingPaise).toBe(0);
  });
});

describe("client bond (docs Step 8)", () => {
  const base = { outstandingPaise: R(25000), requiredReferrals: 3 };
  it("all 3 delivered -> fulfilled, nothing due", () => {
    const o = bondOutcome({ ...base, deliveredReferrals: 3, compensation: { kind: "percent", bp: 1000 } });
    expect(o.status).toBe("fulfilled");
    expect(o.totalPayablePaise).toBe(0);
  });
  it("1 delivered, 10% compensation -> 18333.33", () => {
    const o = bondOutcome({ ...base, deliveredReferrals: 1, compensation: { kind: "percent", bp: 1000 } });
    expect(o.creditPerReferralPaise).toBe(833333);
    expect(o.remainingDuePaise).toBe(1666667);
    expect(o.compensationPaise).toBe(166667);
    expect(o.totalPayablePaise).toBe(1833334); // 16,666.67 + 1,666.67 = 18,333.34 (paise rounding)
  });
  it("none delivered -> 25000 + compensation", () => {
    const o = bondOutcome({ ...base, deliveredReferrals: 0, compensation: { kind: "percent", bp: 1000 } });
    expect(o.status).toBe("failed");
    expect(o.totalPayablePaise).toBe(R(27500));
  });
  it("fixed and per-missed compensation", () => {
    const f = bondOutcome({ ...base, deliveredReferrals: 2, compensation: { kind: "fixed", paise: R(2000) } });
    expect(f.compensationPaise).toBe(R(2000));
    const p = bondOutcome({ ...base, deliveredReferrals: 1, compensation: { kind: "per_missed", paisePerMissed: R(1000) } });
    expect(p.compensationPaise).toBe(R(2000));
  });
});

describe("payments in parts (planPayment)", () => {
  it("5000 now + 25000 later equals one 30000 payment", () => {
    const first = planPayment(0, R(5000), settings);
    const second = planPayment(R(5000), R(25000), settings);
    const whole = splitProjectPayment(R(30000), settings);
    expect(second.after).toEqual(whole);
    expect(first.reserveDeltaPaise + second.reserveDeltaPaise).toBe(whole.reservePaise);
  });
  it("reserve increase is never negative, even with awkward amounts", () => {
    let received = 0;
    let postedToReserve = 0;
    for (const amt of [R(333.33), R(1234.57), R(0.01), R(9999.99), R(5000.5)]) {
      const p = planPayment(received, amt, settings);
      expect(p.reserveDeltaPaise).toBeGreaterThanOrEqual(0);
      postedToReserve += p.reserveDeltaPaise;
      received += amt;
    }
    expect(postedToReserve).toBe(splitProjectPayment(received, settings).reservePaise);
  });
  it("splits tax per payment and the parts add up", () => {
    const taxed = { ...settings, gst: { enabled: true, rateBp: 1800 }, tds: { enabled: true, rateBp: 1000 } };
    const a = planPayment(0, R(59000), taxed);
    const b = planPayment(R(59000), R(59000), taxed);
    expect(a.gstDeltaPaise + b.gstDeltaPaise).toBe(splitProjectPayment(R(118000), taxed).gstPaise);
  });
});
