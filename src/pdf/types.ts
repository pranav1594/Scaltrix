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
  /** Which contribution scoring method was used, in one sentence. */
  scoringNote?: string;

  employees: {
    name: string;
    role: string;
    score: number;
    detail?: string;
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

  /** Client bond(s) on the project, shown as a short block in the statement. */
  bonds?: {
    title: string;
    status: string;
    signedOn: string | null;
    deadline: string | null;
    coveredPaise: number;
    required: number;
    verified: number;
    compensation: string;
    outcomeText: string;
    clients: string[];
  }[];

  payments: { date: string; amountPaise: number; gstPaise: number; tdsPaise: number; note?: string | null }[];
  attachments: string[];
}
