import { BP_TOTAL, allocate, assertBpTotal, percentOf } from "./money";

export interface FounderWeight {
  id: string;
  name: string;
  weightBp: number; // all founders together must be 10000
}

export interface EmployeeScore {
  id: string;
  name: string;
  score: number; // hours, task points, rating... any non-negative number
}

export interface SplitSettings {
  /** Share of net payment kept by the company (default 5000 = 50%). */
  companyBp: number;
  /** Share of the company share that goes to reserve (default 8000 = 80%). */
  reserveBp: number;
  founders: FounderWeight[];
  employees: EmployeeScore[];
  gst: { enabled: boolean; rateBp: number }; // gross is treated as GST-inclusive
  tds: { enabled: boolean; rateBp: number }; // deducted by the client on the pre-GST amount
}

export interface SplitResult {
  grossPaise: number;
  gstPaise: number;
  tdsPaise: number;
  netPaise: number;
  companySharePaise: number;
  employeePoolPaise: number;
  reservePaise: number;
  foundersPoolPaise: number;
  founderPayouts: { id: string; name: string; weightBp: number; paise: number }[];
  employeePayouts: { id: string; name: string; score: number; shareBp: number; paise: number }[];
}

export const DEFAULT_SETTINGS = {
  companyBp: 5000,
  reserveBp: 8000,
  gst: { enabled: false, rateBp: 1800 },
  tds: { enabled: false, rateBp: 1000 },
};

/** Step 0 to Step 4 of the calculation documentation. */
export function splitProjectPayment(grossPaise: number, s: SplitSettings): SplitResult {
  if (!Number.isInteger(grossPaise) || grossPaise < 0) {
    throw new Error("Payment must be a non-negative whole number of paise");
  }
  if (s.companyBp < 0 || s.companyBp > BP_TOTAL) throw new Error("Company share must be 0-100%");
  if (s.reserveBp < 0 || s.reserveBp > BP_TOTAL) throw new Error("Reserve share must be 0-100%");
  assertBpTotal(
    s.founders.map((f) => f.weightBp),
    "Founder weights",
  );

  // Step 0: taxes (optional)
  const gstPaise = s.gst.enabled
    ? Math.round((grossPaise * s.gst.rateBp) / (BP_TOTAL + s.gst.rateBp))
    : 0;
  const tdsPaise = s.tds.enabled ? percentOf(grossPaise - gstPaise, s.tds.rateBp) : 0;
  const netPaise = grossPaise - gstPaise - tdsPaise;

  // Step 1: company / employee pool
  const companySharePaise = percentOf(netPaise, s.companyBp);
  const employeePoolPaise = netPaise - companySharePaise;

  // Step 2: reserve / founders pool
  const reservePaise = percentOf(companySharePaise, s.reserveBp);
  const foundersPoolPaise = companySharePaise - reservePaise;

  // Step 3: founders pool by rank weight
  const founderAmounts = allocate(
    foundersPoolPaise,
    s.founders.map((f) => f.weightBp),
  );
  const founderPayouts = s.founders.map((f, i) => ({
    id: f.id,
    name: f.name,
    weightBp: f.weightBp,
    paise: founderAmounts[i],
  }));

  // Step 4: employee pool by contribution score
  const totalScore = s.employees.reduce((a, e) => a + e.score, 0);
  let employeePayouts: SplitResult["employeePayouts"] = [];
  if (s.employees.length > 0) {
    if (totalScore <= 0) throw new Error("Employee scores must add up to more than zero");
    // Scores can be decimals (e.g. 7.5 hours); scale to integers for exact maths.
    const weights = s.employees.map((e) => Math.round(e.score * 1000));
    const amounts = allocate(employeePoolPaise, weights);
    const wsum = weights.reduce((a, b) => a + b, 0);
    employeePayouts = s.employees.map((e, i) => ({
      id: e.id,
      name: e.name,
      score: e.score,
      shareBp: Math.round((weights[i] * BP_TOTAL) / wsum),
      paise: amounts[i],
    }));
  }

  return {
    grossPaise,
    gstPaise,
    tdsPaise,
    netPaise,
    companySharePaise,
    employeePoolPaise,
    reservePaise,
    foundersPoolPaise,
    founderPayouts,
    employeePayouts,
  };
}
