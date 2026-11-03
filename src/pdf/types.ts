import type { SplitResult } from "../engine";

/** Everything the PDF needs. Built from saved project data or from the calculator. */
export interface StatementData {
  kind: "settlement" | "calculation";
  /** Logo image source (URL in the app, file path in tests). Set by buildStatementPdf. */
  logoSrc?: string;
  generatedAt: string; // ISO timestamp
  preparedBy?: string;
  revision?: number;

  project?: {
    name: string;
    client?: string | null;
    pricePaise: number;
    receivedPaise: number;
  };

  /** What the split was calculated on, e.g. "Total received so far". */
  basisLabel: string;
  /** True when the numbers come from the calculator with edited, unsaved values. */
  whatIf?: boolean;

  rules: {
    companyBp: number;
    reserveBp: number;
    gst: { enabled: boolean; rateBp: number };
    tds: { enabled: boolean; rateBp: number };
    fromSnapshot: boolean;
  };

  result: SplitResult;

  employees: {
    name: string;
    role: string;
    score: number;
    shareBp: number;
    paise: number;
    extraPaise: number;
    recoveredPaise: number;
    outstandingPaise: number;
  }[];

  extras: {
    employee: string;
    givenOn: string;
    basePaise: number | null;
    extraPaise: number;
    extraBp: number | null;
    plan: string;
    recoveredPaise: number;
    outstandingPaise: number;
    note?: string | null;
  }[];

  payments: { date: string; amountPaise: number; gstPaise: number; tdsPaise: number; note?: string | null }[];
  attachments: string[];
}
