import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  recipientKind,
  recipientName,
  useEmployees,
  useExtraPayouts,
  useProject,
  useProjects,
  type ExtraPayoutRow,
} from "../lib/data";
import { modeLabel, pendingDeduction } from "../lib/extras";
import { useSettings } from "../lib/settings";
import { useFounders } from "../lib/useFounders";
import { bpToPct, extraPercent, formatINR, rupeesToPaise } from "../engine";
import NumberInput from "../components/NumberInput";

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}

/* ------------------------------------------------------------------ */
/* New extra payout: for an employee or a founder (shareholder)        */
/* ------------------------------------------------------------------ */
function NewExtraForm() {
  const qc = useQueryClient();
  const empQ = useEmployees();
  const foundersQ = useFounders();
  const projectsQ = useProjects();
  const settingsQ = useSettings();

  const [kind, setKind] = useState<"employee" | "founder">("employee");
  const [personId, setPersonId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [base, setBase] = useState("");
  const [extra, setExtra] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<"one_time" | "installments" | "per_project">("installments");
  const [count, setCount] = useState(3);
  const [pct, setPct] = useState(10);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from the recovery plan chosen in Settings.
  const defaults = settingsQ.data?.extra_recovery;
  useEffect(() => {
    if (!defaults) return;
    setMode(defaults.mode);
    setCount(defaults.count ?? 3);
    setPct((defaults.bp ?? 1000) / 100);
  }, [defaults?.mode, defaults?.count, defaults?.bp]); // eslint-disable-line react-hooks/exhaustive-deps

  const people =
    kind === "employee"
      ? (empQ.data ?? []).filter((e) => e.is_active).map((e) => ({ id: e.id, name: e.name }))
      : (foundersQ.data ?? []).filter((f) => f.is_active).map((f) => ({ id: f.id, name: f.name }));

  // Their share on the chosen project, offered as the base for the percentage.
  const projQ = useProject(projectId || undefined);
  const shareOnProject = (() => {
    const p = projQ.data;
    if (!p || !personId) return null;
    if (kind === "employee") {
      const r = p.project_employees.find((x) => x.employee_id === personId);
      return r ? Number(r.share_paise) : null;
    }
    const r = p.project_founder_payouts.find((x) => x.founder_id === personId);
    return r ? Number(r.paise) : null;
  })();

  const extraPaise = rupeesToPaise(Number(extra) || 0);
  const basePaise = base.trim() === "" ? null : rupeesToPaise(Number(base) || 0);
  const pctLabel = extraPaise > 0 && basePaise && basePaise > 0 ? extraPercent(extraPaise, basePaise).label : null;

  function switchKind(k: "employee" | "founder") {
    setKind(k);
    setPersonId("");
    setBase("");
  }

  async function onSave() {
    setMsg(null);
    setBusy(true);
    try {
      if (!personId) throw new Error(`Choose the ${kind}`);
      if (extraPaise <= 0) throw new Error("Enter the extra amount");
      if (basePaise !== null && basePaise <= 0) throw new Error("Base amount must be above zero, or leave it empty");
      if (mode === "installments" && count < 1) throw new Error("Need at least 1 installment");
      if (mode === "per_project" && (pct <= 0 || pct > 100)) throw new Error("Enter a deduction between 1% and 100%");

      const { error } = await supabase.from("extra_payouts").insert({
        employee_id: kind === "employee" ? personId : null,
        founder_id: kind === "founder" ? personId : null,
        project_id: projectId || null,
        base_paise: basePaise,
        extra_paise: extraPaise,
        extra_bp: basePaise ? extraPercent(extraPaise, basePaise).bp : null,
        recovery_mode: mode,
        installments: mode === "installments" ? count : null,
        per_project_bp: mode === "per_project" ? Math.round(pct * 100) : null,
        outstanding_paise: extraPaise,
        given_on: date,
        note: note.trim() || null,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["extra-payouts"] });
      setExtra("");
      setBase("");
      setNote("");
      setMsg({ ok: true, text: "Extra payout recorded." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6">
      <h2 className="mb-1 font-semibold">Record an extra payout</h2>
      <p className="mb-4 text-xs text-slate-500">
        Money given to someone beyond their calculated share. It is tracked, and can be deducted later in one go, in
        installments, or as a percentage of future project shares.
      </p>

      <div className="mb-4 flex gap-5 text-sm">
        {(
          [
            ["employee", "Employee"],
            ["founder", "Founder / shareholder"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name="kind" checked={kind === v} onChange={() => switchKind(v)} />
            {label}
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">{kind === "employee" ? "Employee" : "Founder"}</label>
          <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Choose...</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {people.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {kind === "employee" ? "Add employees on the Employees page first." : "Add founders in Settings first."}
            </p>
          )}
        </div>
        <div>
          <label className="label">Project (optional)</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Not linked to a project</option>
            {(projectsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Date given</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div>
          <label className="label">Extra amount (₹)</label>
          <NumberInput className="input" min={0} value={extra} onChange={(_, raw) => setExtra(raw)} />
        </div>
        <div>
          <label className="label">Their usual share, to work out % (optional)</label>
          <NumberInput className="input" min={0} value={base} onChange={(_, raw) => setBase(raw)} />
          <div className="mt-1 text-xs text-slate-600">
            {pctLabel ? `Extra is ${pctLabel} of their share.` : "Leave empty if there is nothing to compare with."}
            {shareOnProject != null && shareOnProject > 0 && (
              <>
                {" "}
                Share on this project: {formatINR(shareOnProject)}{" "}
                <button className="text-brand-600 hover:underline" type="button" onClick={() => setBase(String(shareOnProject / 100))}>
                  Use this
                </button>
              </>
            )}
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div>
          <label className="label">Recovery plan</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="one_time">One-time deduction</option>
            <option value="installments">Installments</option>
            <option value="per_project">% of each future project share</option>
          </select>
        </div>
        {mode === "installments" && (
          <div>
            <label className="label">Number of installments</label>
            <NumberInput className="input" min={1} value={count} onChange={(n) => setCount(Math.max(1, n))} />
          </div>
        )}
        {mode === "per_project" && (
          <div>
            <label className="label">Deduct per project (%)</label>
            <NumberInput className="input" min={1} max={100} value={pct} onChange={(n) => setPct(n)} />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn" disabled={busy} onClick={onSave}>
          {busy ? "Saving..." : "Record extra payout"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Recording a deduction                                               */
/* ------------------------------------------------------------------ */
function RecoveryForm({ row, onDone }: { row: ExtraPayoutRow; onDone: () => void }) {
  const qc = useQueryClient();
  const suggested = pendingDeduction(row) || null;
  const [amount, setAmount] = useState(suggested ? String(suggested / 100) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setErr(null);
    setBusy(true);
    try {
      const paise = rupeesToPaise(Number(amount) || 0);
      if (paise <= 0) throw new Error("Enter the amount deducted");
      const { error } = await supabase.rpc("record_recovery", {
        p_extra: row.id,
        p_amount: paise,
        p_on: date,
        p_project: row.project_id,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["extra-payouts"] });
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
      <div>
        <label className="label">Amount deducted (₹)</label>
        <NumberInput className="input" min={0} value={amount} onChange={(_, raw) => setAmount(raw)} />
      </div>
      <div>
        <label className="label">Date</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <label className="label">Note</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex items-end gap-2">
        <button className="btn" disabled={busy} onClick={onSave}>
          Save
        </button>
        <button className="btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
      {err && <p className="text-sm text-red-600 sm:col-span-4">{err}</p>}
    </div>
  );
}

export default function ExtraPayouts() {
  const q = useExtraPayouts();
  const [open, setOpen] = useState<string | null>(null);

  const rows = q.data ?? [];
  const totalOutstanding = rows.reduce((a, r) => a + Number(r.outstanding_paise), 0);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Extra Payouts</h1>
      <p className="mb-6 text-sm text-slate-500">
        Extra money given to employees or founders beyond their share, and how much has been recovered.
      </p>

      <NewExtraForm />

      <div className="card mb-6 inline-block">
        <div className="text-sm text-slate-500">Total still to recover</div>
        <div className="text-2xl font-semibold">{formatINR(totalOutstanding)}</div>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : q.isError ? (
        <div className="card text-sm text-red-600">
          Could not load extra payouts. Have you run migration 0003 in Supabase?
        </div>
      ) : rows.length === 0 ? (
        <div className="card text-sm text-slate-500">No extra payouts recorded yet.</div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const recovered = Number(r.extra_paise) - Number(r.outstanding_paise);
            const kind = recipientKind(r);
            return (
              <div key={r.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {recipientName(r)}{" "}
                      <span
                        className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs ${
                          kind === "Founder" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {kind}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500">
                      {r.projects?.name ?? "No project"} · given {r.given_on}
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-6 text-right text-sm">
                    <div>
                      <div className="text-slate-500">Their share</div>
                      <div>{r.base_paise != null ? formatINR(Number(r.base_paise)) : "-"}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Extra</div>
                      <div>
                        {formatINR(Number(r.extra_paise))}{" "}
                        {r.extra_bp != null && <span className="text-slate-500">({bpToPct(r.extra_bp).toFixed(2)}%)</span>}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Recovered</div>
                      <div>{formatINR(recovered)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Outstanding</div>
                      <div className="font-semibold">{formatINR(Number(r.outstanding_paise))}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-sm text-slate-600">Plan: {modeLabel(r)}</div>

                {r.recoveries.length > 0 && (
                  <ul className="mt-2 text-sm text-slate-600">
                    {[...r.recoveries]
                      .sort((a, b) => a.recovered_on.localeCompare(b.recovered_on))
                      .map((x) => (
                        <li key={x.id}>
                          {x.recovered_on}: {formatINR(Number(x.amount_paise))} deducted{x.note ? ` (${x.note})` : ""}
                        </li>
                      ))}
                  </ul>
                )}

                {r.outstanding_paise > 0 ? (
                  open === r.id ? (
                    <RecoveryForm row={r} onDone={() => setOpen(null)} />
                  ) : (
                    <button className="mt-3 text-sm text-brand-600 hover:underline" onClick={() => setOpen(r.id)}>
                      Record a deduction
                    </button>
                  )
                ) : (
                  <div className="mt-2 text-sm font-medium text-green-700">Fully recovered</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
