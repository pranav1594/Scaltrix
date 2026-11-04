import { splitProjectPayment, type SplitResult, type SplitSettings } from "./split";

export interface PaymentPlan {
  before: SplitResult;
  after: SplitResult;
  /** GST / TDS belonging to THIS payment only. */
  gstDeltaPaise: number;
  tdsDeltaPaise: number;
  /** New money to post into the reserve ledger for THIS payment (never negative). */
  reserveDeltaPaise: number;
}

/**
 * A project can receive several payments (e.g. Rs 5,000 now, more later).
 * The split is always calculated on the TOTAL received so far, so paying in
 * parts gives exactly the same result as paying once. Each new payment only
 * posts its increase to the reserve ledger.
 */
export function planPayment(
  alreadyReceivedPaise: number,
  newPaymentPaise: number,
  settings: SplitSettings,
): PaymentPlan {
  if (!Number.isInteger(newPaymentPaise) || newPaymentPaise <= 0) {
    throw new Error("Payment must be above zero");
  }
  const before = splitProjectPayment(alreadyReceivedPaise, settings);
  const after = splitProjectPayment(alreadyReceivedPaise + newPaymentPaise, settings);
  return {
    before,
    after,
    gstDeltaPaise: after.gstPaise - before.gstPaise,
    tdsDeltaPaise: after.tdsPaise - before.tdsPaise,
    reserveDeltaPaise: after.reservePaise - before.reservePaise,
  };
}
