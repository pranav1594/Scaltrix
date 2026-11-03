import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, rupeesToPaise as R } from "../src/engine";
import { modeLabel, pendingDeduction, totalsFor } from "../src/lib/extras";
import { buildStatementData } from "../src/lib/statement";
import type { ExtraPayoutRow } from "../src/lib/data";

function extra(over: Partial<ExtraPayoutRow> = {}): ExtraPayoutRow {
  return {
    id: "x1",
    base_paise: R(20000),
    extra_paise: R(3000),
    extra_bp: 1500,
    recovery_mode: "installments",
    installments: 3,
    per_project_bp: null,
    outstanding_paise: R(3000),
    given_on: "2026-11-02",
    note: null,
    project_id: "p1",
    employee_id: "e0",
    founder_id: null,
    employees: { name: "Anil" },
    founders: null,
    projects: { name: "Demo" },
    recoveries: [],
    ...over,
  };
}

describe("pendingDeduction (extra payout recovery suggestions)", () => {
  it("one-time: the whole amount owed", () => {
    expect(pendingDeduction(extra({ recovery_mode: "one_time" }))).toBe(R(3000));
  });
  it("installments: 1000 each time, then stops", () => {
    expect(pendingDeduction(extra())).toBe(R(1000));
    const afterOne = extra({ outstanding_paise: R(2000), recoveries: [{ id: "r1", amount_paise: R(1000), recovered_on: "2026-12-01", note: null }] });
    expect(pendingDeduction(afterOne)).toBe(R(1000));
    const done = extra({ outstanding_paise: 0 });
    expect(pendingDeduction(done)).toBe(0);
  });
  it("installments: never asks for more than is owed", () => {
    const r = extra({ outstanding_paise: R(400), recoveries: [{ id: "a", amount_paise: 1, recovered_on: "", note: null }, { id: "b", amount_paise: 1, recovered_on: "", note: null }] });
    expect(pendingDeduction(r)).toBe(R(400));
  });
  it("per-project: takes the agreed % of this project's share, capped at what is owed", () => {
    const r = extra({ recovery_mode: "per_project", per_project_bp: 1000, installments: null });
    expect(pendingDeduction(r, R(20000))).toBe(R(2000));
    expect(pendingDeduction({ ...r, outstanding_paise: R(500) }, R(20000))).toBe(R(500));
    expect(pendingDeduction(r)).toBe(0); // no share given: nothing to take from
  });
  it("labels and totals", () => {
    expect(modeLabel(extra())).toBe("3 installments");
    expect(modeLabel(extra({ recovery_mode: "per_project", per_project_bp: 1000 }))).toBe("10% of each future share");
    const t = totalsFor([extra(), extra({ id: "x2", outstanding_paise: R(1000) })]);
    expect(t).toEqual({ given: R(6000), recovered: R(2000), outstanding: R(4000) });
  });
});

describe("buildStatementData (PDF data)", () => {
  const rules = {
    ...DEFAULT_SETTINGS,
    founders: [
      { id: "f1", name: "F1", weightBp: 5000 },
      { id: "f2", name: "F2", weightBp: 3000 },
      { id: "f3", name: "F3", weightBp: 2000 },
    ],
  };
  const team = [
    { employeeId: "e0", name: "Anil", role: "Dev", score: 40 },
    { employeeId: "e1", name: "Sneha", role: "Design", score: 35 },
    { employeeId: "e2", name: "Ravi", role: "QA", score: 25 },
  ];

  it("matches the documented example and attaches extras to the right person", () => {
    const d = buildStatementData({
      kind: "calculation",
      basisLabel: "Amount entered",
      basisPaise: R(100000),
      rules,
      fromSnapshot: false,
      team,
      extras: [extra({ outstanding_paise: R(2000) })],
    });
    expect(d.result.reservePaise).toBe(R(40000));
    expect(d.employees.map((e) => e.paise)).toEqual([R(20000), R(17500), R(12500)]);
    expect(d.employees[0]).toMatchObject({ extraPaise: R(3000), recoveredPaise: R(1000), outstandingPaise: R(2000) });
    expect(d.employees[1].extraPaise).toBe(0);
    expect(d.extras[0]).toMatchObject({ employee: "Anil", plan: "3 installments", outstandingPaise: R(2000) });
  });

  it("refuses to calculate when every score is zero", () => {
    expect(() =>
      buildStatementData({
        kind: "calculation",
        basisLabel: "x",
        basisPaise: R(1000),
        rules,
        fromSnapshot: false,
        team: team.map((t) => ({ ...t, score: 0 })),
        extras: [],
      }),
    ).toThrow(/scores/i);
  });
});

describe("extra payouts for founders (shareholders)", () => {
  const founderExtra = (over: Partial<ExtraPayoutRow> = {}) =>
    extra({
      id: "fx1",
      employee_id: null,
      founder_id: "f2",
      employees: null,
      founders: { name: "Meera" },
      base_paise: null,
      extra_bp: null,
      extra_paise: R(5000),
      outstanding_paise: R(5000),
      recovery_mode: "one_time",
      installments: null,
      ...over,
    });

  it("is told apart from an employee extra", async () => {
    const { recipientKind, recipientName, recipientKey } = await import("../src/lib/data");
    expect(recipientKind(founderExtra())).toBe("Founder");
    expect(recipientName(founderExtra())).toBe("Meera");
    expect(recipientKey(founderExtra())).toBe("f2");
    expect(recipientKind(extra())).toBe("Employee");
  });

  it("recovers the same way: one-time and installments", () => {
    expect(pendingDeduction(founderExtra())).toBe(R(5000));
    const inst = founderExtra({ recovery_mode: "installments", installments: 2 });
    expect(pendingDeduction(inst)).toBe(R(2500));
  });

  it("appears in the PDF data labelled as a founder, with no base share or percentage", () => {
    const rules = {
      ...DEFAULT_SETTINGS,
      founders: [
        { id: "f1", name: "F1", weightBp: 5000 },
        { id: "f2", name: "Meera", weightBp: 5000 },
      ],
    };
    const d = buildStatementData({
      kind: "settlement",
      basisLabel: "Total received so far",
      basisPaise: R(100000),
      rules,
      fromSnapshot: true,
      team: [{ employeeId: "e0", name: "Anil", role: "Dev", score: 10 }],
      extras: [extra(), founderExtra()],
    });
    const row = d.extras.find((x) => x.employee.includes("Meera"))!;
    expect(row.employee).toBe("Meera (founder)");
    expect(row.basePaise).toBeNull();
    expect(row.extraBp).toBeNull();
    // A founder's extra is not attributed to any employee row in the salary table.
    expect(d.employees[0].extraPaise).toBe(R(3000));
  });

  it("totals include both kinds", () => {
    expect(totalsFor([extra(), founderExtra()])).toEqual({ given: R(8000), recovered: 0, outstanding: R(8000) });
  });
});
