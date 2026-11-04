import { splitProjectPayment } from "../engine";
import { recipientKind, recipientName, type ExtraPayoutRow, type ProjectDetailRow } from "./data";
import { modeLabel } from "./extras";
import type { Rules } from "./rules";
import type { StatementData } from "../pdf/types";

export interface TeamInput {
  employeeId?: string;
  name: string;
  role: string;
  score: number;
  /** What the score was built from (rating, hours, points), for the PDF. */
  detail?: string;
}

/**
 * Turns project data (or calculator inputs) into the PDF's data.
 * Throws if the split cannot be calculated (e.g. all scores are zero).
 */
export function buildStatementData(opts: {
  kind: StatementData["kind"];
  project?: ProjectDetailRow | null;
  basisLabel: string;
  basisPaise: number;
  rules: Rules;
  fromSnapshot: boolean;
  team: TeamInput[];
  extras: ExtraPayoutRow[]; // extras to show (already filtered to the project, if any)
  preparedBy?: string;
  whatIf?: boolean;
  attachments?: string[];
  scoringNote?: string;
  bonds?: StatementData["bonds"];
}): StatementData {
  const employees = opts.team.map((t, i) => ({ id: t.employeeId ?? `row-${i}`, name: t.name || `Employee ${i + 1}`, score: t.score }));
  const result = splitProjectPayment(opts.basisPaise, { ...opts.rules, employees });

  const p = opts.project ?? null;
  const received = p ? p.payments.reduce((a, x) => a + Number(x.amount_paise), 0) : 0;

  return {
    kind: opts.kind,
    generatedAt: new Date().toISOString(),
    preparedBy: opts.preparedBy,
    revision: p?.revision,
    project: p
      ? { name: p.name, client: p.clients?.name ?? null, pricePaise: Number(p.price_paise), receivedPaise: received }
      : undefined,
    basisLabel: opts.basisLabel,
    whatIf: opts.whatIf,
    rules: {
      companyBp: opts.rules.companyBp,
      reserveBp: opts.rules.reserveBp,
      gst: opts.rules.gst,
      tds: opts.rules.tds,
      fromSnapshot: opts.fromSnapshot,
    },
    result,
    scoringNote: opts.scoringNote,
    bonds: opts.bonds,
    employees: result.employeePayouts.map((e, i) => {
      const mine = opts.extras.filter((x) => x.employee_id === opts.team[i].employeeId);
      const extra = mine.reduce((a, x) => a + Number(x.extra_paise), 0);
      const outstanding = mine.reduce((a, x) => a + Number(x.outstanding_paise), 0);
      return {
        name: e.name,
        role: opts.team[i].role,
        score: e.score,
        detail: opts.team[i].detail,
        shareBp: e.shareBp,
        paise: e.paise,
        extraPaise: extra,
        recoveredPaise: extra - outstanding,
        outstandingPaise: outstanding,
      };
    }),
    extras: opts.extras.map((x) => ({
      employee: recipientKind(x) === "Founder" ? `${recipientName(x)} (founder)` : recipientName(x),
      givenOn: x.given_on,
      basePaise: x.base_paise == null ? null : Number(x.base_paise),
      extraPaise: Number(x.extra_paise),
      extraBp: x.extra_bp,
      plan: modeLabel(x),
      recoveredPaise: Number(x.extra_paise) - Number(x.outstanding_paise),
      outstandingPaise: Number(x.outstanding_paise),
      note: x.note,
    })),
    payments: p
      ? [...p.payments]
          .sort((a, b) => a.received_on.localeCompare(b.received_on))
          .map((x) => ({
            date: x.received_on,
            amountPaise: Number(x.amount_paise),
            gstPaise: Number(x.gst_paise),
            tdsPaise: Number(x.tds_paise),
            note: x.note,
          }))
      : [],
    attachments: opts.attachments ?? [],
  };
}
