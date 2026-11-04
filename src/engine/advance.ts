import { BP_TOTAL, assertBpTotal } from "./money";
import type { FounderWeight } from "./split";

export interface AdvanceResult {
  takerId: string;
  totalWithdrawalPaise: number;
  perFounder: { id: string; name: string; weightBp: number; paise: number }[];
}

/**
 * Equalizing model (Step 6). When one founder takes `amountPaise` from the
 * reserve, every other founder is entitled to a matching amount in proportion
 * to rank weight, so nobody is treated unequally.
 *
 *   total withdrawal = amount taken / taker's weight
 *   each founder     = total withdrawal x that founder's weight
 *
 * The taker always receives exactly what they asked for.
 */
export function equalizingAdvance(
  takerId: string,
  amountPaise: number,
  founders: FounderWeight[],
  reserveBalancePaise?: number,
): AdvanceResult {
  assertBpTotal(
    founders.map((f) => f.weightBp),
    "Founder weights",
  );
  const taker = founders.find((f) => f.id === takerId);
  if (!taker) throw new Error("Founder not found");
  if (taker.weightBp <= 0) throw new Error("Taker has a zero weight");
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Advance must be a positive whole number of paise");
  }

  const totalWithdrawalPaise = Math.round((amountPaise * BP_TOTAL) / taker.weightBp);
  const perFounder = founders.map((f) => ({
    id: f.id,
    name: f.name,
    weightBp: f.weightBp,
    paise:
      f.id === takerId ? amountPaise : Math.round((totalWithdrawalPaise * f.weightBp) / BP_TOTAL),
  }));
  const actualTotal = perFounder.reduce((a, f) => a + f.paise, 0);

  if (reserveBalancePaise !== undefined && actualTotal > reserveBalancePaise) {
    throw new Error("Reserve balance is too low for this withdrawal");
  }
  return { takerId, totalWithdrawalPaise: actualTotal, perFounder };
}

/**
 * Loan model (alternative setting). Only the taker receives money; it is
 * recorded as a debt to be deducted from that founder's future 20% payouts.
 */
export function loanAdvance(
  takerId: string,
  amountPaise: number,
  reserveBalancePaise?: number,
): { takerId: string; paise: number; outstandingPaise: number } {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Advance must be a positive whole number of paise");
  }
  if (reserveBalancePaise !== undefined && amountPaise > reserveBalancePaise) {
    throw new Error("Reserve balance is too low for this withdrawal");
  }
  return { takerId, paise: amountPaise, outstandingPaise: amountPaise };
}
