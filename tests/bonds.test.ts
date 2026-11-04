import { describe, it, expect } from "vitest";
import { bondStanding, bondsForStatement, type ClientBondRow } from "../src/lib/bonds";
import { formatINR } from "../src/engine";

// The user's real case: price 30,000, paid 5,000, 25,000 covered by a bond for 3 clients, fixed Rs 50,000 compensation.
const bond = (verified: number, status: ClientBondRow["status"] = "active"): ClientBondRow => ({
  id: "b", project_id: "p", client_id: "c", party_name: "Client", title: "Referral bond", terms: null,
  total_price_paise: 3_000_000, paid_paise: 500_000, outstanding_paise: 2_500_000, required_referrals: 3,
  compensation_kind: "fixed", compensation_value: 5_000_000, signed_on: "2026-11-01", deadline: "2027-02-01",
  status, document_id: null, created_at: "", 
  referrals: Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, bond_id: "b", referred_name: `C${i}`, contact: null, verified: i < verified, verified_on: null, note: null })),
});

describe("client bond standing", () => {
  it("3 of 3 brought: 25,000 waived, nothing owed", () => {
    const s = bondStanding(bond(3), 500_000);
    expect(s.outcome.status).toBe("fulfilled");
    expect(s.outcome.totalPayablePaise).toBe(0);
    expect(s.payableNowPaise).toBe(0);
  });
  it("0 of 3: owes 25,000 + 50,000 fixed compensation", () => {
    const s = bondStanding(bond(0), 500_000);
    expect(s.outcome.status).toBe("failed");
    expect(s.outcome.totalPayablePaise).toBe(7_500_000);
    expect(s.payableNowPaise).toBe(7_500_000);
  });
  it("1 of 3: credits one third, rest plus compensation", () => {
    const s = bondStanding(bond(1), 500_000);
    expect(s.outcome.creditedPaise).toBe(833_333);
    expect(s.outcome.remainingDuePaise).toBe(1_666_667);
    expect(s.outcome.totalPayablePaise).toBe(6_666_667);
  });
  it("cash received after signing reduces what is still payable", () => {
    const s = bondStanding(bond(0), 500_000 + 1_000_000);
    expect(s.cashSinceSigningPaise).toBe(1_000_000);
    expect(s.payableNowPaise).toBe(6_500_000);
  });
  it("never goes negative when the client overpays", () => {
    expect(bondStanding(bond(0), 500_000 + 9_000_000).payableNowPaise).toBe(0);
  });
  it("statement lines skip cancelled bonds", () => {
    expect(bondsForStatement([bond(0, "cancelled")], 500_000, formatINR)).toHaveLength(0);
    const [l] = bondsForStatement([bond(2)], 500_000, formatINR);
    expect(l.verified).toBe(2);
    expect(l.clients).toHaveLength(3);
  });
});
