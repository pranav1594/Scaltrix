import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { bondOutcome, type BondOutcome, type Compensation } from "../engine";

export interface ReferralRow {
  id: string;
  bond_id: string;
  referred_name: string;
  contact: string | null;
  verified: boolean;
  verified_on: string | null;
  note: string | null;
}

export interface ClientBondRow {
  id: string;
  project_id: string | null;
  client_id: string | null;
  party_name: string;
  title: string;
  terms: string | null;
  total_price_paise: number | null;
  paid_paise: number | null;
  outstanding_paise: number | null;
  required_referrals: number | null;
  compensation_kind: "percent" | "fixed" | "per_missed" | null;
  compensation_value: number | null;
  signed_on: string | null;
  deadline: string | null;
  status: "active" | "fulfilled" | "partial" | "failed" | "cancelled";
  document_id: string | null;
  created_at: string;
  referrals: ReferralRow[];
}

const COLS =
  "id,project_id,client_id,party_name,title,terms,total_price_paise,paid_paise,outstanding_paise,required_referrals," +
  "compensation_kind,compensation_value,signed_on,deadline,status,document_id,created_at,referrals(id,bond_id,referred_name,contact,verified,verified_on,note)";

const num = (x: unknown) => (x == null ? null : Number(x));
function clean(r: ClientBondRow): ClientBondRow {
  return {
    ...r,
    total_price_paise: num(r.total_price_paise),
    paid_paise: num(r.paid_paise),
    outstanding_paise: num(r.outstanding_paise),
    compensation_value: num(r.compensation_value),
    referrals: r.referrals ?? [],
  };
}

export function useProjectBonds(projectId: string | undefined) {
  return useQuery({
    queryKey: ["client-bonds", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ClientBondRow[]> => {
      const { data, error } = await supabase
        .from("bonds")
        .select(COLS)
        .eq("party_type", "client")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as ClientBondRow[]).map(clean);
    },
  });
}

/** Every client bond, for the dashboard. */
export function useAllClientBonds() {
  return useQuery({
    queryKey: ["client-bonds", "all"],
    queryFn: async (): Promise<(ClientBondRow & { projects: { name: string } | null })[]> => {
      const { data, error } = await supabase
        .from("bonds")
        .select(COLS + ",projects(name)")
        .eq("party_type", "client")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as (ClientBondRow & { projects: { name: string } | null })[]).map((r) => ({ ...clean(r), projects: r.projects }));
    },
  });
}

export function compensationOf(b: Pick<ClientBondRow, "compensation_kind" | "compensation_value">): Compensation {
  const v = b.compensation_value ?? 0;
  if (b.compensation_kind === "percent") return { kind: "percent", bp: v };
  if (b.compensation_kind === "per_missed") return { kind: "per_missed", paisePerMissed: v };
  return { kind: "fixed", paise: v };
}

export function compensationText(kind: ClientBondRow["compensation_kind"], value: number | null, fmt: (p: number) => string): string {
  if (!kind) return "none";
  const v = value ?? 0;
  if (kind === "percent") return `${v / 100}% of the unpaid amount`;
  if (kind === "per_missed") return `${fmt(v)} per missed client`;
  return `${fmt(v)} flat`;
}

export const verifiedCount = (b: ClientBondRow) => b.referrals.filter((r) => r.verified).length;

export interface BondStanding {
  /** What the bond would settle at if it closed now. */
  outcome: BondOutcome;
  /** Cash that came in after the bond was signed. */
  cashSinceSigningPaise: number;
  /** What the client still has to pay now (if the bond has failed/partly failed). */
  payableNowPaise: number;
}

/**
 * Outcome of a bond given the verified referrals so far, and how much of any
 * amount due has already been paid in cash since signing.
 */
export function bondStanding(b: ClientBondRow, receivedNowPaise: number): BondStanding {
  const outcome = bondOutcome({
    outstandingPaise: b.outstanding_paise ?? 0,
    requiredReferrals: b.required_referrals ?? 1,
    deliveredReferrals: verifiedCount(b),
    compensation: compensationOf(b),
  });
  const cashSince = Math.max(0, receivedNowPaise - (b.paid_paise ?? 0));
  return { outcome, cashSinceSigningPaise: cashSince, payableNowPaise: Math.max(0, outcome.totalPayablePaise - cashSince) };
}

export const BOND_STATUS_LABEL: Record<ClientBondRow["status"], string> = {
  active: "Active",
  fulfilled: "Fulfilled, balance waived",
  partial: "Partly delivered",
  failed: "Not delivered",
  cancelled: "Cancelled",
};

/** Short, printable summary of each non-cancelled bond for the settlement PDF. */
export function bondsForStatement(bonds: ClientBondRow[], receivedPaise: number, fmt: (p: number) => string) {
  return bonds
    .filter((b) => b.status !== "cancelled")
    .map((b) => {
      const st = bondStanding(b, receivedPaise);
      const o = st.outcome;
      const outcomeText =
        o.status === "fulfilled"
          ? `All clients delivered, ${fmt(b.outstanding_paise ?? 0)} waived.`
          : `${b.status === "active" ? "If closed today: " : ""}${fmt(o.creditedPaise)} waived; the client owes ${fmt(o.totalPayablePaise)} (${fmt(o.remainingDuePaise)} + compensation ${fmt(o.compensationPaise)}), of which ${fmt(st.payableNowPaise)} is still to collect.`;
      return {
        title: b.title,
        status: BOND_STATUS_LABEL[b.status],
        signedOn: b.signed_on,
        deadline: b.deadline,
        coveredPaise: b.outstanding_paise ?? 0,
        required: b.required_referrals ?? 1,
        verified: verifiedCount(b),
        compensation: compensationText(b.compensation_kind, b.compensation_value, fmt),
        outcomeText,
        clients: b.referrals.map((r) => r.referred_name),
      };
    });
}
