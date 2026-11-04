import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BUCKETS, supabase } from "../lib/supabase";
import { ACCEPTED_FILES, uploadDocument } from "../lib/files";
import type { ProjectDetailRow } from "../lib/data";
import { useSettings } from "../lib/settings";
import {
  BOND_STATUS_LABEL,
  bondStanding,
  compensationText,
  useProjectBonds,
  verifiedCount,
  type ClientBondRow,
} from "../lib/bonds";
import { formatINR, rupeesToPaise } from "../engine";
import NumberInput from "./NumberInput";
import ViewDocButton from "./ViewDocButton";

const errText = (e: unknown) =>
  e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong";
const today = () => new Date().toISOString().slice(0, 10);

/** Signed client bond: upload the scan, record the terms, track referrals and the outcome. */
export default function ClientBondSection({ project, received }: { project: ProjectDetailRow; received: number }) {
  const q = useProjectBonds(project.id);
  const [adding, setAdding] = useState(false);
  const bonds = q.data ?? [];
  const hasActive = bonds.some((b) => b.status === "active");

  return (
    <section className="card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Client bond</h2>
          <p className="text-xs text-slate-500">
            For deals like "pay part now, bring new clients for the rest". Upload the signed bond, record the terms and track the referrals.
          </p>
        </div>
        {!adding && !hasActive && (
          <button className="btn" onClick={() => setAdding(true)}>
            Add bond
          </button>
        )}
      </div>

      {q.isError && <p className="mt-2 text-sm text-red-600">Could not load bonds.</p>}
      {adding && <BondForm project={project} received={received} onDone={() => setAdding(false)} />}
      {bonds.length === 0 && !adding && !q.isLoading && <p className="mt-3 text-sm text-slate-500">No bond on this project.</p>}
      {bonds.map((b) => (
        <BondCard key={b.id} bond={b} project={project} received={received} />
      ))}
    </section>
  );
}

function BondForm({ project, received, onDone }: { project: ProjectDetailRow; received: number; onDone: () => void }) {
  const qc = useQueryClient();
  const settingsQ = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const comp = settingsQ.data?.bond_compensation;
  const balance = Math.max(0, Number(project.price_paise) - received);

  const [title, setTitle] = useState("Referral bond");
  const [signedOn, setSignedOn] = useState(today());
  const [deadline, setDeadline] = useState("");
  const [required, setRequired] = useState(3);
  const [outstanding, setOutstanding] = useState(String(balance / 100));
  const [kind, setKind] = useState<"percent" | "fixed" | "per_missed" | "">("");
  const [value, setValue] = useState("");
  const [terms, setTerms] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Start from the Settings default compensation until the user picks something.
  const effKind = kind || comp?.kind || "percent";
  const effValue =
    value !== ""
      ? value
      : effKind === "percent"
        ? String((comp?.kind === "percent" ? (comp.bp ?? 1000) : 1000) / 100)
        : String(comp?.kind === effKind ? (comp.paise ?? 0) / 100 : 0);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (!title.trim()) throw new Error("Give the bond a title");
      if (required < 1 || !Number.isInteger(required)) throw new Error("Required clients must be a whole number, at least 1");
      const out = rupeesToPaise(Number(outstanding));
      if (!Number.isFinite(out) || out <= 0) throw new Error("Enter the amount this bond covers (above zero)");
      const v = effKind === "percent" ? Math.round(Number(effValue) * 100) : rupeesToPaise(Number(effValue));
      if (!Number.isFinite(v) || v < 0) throw new Error("Enter a valid compensation");

      const bondId = crypto.randomUUID();
      let docId: string | null = null;
      if (file) {
        docId = await uploadDocument({ bucket: BUCKETS.bondsClients, file, folder: project.id, linkedTable: "bonds", linkedId: bondId });
      }
      const { error } = await supabase.from("bonds").insert({
        id: bondId,
        party_type: "client",
        party_name: project.clients?.name ?? "Client",
        client_id: project.clients?.id ?? null,
        project_id: project.id,
        title: title.trim(),
        terms: terms.trim() || null,
        total_price_paise: Number(project.price_paise),
        paid_paise: received,
        outstanding_paise: out,
        required_referrals: required,
        compensation_kind: effKind,
        compensation_value: v,
        signed_on: signedOn || null,
        deadline: deadline || null,
        document_id: docId,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["client-bonds"] });
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3">
      <div className="sm:col-span-3 text-xs text-slate-500">
        Price {formatINR(Number(project.price_paise))}, received so far {formatINR(received)}, balance {formatINR(balance)}.
      </div>
      <div>
        <label className="label">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="label">Signed on</label>
        <input type="date" className="input" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
      </div>
      <div>
        <label className="label">Deadline to bring clients</label>
        <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </div>
      <div>
        <label className="label">New clients required</label>
        <NumberInput className="input" min={1} step={1} value={required} onChange={(n) => setRequired(Math.max(0, Math.round(n)))} />
      </div>
      <div>
        <label className="label">Amount the bond covers (₹)</label>
        <NumberInput className="input" min={0} value={outstanding} onChange={(_, raw) => setOutstanding(raw)} />
      </div>
      <div className="hidden sm:block" />
      <div>
        <label className="label">If he fails, compensation</label>
        <select
          className="input"
          value={effKind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setValue("");
          }}
        >
          <option value="percent">% of the unpaid amount</option>
          <option value="fixed">Fixed amount</option>
          <option value="per_missed">Amount per missed client</option>
        </select>
      </div>
      <div>
        <label className="label">{effKind === "percent" ? "Percent (%)" : "Amount (₹)"}</label>
        <NumberInput className="input" min={0} value={effValue} onChange={(_, raw) => setValue(raw)} />
      </div>
      <div>
        <label className="label">Signed bond (PDF or photo)</label>
        <input ref={fileRef} type="file" accept={ACCEPTED_FILES} className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="sm:col-span-3">
        <label className="label">Terms in your words (optional)</label>
        <textarea className="input min-h-16" value={terms} onChange={(e) => setTerms(e.target.value)} />
      </div>
      <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save bond"}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={onDone}>
          Cancel
        </button>
        {!file && <span className="text-xs text-amber-700">No file chosen. You can attach the signed bond later.</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}

