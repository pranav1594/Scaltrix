import { BP_TOTAL } from "./money";

export type Compensation =
  | { kind: "percent"; bp: number } // % of the remaining due
  | { kind: "fixed"; paise: number } // flat amount if any referral is missed
  | { kind: "per_missed"; paisePerMissed: number }; // amount per missed referral

export interface BondInput {
  outstandingPaise: number; // price minus what the client has paid
  requiredReferrals: number;
  deliveredReferrals: number; // verified referrals only
  compensation: Compensation;
}

export interface BondOutcome {
  status: "fulfilled" | "partial" | "failed";
  creditPerReferralPaise: number;
  creditedPaise: number;
  remainingDuePaise: number;
  compensationPaise: number;
  totalPayablePaise: number;
}

/** Step 8: what the client owes once the bond deadline has passed. */
export function bondOutcome(b: BondInput): BondOutcome {
  if (b.requiredReferrals < 1) throw new Error("Required referrals must be at least 1");
  if (b.deliveredReferrals < 0) throw new Error("Delivered referrals cannot be negative");

  const delivered = Math.min(b.deliveredReferrals, b.requiredReferrals);
  const missed = b.requiredReferrals - delivered;
  const creditPerReferralPaise = Math.round(b.outstandingPaise / b.requiredReferrals);

  if (missed === 0) {
    return {
      status: "fulfilled",
      creditPerReferralPaise,
      creditedPaise: b.outstandingPaise,
      remainingDuePaise: 0,
      compensationPaise: 0,
      totalPayablePaise: 0,
    };
  }

  // Exact credit so nothing is lost to rounding when several referrals are delivered.
  const creditedPaise = Math.round((b.outstandingPaise * delivered) / b.requiredReferrals);
  const remainingDuePaise = b.outstandingPaise - creditedPaise;

  let compensationPaise = 0;
  switch (b.compensation.kind) {
    case "percent":
      compensationPaise = Math.round((remainingDuePaise * b.compensation.bp) / BP_TOTAL);
      break;
    case "fixed":
      compensationPaise = b.compensation.paise;
      break;
    case "per_missed":
      compensationPaise = b.compensation.paisePerMissed * missed;
      break;
  }

  return {
    status: delivered === 0 ? "failed" : "partial",
    creditPerReferralPaise,
    creditedPaise,
    remainingDuePaise,
    compensationPaise,
    totalPayablePaise: remainingDuePaise + compensationPaise,
  };
}
