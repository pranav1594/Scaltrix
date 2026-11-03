import type { ExtraPayoutRow } from "./data";
import { bpToPct, recoverFromShare, recoverySchedule } from "../engine";

export function modeLabel(r: ExtraPayoutRow): string {
  if (r.recovery_mode === "one_time") return "One-time";
  if (r.recovery_mode === "installments") return `${r.installments ?? "?"} installments`;
  return `${bpToPct(r.per_project_bp ?? 0)}% of each future share`;
}

/**
 * The deduction the recovery plan calls for next, in paise.
 *  - one-time: everything still owed
 *  - installments: the next installment in the schedule
 *  - per-project: the agreed % of `sharePaise` (the employee's share on the project being settled)
 * Returns 0 when nothing is owed, or when a per-project plan has no share to take from.
 */
export function pendingDeduction(r: ExtraPayoutRow, sharePaise?: number): number {
  const owed = Number(r.outstanding_paise);
  if (owed <= 0) return 0;
  if (r.recovery_mode === "one_time") return owed;
  if (r.recovery_mode === "installments" && r.installments) {
    const schedule = recoverySchedule(Number(r.extra_paise), { kind: "installments", count: r.installments });
    const next = schedule[r.recoveries.length];
    return Math.min(next ?? owed, owed);
  }
  if (r.recovery_mode === "per_project" && sharePaise !== undefined) {
    return recoverFromShare(sharePaise, owed, r.per_project_bp ?? 0).deductPaise;
  }
  return 0;
}

export function totalsFor(rows: ExtraPayoutRow[]): { given: number; recovered: number; outstanding: number } {
  const given = rows.reduce((a, r) => a + Number(r.extra_paise), 0);
  const outstanding = rows.reduce((a, r) => a + Number(r.outstanding_paise), 0);
  return { given, recovered: given - outstanding, outstanding };
}
