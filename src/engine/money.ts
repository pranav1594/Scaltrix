/**
 * Money helpers.
 *
 * Every amount in the engine is an INTEGER number of paise (1 rupee = 100 paise).
 * Every percentage is an INTEGER number of basis points (100% = 10000 bp, 1% = 100 bp).
 * This avoids floating-point errors such as 0.1 + 0.2 = 0.30000000000000004.
 */

export const BP_TOTAL = 10000;

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => paise / 100;
export const pctToBp = (pct: number): number => Math.round(pct * 100);
export const bpToPct = (bp: number): number => bp / 100;

/** Format paise as Indian-grouped rupees, e.g. 10000000 -> "₹1,00,000.00". */
export function formatINR(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const s = String(rupees);
  let grouped: string;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  }
  return `${negative ? "-" : ""}₹${grouped}.${String(rem).padStart(2, "0")}`;
}

/** Percentage of an amount, rounded to the nearest paisa. */
export function percentOf(amountPaise: number, bp: number): number {
  return Math.round((amountPaise * bp) / BP_TOTAL);
}

/**
 * Split `total` paise in proportion to `weights` using the largest-remainder
 * method. The parts ALWAYS add up to exactly `total`: leftover paise go to the
 * entries with the biggest fractional remainder (ties go to the bigger weight).
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total)) throw new Error("allocate: total must be integer paise");
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new Error("allocate: weights must be non-negative integers");
  }
  // BigInt keeps total * weight exact even with large weights (no 2^53 overflow).
  const W = weights.map((w) => BigInt(w));
  const sum = W.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("allocate: weights must not all be zero");
  const T = BigInt(total);

  const base = W.map((w) => (T * w) / sum);
  const rem = W.map((w, i) => ({ i, r: (T * w) % sum, w }));
  let left = Number(T - base.reduce((a, b) => a + b, 0n));

  rem.sort((a, b) => (a.r === b.r ? (a.w === b.w ? a.i - b.i : a.w > b.w ? -1 : 1) : a.r > b.r ? -1 : 1));
  const out = base.map((b) => Number(b));
  for (let k = 0; k < rem.length && left > 0; k++, left--) out[rem[k].i] += 1;
  return out;
}

export function assertBpTotal(bps: number[], label: string): void {
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum !== BP_TOTAL) {
    throw new Error(`${label} must total 100% (got ${bpToPct(sum)}%)`);
  }
}