function BondCard({ bond: b, project, received }: { bond: ClientBondRow; project: ProjectDetailRow; received: number }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["client-bonds"] });
  const required = b.required_referrals ?? 1;
  const delivered = verifiedCount(b);
  const st = bondStanding(b, received);
  const active = b.status === "active";
  const overdue = active && b.deadline != null && b.deadline < today();

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const attach = (file: File) =>
    run(async () => {
      const docId = await uploadDocument({ bucket: BUCKETS.bondsClients, file, folder: project.id, linkedTable: "bonds", linkedId: b.id });
      const { error } = await supabase.from("bonds").update({ document_id: docId }).eq("id", b.id);
      if (error) throw error;
    });

  const addReferral = () =>
    run(async () => {
      if (!name.trim()) throw new Error("Enter the new client's name");
      const { error } = await supabase.from("referrals").insert({ bond_id: b.id, referred_name: name.trim(), contact: contact.trim() || null });
      if (error) throw error;
      setName("");
      setContact("");
    });

  const setVerified = (id: string, verified: boolean) =>
    run(async () => {
      const { error } = await supabase.from("referrals").update({ verified, verified_on: verified ? today() : null }).eq("id", id);
      if (error) throw error;
    });

  const removeReferral = (id: string) =>
    run(async () => {
      const { error } = await supabase.from("referrals").delete().eq("id", id);
      if (error) throw error;
    });

  const close = () =>
    run(async () => {
      const text =
        st.outcome.status === "fulfilled"
          ? `All ${required} clients delivered. The ${formatINR(b.outstanding_paise ?? 0)} will be marked as waived.`
          : `${delivered} of ${required} delivered. The client will owe ${formatINR(st.outcome.totalPayablePaise)} (including compensation ${formatINR(st.outcome.compensationPaise)}).`;
      if (!window.confirm(`Close this bond now?\n\n${text}`)) return;
      const { error } = await supabase.from("bonds").update({ status: st.outcome.status }).eq("id", b.id);
      if (error) throw error;
    });

  const cancel = () =>
    run(async () => {
      if (!window.confirm("Cancel this bond? It will no longer count. The signed file is kept.")) return;
      const { error } = await supabase.from("bonds").update({ status: "cancelled" }).eq("id", b.id);
      if (error) throw error;
    });

  const badge =
    b.status === "fulfilled"
      ? "bg-green-100 text-green-800"
      : b.status === "active"
        ? overdue
          ? "bg-red-100 text-red-800"
          : "bg-amber-100 text-amber-900"
        : b.status === "cancelled"
          ? "bg-slate-200 text-slate-700"
          : "bg-red-100 text-red-800";

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{b.title}</div>
          <div className="text-xs text-slate-500">
            {b.signed_on ? `Signed ${b.signed_on}` : "Signing date not recorded"}
            {b.deadline ? ` · Deadline ${b.deadline}` : ""}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge}`}>
          {overdue ? "Deadline passed" : BOND_STATUS_LABEL[b.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept={ACCEPTED_FILES}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void attach(f);
          }}
        />
        {b.document_id ? (
          <>
            <ViewDocButton documentId={b.document_id} label="View signed bond" />
            <button className="text-xs text-slate-500 hover:underline" disabled={busy} onClick={() => fileRef.current?.click()} title="Upload a newer version. The old file is kept.">
              Replace
            </button>
          </>
        ) : (
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
            Upload signed bond
          </button>
        )}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between"><dt className="text-slate-500">Covered by the bond</dt><dd className="font-medium">{formatINR(b.outstanding_paise ?? 0)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">Paid when signed</dt><dd>{formatINR(b.paid_paise ?? 0)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">New clients</dt><dd className="font-medium">{delivered} of {required} verified</dd></div>
        <div className="flex justify-between"><dt className="text-slate-500">If he fails</dt><dd>{compensationText(b.compensation_kind, b.compensation_value, formatINR)}</dd></div>
      </dl>
      {b.terms && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{b.terms}</p>}

      <div className="mt-4">
        <div className="mb-1 text-sm font-medium">Clients brought</div>
        {b.referrals.length === 0 && <p className="text-xs text-slate-500">None recorded yet.</p>}
        {b.referrals.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-slate-100 py-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={r.verified} disabled={busy || !active} onChange={(e) => setVerified(r.id, e.target.checked)} />
              <span className="font-medium">{r.referred_name}</span>
            </label>
            <span className="text-xs text-slate-500">{r.contact ?? ""}</span>
            <span className="text-xs text-slate-500">{r.verified ? `Verified ${r.verified_on ?? ""}` : "Not verified yet"}</span>
            {active && (
              <button className="ml-auto text-xs text-red-600 hover:underline" disabled={busy} onClick={() => removeReferral(r.id)}>
                Remove
              </button>
            )}
          </div>
        ))}
        {active && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="input w-48" placeholder="New client name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input w-48" placeholder="Phone or email (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
            <button className="btn-ghost" disabled={busy} onClick={addReferral}>
              Add client
            </button>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">Tick a client as verified once they have actually signed or paid with you.</p>
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <div className="font-medium">{active ? "If the bond closed today" : "Final outcome"}</div>
        {st.outcome.status === "fulfilled" ? (
          <p>All {required} clients delivered. {formatINR(b.outstanding_paise ?? 0)} is waived. Nothing more is owed.</p>
        ) : (
          <>
            <p>
              {formatINR(st.outcome.creditedPaise)} waived for {delivered} client{delivered === 1 ? "" : "s"} delivered. Still due{" "}
              {formatINR(st.outcome.remainingDuePaise)} + compensation {formatINR(st.outcome.compensationPaise)} ={" "}
              <b>{formatINR(st.outcome.totalPayablePaise)}</b>.
            </p>
            {st.cashSinceSigningPaise > 0 && (
              <p className="text-xs text-slate-500">
                Already paid since signing: {formatINR(st.cashSinceSigningPaise)}. Still to collect now:{" "}
                <b>{formatINR(st.payableNowPaise)}</b>.
              </p>
            )}
          </>
        )}
      </div>

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn" disabled={busy} onClick={close}>
            Close bond
          </button>
          <button className="btn-ghost" disabled={busy} onClick={cancel}>
            Cancel bond
          </button>
          <span className="text-xs text-slate-500">Close it when the deadline is reached (or all clients are in).</span>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
