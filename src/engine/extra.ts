import { BP_TOTAL, allocate } from "./money";

/** Step 7: how much extra an employee was given, as % of their base share. */
export function extraPercent(extraPaise: number, basePaise: number): { bp: number; label: string } {
  if (basePaise <= 0) throw new Error("Base share must be above zero");
  const bp = Math.round((extraPaise * BP_TOTAL) / basePaise);
  return { bp, label: `${(bp / 100).toFixed(2)}%` };
}

export type RecoveryMode =
  | { kind: "one_time" }
  | { kind: "installments"; count: number }
  | { kind: "per_project"; bp: number }; // deduct bp% of each future project share

/** Schedule for the "one-time" and "installments" options. */
export function recoverySchedule(outstandingPaise: number, mode: RecoveryMode): number[] {
  if (mode.kind === "one_time") return [outstandingPaise];
  if (mode.kind === "installments") {
    if (!Number.isInteger(mode.count) || mode.count < 1) throw new Error("Need at least 1 installment");
    return allocate(outstandingPaise, Array(mode.count).fill(1));
  }
  throw new Error("per_project recovery has no fixed schedule; use recoverFromShare");
}

/**
 * Per-project recovery: deduct bp% of a new share, never more than is owed.
 * Returns what to deduct, what the employee actually receives, and what is left.
 */
export function recoverFromShare(
  sharePaise: number,
  outstandingPaise: number,
  bp: number,
): { deductPaise: number; netSharePaise: number; remainingPaise: number } {
  const wanted = Math.round((sharePaise * bp) / BP_TOTAL);
  const deductPaise = Math.min(wanted, outstandingPaise, sharePaise);
  return {
    deductPaise,
    netSharePaise: sharePaise - deductPaise,
    remainingPaise: outstandingPaise - deductPaise,
  };
}
