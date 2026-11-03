import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BUCKETS, supabase } from "../lib/supabase";
import { ACCEPTED_FILES, uploadDocument } from "../lib/files";
import { useEmployees, useExtraPayouts, useInvoiceRecords, useProject, useProjectInvoices, type ExtraPayoutRow, type InvoiceRow, type ProjectDetailRow } from "../lib/data";
import { modeLabel, pendingDeduction } from "../lib/extras";
import { buildStatementData } from "../lib/statement";
import { buildStatementPdf, downloadBlob, pdfFileName } from "../lib/pdf";
import { useUserEmail } from "../lib/useUser";
import { useSettings, type AppSettings } from "../lib/settings";
import { useRules, toSnapshot, type Rules } from "../lib/rules";
import ViewDocButton from "../components/ViewDocButton";
import {
  bpToPct,
  extraPercent,
  formatINR,
  planPayment,
  rupeesToPaise,
  splitProjectPayment,
} from "../engine";
import NumberInput from "../components/NumberInput";

function Message({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span className={`text-sm ${m.ok ? "text-green-700" : "text-red-600"}`}>{m.text}</span>;
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}

export default function ProjectDetail() {
  const { id } = useParams();
  const q = useProject(id);
  const { rules, error: rulesError, fromSnapshot } = useRules(q.data);

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (q.isError || !q.data) return <p className="text-sm text-red-600">Could not load this project.</p>;
  const p = q.data;
  const received = p.payments.reduce((a, x) => a + Number(x.amount_paise), 0);

  return (
    <div className="max-w-5xl">
      <Link to="/projects" className="text-sm text-brand-600 hover:underline">
        ← All projects
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="text-sm text-slate-500">
            Client: {p.clients?.name ?? "-"} · Revision {p.revision}
          </p>
        </div>
        <div className="flex gap-6 text-right text-sm">
          <div>
            <div className="text-slate-500">Price</div>
            <div className="font-semibold">{formatINR(Number(p.price_paise))}</div>
          </div>
          <div>
            <div className="text-slate-500">Received</div>
            <div className="font-semibold">{formatINR(received)}</div>
          </div>
          <div>
            <div className="text-slate-500">Balance</div>
            <div className="font-semibold">{formatINR(Number(p.price_paise) - received)}</div>
          </div>
        </div>
      </div>

      {rulesError && <div className="card mb-6 text-sm text-red-600">{rulesError}</div>}

      <TeamSection project={p} rules={rules} received={received} />
      <PaymentsSection project={p} rules={rules} received={received} />
      <SplitSection project={p} />
      <ClientInvoicesSection project={p} received={received} />
      <StatementSection project={p} rules={rules} fromSnapshot={fromSnapshot} received={received} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */
interface TeamDraft {
  employee_id: string;
  role: string;
  score: number;
}

function TeamSection({ project, rules, received }: { project: ProjectDetailRow; rules: Rules | null; received: number }) {
  const qc = useQueryClient();
  const empQ = useEmployees();
  const extrasQ = useExtraPayouts();
  const settingsQ = useSettings();
  const [draft, setDraft] = useState<TeamDraft[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [extraFor, setExtraFor] = useState<string | null>(null);

  const saved = useMemo<TeamDraft[]>(
    () =>
      project.project_employees.map((e) => ({
        employee_id: e.employee_id,
        role: e.role ?? "",
        score: Number(e.score),
      })),
    [project.project_employees],
  );
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const names = new Map((empQ.data ?? []).map((e) => [e.id, e.name]));
  const available = (empQ.data ?? []).filter((e) => e.is_active && !draft.some((d) => d.employee_id === e.id));
  const totalScore = draft.reduce((a, d) => a + d.score, 0);

  async function onSave() {
    setMsg(null);
    setBusy(true);
    try {
      if (draft.length === 0 && received > 0) throw new Error("A project with payments needs a team");
      if (draft.length > 0 && totalScore <= 0) throw new Error("Scores must add up to more than zero");

      // Work out each person's share of what has been received so far.
      let shares = new Map<string, { bp: number; paise: number }>();
      if (received > 0 && rules && draft.length > 0) {
        const r = splitProjectPayment(received, {
          ...rules,
          employees: draft.map((d) => ({ id: d.employee_id, name: names.get(d.employee_id) ?? "", score: d.score })),
        });
        shares = new Map(r.employeePayouts.map((e) => [e.id, { bp: e.shareBp, paise: e.paise }]));
      } else if (draft.length > 0) {
        const bps = splitProjectPayment(0, {
          companyBp: 5000,
          reserveBp: 8000,
          gst: { enabled: false, rateBp: 0 },
          tds: { enabled: false, rateBp: 0 },
          founders: [{ id: "x", name: "x", weightBp: 10000 }],
          employees: draft.map((d) => ({ id: d.employee_id, name: "", score: d.score })),
        });
        shares = new Map(bps.employeePayouts.map((e) => [e.id, { bp: e.shareBp, paise: 0 }]));
      }
      const team = draft.map((d) => ({
        employee_id: d.employee_id,
        role: d.role || null,
        score: d.score,
        share_bp: shares.get(d.employee_id)?.bp ?? 0,
        share_paise: shares.get(d.employee_id)?.paise ?? 0,
      }));
      const { error } = await supabase.rpc("save_team", { p_project: project.id, p_team: team });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["project", project.id] });
      setMsg({ ok: true, text: "Team saved." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const savedByEmp = new Map(project.project_employees.map((e) => [e.employee_id, e]));

  return (
    <section className="card mb-6">
      <h2 className="font-semibold">Team and contribution</h2>
      <p className="mb-3 text-xs text-slate-500">
        Score is each person's contribution (hours, task points or your own rating, per Settings). Higher score, bigger
        share of the employee pool.
      </p>

      {draft.length > 0 && (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2 font-medium">Employee</th>
              <th className="pb-2 font-medium">Role on this project</th>
              <th className="pb-2 font-medium">Score</th>
              <th className="pb-2 text-right font-medium">Share</th>
              <th className="pb-2 text-right font-medium">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.map((d, i) => {
              const s = savedByEmp.get(d.employee_id);
              const mine = (extrasQ.data ?? []).filter((x) => x.employee_id === d.employee_id && Number(x.outstanding_paise) > 0);
              return (
                <Fragment key={d.employee_id}>
                <tr className="border-t border-slate-100">
                  <td className="py-2 font-medium">{names.get(d.employee_id) ?? "Unknown"}</td>
                  <td>
                    <input
                      className="input w-44"
                      value={d.role}
                      onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <NumberInput
                      className="input w-24"
                      min={0}
                      step={0.5}
                      value={d.score}
                      onChange={(n) => setDraft(draft.map((x, j) => (j === i ? { ...x, score: Math.max(0, n) } : x)))}
                    />
                  </td>
                  <td className="text-right">{s?.share_bp != null ? `${bpToPct(s.share_bp).toFixed(2)}%` : "-"}</td>
                  <td className="text-right">{s ? formatINR(Number(s.share_paise)) : "-"}</td>
                  <td className="whitespace-nowrap pl-3 text-right">
                    {s && Number(s.share_paise) > 0 && !dirty && (
                      <button className="mr-3 text-brand-600 hover:underline" onClick={() => setExtraFor(d.employee_id)}>
                        Give extra
                      </button>
                    )}
                    {project.payments.length === 0 && (
                      <button
                        className="text-red-600 hover:underline"
                        onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
                {mine.length > 0 && !dirty && (
                  <tr>
                    <td colSpan={6} className="pb-2">
                      <PendingDeductions extras={mine} sharePaise={s ? Number(s.share_paise) : 0} projectId={project.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input w-64"
          value=""
          onChange={(e) => {
            const emp = (empQ.data ?? []).find((x) => x.id === e.target.value);
            if (emp) setDraft([...draft, { employee_id: emp.id, role: emp.role ?? "", score: 0 }]);
          }}
        >
          <option value="">+ Add employee to project...</option>
          {available.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button className="btn" disabled={!dirty || busy} onClick={onSave}>
          Save team
        </button>
        <Message m={msg} />
      </div>
      {project.payments.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Payments exist, so team members can be re-weighted but not removed. The employee pool total never changes.
        </p>
      )}
      {empQ.data && empQ.data.length === 0 && (
        <p className="mt-2 text-xs text-amber-700">
          No employees yet. Add some on the <Link className="underline" to="/employees">Employees</Link> page.
        </p>
      )}

      {extraFor && settingsQ.data && savedByEmp.get(extraFor) && (
        <ExtraForm
          project={project}
          employeeId={extraFor}
          employeeName={names.get(extraFor) ?? ""}
          basePaise={Number(savedByEmp.get(extraFor)!.share_paise)}
          settings={settingsQ.data}
          onClose={() => setExtraFor(null)}
        />
      )}
    </section>
  );
}

/** Outstanding extra payouts for one employee, with a one-click deduction from their share on this project. */
function PendingDeductions({ extras, sharePaise, projectId }: { extras: ExtraPayoutRow[]; sharePaise: number; projectId: string }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply(x: ExtraPayoutRow, paise: number) {
    setMsg(null);
    setBusyId(x.id);
    try {
      const { error } = await supabase.rpc("record_recovery", {
        p_extra: x.id,
        p_amount: paise,
        p_on: new Date().toISOString().slice(0, 10),
        p_project: projectId,
        p_note: "Deducted from project share",
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["extra-payouts"] });
      setMsg({ ok: true, text: "Deduction recorded." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {extras.map((x) => {
        const suggested = pendingDeduction(x, sharePaise);
        return (
          <div key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-0.5">
            <span>
              Extra payout still owed: <b>{formatINR(Number(x.outstanding_paise))}</b> of {formatINR(Number(x.extra_paise))} ({modeLabel(x)})
            </span>
            {suggested > 0 ? (
              <button
                className="font-medium text-brand-700 hover:underline disabled:opacity-50"
                disabled={busyId === x.id}
                onClick={() => apply(x, suggested)}
              >
                Deduct {formatINR(suggested)} now
              </button>
            ) : (
              <span className="text-amber-700">No deduction due on this project.</span>
            )}
          </div>
        );
      })}
      {msg && <div className={msg.ok ? "text-green-700" : "text-red-600"}>{msg.text}</div>}
    </div>
  );
}

function ExtraForm({
  project,
  employeeId,
  employeeName,
  basePaise,
  settings,
  onClose,
}: {
  project: ProjectDetailRow;
  employeeId: string;
  employeeName: string;
  basePaise: number;
  settings: AppSettings;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(settings.extra_recovery.mode);
  const [count, setCount] = useState(settings.extra_recovery.count ?? 3);
  const [pct, setPct] = useState(bpToPct(settings.extra_recovery.bp ?? 1000));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const extraPaise = rupeesToPaise(Number(amount) || 0);
  const pctLabel = extraPaise > 0 ? extraPercent(extraPaise, basePaise).label : "-";

  async function onSave() {
    setMsg(null);
    setBusy(true);
    try {
      if (extraPaise <= 0) throw new Error("Enter the extra amount");
      const { error } = await supabase.from("extra_payouts").insert({
        employee_id: employeeId,
        project_id: project.id,
        base_paise: basePaise,
        extra_paise: extraPaise,
        extra_bp: extraPercent(extraPaise, basePaise).bp,
        recovery_mode: mode,
        installments: mode === "installments" ? count : null,
        per_project_bp: mode === "per_project" ? Math.round(pct * 100) : null,
        outstanding_paise: extraPaise,
        note: note.trim() || null,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["extra-payouts"] });
      setMsg({ ok: true, text: "Recorded. Track recovery on the Extra Payouts page." });
      setAmount("");
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">Extra payout for {employeeName}</h3>
        <button className="text-sm text-slate-500 hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-600">
        Base share on this project: {formatINR(basePaise)}. The extra is tracked as a percentage of the base share and
        recovered from future pay.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Extra amount (₹)</label>
          <NumberInput className="input" min={0} value={amount} onChange={(_, raw) => setAmount(raw)} />
          <div className="mt-1 text-xs text-slate-600">= {pctLabel} of base share</div>
        </div>
        <div>
          <label className="label">Recovery</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="one_time">One-time deduction</option>
            <option value="installments">Installments</option>
            <option value="per_project">% of future project shares</option>
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
        <div>
          <label className="label">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn" disabled={busy} onClick={onSave}>
          Record extra payout
        </button>
        <Message m={msg} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */
function PaymentsSection({ project, rules, received }: { project: ProjectDetailRow; rules: Rules | null; received: number }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const team = project.project_employees;
  const amountPaise = rupeesToPaise(Number(amount) || 0);

  const plan = useMemo(() => {
    if (!rules || team.length === 0 || amountPaise <= 0) return null;
    try {
      return {
        ok: true as const,
        p: planPayment(received, amountPaise, {
          ...rules,
          employees: team.map((t) => ({ id: t.employee_id, name: t.employees?.name ?? "", score: Number(t.score) })),
        }),
      };
    } catch (e) {
      return { ok: false as const, error: errText(e) };
    }
  }, [rules, team, amountPaise, received]);

  async function onRecord() {
    setMsg(null);
    setBusy(true);
    try {
      if (!rules) throw new Error("Rules are not ready. Check Settings.");
      if (team.length === 0) throw new Error("Save a team first");
      if (!plan || !plan.ok) throw new Error(plan && !plan.ok ? plan.error : "Enter a payment amount");

      const docId = file
        ? await uploadDocument({ bucket: BUCKETS.clientPayments, file, folder: project.id })
        : null;

      const { after } = plan.p;
      const { error } = await supabase.rpc("record_payment", {
        p_project: project.id,
        p_amount: amountPaise,
        p_received_on: date,
        p_gst: plan.p.gstDeltaPaise,
        p_tds: plan.p.tdsDeltaPaise,
        p_note: note.trim() || null,
        p_document: docId,
        p_reserve_delta: plan.p.reserveDeltaPaise,
        p_founders: after.founderPayouts.map((f) => ({ founder_id: f.id, weight_bp: f.weightBp, paise: f.paise })),
        p_employees: after.employeePayouts.map((e) => ({ employee_id: e.id, share_bp: e.shareBp, share_paise: e.paise })),
        p_snapshot: toSnapshot(rules),
      });
      if (error) throw error;

      setAmount("");
      setNote("");
      setFile(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", project.id] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["reserve-balance"] }),
      ]);
      setMsg({ ok: true, text: "Payment recorded and split." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const overPrice = amountPaise > 0 && received + amountPaise > Number(project.price_paise);

  return (
    <section className="card mb-6">
      <h2 className="mb-3 font-semibold">Client payments</h2>

      {project.payments.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 text-right font-medium">Amount</th>
              <th className="pb-2 text-right font-medium">GST</th>
              <th className="pb-2 text-right font-medium">TDS</th>
              <th className="pb-2 pl-4 font-medium">Note</th>
              <th className="pb-2 text-right font-medium">Proof</th>
            </tr>
          </thead>
          <tbody>
            {[...project.payments]
              .sort((a, b) => a.received_on.localeCompare(b.received_on))
              .map((x) => (
                <tr key={x.id} className="border-t border-slate-100">
                  <td className="py-2">{x.received_on}</td>
                  <td className="text-right">{formatINR(Number(x.amount_paise))}</td>
                  <td className="text-right">{formatINR(Number(x.gst_paise))}</td>
                  <td className="text-right">{formatINR(Number(x.tds_paise))}</td>
                  <td className="pl-4 text-slate-600">{x.note ?? ""}</td>
                  <td className="text-right">
                    <ViewDocButton documentId={x.document_id} label="View proof" />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {team.length === 0 ? (
        <p className="text-sm text-amber-700">Save the project team above before recording a payment.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="label">Amount received (₹)</label>
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
            <div>
              <label className="label">Proof of payment (PDF or image)</label>
              <input
                className="block w-full text-sm"
                type="file"
                accept={ACCEPTED_FILES}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {overPrice && (
            <p className="mt-2 text-xs text-amber-700">This takes total received above the agreed price.</p>
          )}

          {plan && !plan.ok && <p className="mt-3 text-sm text-red-600">{plan.error}</p>}
          {plan && plan.ok && (
            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
              <div className="mb-2 font-medium">What this payment will do (rules saved on the project)</div>
              <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                <div className="flex justify-between"><span className="text-slate-600">Added to reserve</span><span>{formatINR(plan.p.reserveDeltaPaise)}</span></div>
                {plan.p.gstDeltaPaise + plan.p.tdsDeltaPaise > 0 && (
                  <div className="flex justify-between"><span className="text-slate-600">GST / TDS on this payment</span><span>{formatINR(plan.p.gstDeltaPaise)} / {formatINR(plan.p.tdsDeltaPaise)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-slate-600">Founders pool (total so far)</span><span>{formatINR(plan.p.after.foundersPoolPaise)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Employee pool (total so far)</span><span>{formatINR(plan.p.after.employeePoolPaise)}</span></div>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button className="btn" disabled={busy || !plan || !plan.ok} onClick={onRecord}>
              {busy ? "Recording..." : "Record payment"}
            </button>
            <Message m={msg} />
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Split summary                                                       */
/* ------------------------------------------------------------------ */
function SplitSection({ project }: { project: ProjectDetailRow }) {
  const extrasQ = useExtraPayouts();
  if (project.payments.length === 0) return null;
  const empTotal = project.project_employees.reduce((a, e) => a + Number(e.share_paise), 0);
  const founderTotal = project.project_founder_payouts.reduce((a, f) => a + Number(f.paise), 0);
  return (
    <section className="card mb-6">
      <h2 className="mb-3 font-semibold">Where the money went (total so far)</h2>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-sm font-medium">Founders ({formatINR(founderTotal)})</div>
          <table className="w-full text-sm">
            <tbody>
              {[...project.project_founder_payouts]
                .sort((a, b) => b.weight_bp - a.weight_bp)
                .map((f) => {
                  const owed = (extrasQ.data ?? []).filter((x) => x.founder_id === f.founder_id && Number(x.outstanding_paise) > 0);
                  return (
                    <Fragment key={f.founder_id}>
                      <tr className="border-t border-slate-100">
                        <td className="py-1">{f.founders?.name ?? "Founder"} ({bpToPct(f.weight_bp)}%)</td>
                        <td className="text-right">{formatINR(Number(f.paise))}</td>
                      </tr>
                      {owed.length > 0 && (
                        <tr>
                          <td colSpan={2} className="pb-2">
                            <PendingDeductions extras={owed} sharePaise={Number(f.paise)} projectId={project.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">Employees ({formatINR(empTotal)})</div>
          <table className="w-full text-sm">
            <tbody>
              {[...project.project_employees]
                .sort((a, b) => Number(b.share_paise) - Number(a.share_paise))
                .map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-1">{e.employees?.name ?? "Employee"}</td>
                    <td className="text-right">{formatINR(Number(e.share_paise))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        The reserve share has been posted to the company reserve. Rules used: company {bpToPct(project.settings_snapshot?.companyBp ?? 0)}% /
        reserve {bpToPct(project.settings_snapshot?.reserveBp ?? 0)}% of that.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Client invoices: record the invoices you have raised for this project */
/* ------------------------------------------------------------------ */
const STATUS_LABEL = { draft: "Draft", sent: "Sent", paid: "Paid", cancelled: "Cancelled" } as const;

function nextInvoiceNumber(existing: InvoiceRow[]): string {
  const used = existing
    .map((i) => /^INV-(\d+)$/i.exec(i.invoice_number.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const next = (used.length ? Math.max(...used) : existing.length) + 1;
  return `INV-${String(next).padStart(3, "0")}`;
}

/** "Attach file" for an invoice that was saved without one. */
function AttachInvoiceFile({ invoice, projectId }: { invoice: InvoiceRow; projectId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <label className={`cursor-pointer text-sm hover:underline ${err ? "text-red-600" : "text-brand-600"}`}>
      {busy ? "Uploading..." : err ? "Failed, retry" : "Attach file"}
      <input
        type="file"
        accept={ACCEPTED_FILES}
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setErr(false);
          try {
            const docId = await uploadDocument({ bucket: BUCKETS.projectInvoices, file: f, folder: projectId, linkedTable: "project_invoices", linkedId: invoice.id });
            const { error } = await supabase.from("project_invoices").update({ document_id: docId }).eq("id", invoice.id);
            if (error) throw error;
            await qc.invalidateQueries({ queryKey: ["invoice-records", projectId] });
          } catch {
            setErr(true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

function ClientInvoicesSection({ project, received }: { project: ProjectDetailRow; received: number }) {
  const qc = useQueryClient();
  const invQ = useInvoiceRecords(project.id);
  const invoices = invQ.data ?? [];
  const price = Number(project.price_paise);
  const invoiced = invoices.filter((i) => i.status !== "cancelled").reduce((a, i) => a + Number(i.amount_paise), 0);
  const paidInvoices = invoices.filter((i) => i.status === "paid").reduce((a, i) => a + Number(i.amount_paise), 0);
  const notYetInvoiced = price - invoiced;

  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [issued, setIssued] = useState(new Date().toISOString().slice(0, 10));
  const [due, setDue] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<keyof typeof STATUS_LABEL>("sent");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function openForm() {
    setNumber(nextInvoiceNumber(invoices));
    setAmount(notYetInvoiced > 0 ? String(notYetInvoiced / 100) : "");
    setMsg(null);
    setOpen(true);
  }

  async function onSave() {
    setMsg(null);
    setBusy(true);
    try {
      const amountPaise = rupeesToPaise(Number(amount) || 0);
      if (!number.trim()) throw new Error("Enter the invoice number");
      if (amountPaise <= 0) throw new Error("Enter the invoice amount");
      if (due && due < issued) throw new Error("Due date is before the invoice date");

      const id = crypto.randomUUID();
      const ins = await supabase.from("project_invoices").insert({
        id,
        project_id: project.id,
        invoice_number: number.trim(),
        issued_on: issued,
        due_on: due || null,
        amount_paise: amountPaise,
        status,
        description: description.trim() || null,
        note: note.trim() || null,
      });
      if (ins.error) {
        if (ins.error.code === "23505") throw new Error(`Invoice ${number.trim()} already exists on this project. Use a different number.`);
        throw ins.error;
      }

      let text = `Invoice ${number.trim()} added.`;
      if (file) {
        try {
          const docId = await uploadDocument({ bucket: BUCKETS.projectInvoices, file, folder: project.id, linkedTable: "project_invoices", linkedId: id });
          const upd = await supabase.from("project_invoices").update({ document_id: docId }).eq("id", id);
          if (upd.error) throw upd.error;
        } catch {
          text = `Invoice ${number.trim()} saved, but the file did not upload. Use "Attach file" on its row to retry.`;
        }
      }
      await qc.invalidateQueries({ queryKey: ["invoice-records", project.id] });
      setDescription("");
      setNote("");
      setDue("");
      setFile(null);
      setFileKey((k) => k + 1);
      setOpen(false);
      setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function setInvoiceStatus(inv: InvoiceRow, next: InvoiceRow["status"]) {
    const { error } = await supabase.from("project_invoices").update({ status: next }).eq("id", inv.id);
    if (error) setMsg({ ok: false, text: errText(error) });
    await qc.invalidateQueries({ queryKey: ["invoice-records", project.id] });
  }

  return (
    <section className="card mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Client invoices</h2>
          <p className="text-xs text-slate-500">Invoices you have raised for this client. Add the invoice file if you have it.</p>
        </div>
        {!open && (
          <button className="btn" onClick={openForm}>
            Add invoice
          </button>
        )}
      </div>

      {open && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-4 grid gap-x-8 gap-y-1 rounded-lg bg-surface p-3 text-sm sm:grid-cols-3">
            <div><span className="text-slate-500">Project: </span><b>{project.name}</b></div>
            <div><span className="text-slate-500">Client: </span><b>{project.clients?.name ?? "-"}</b></div>
            <div><span className="text-slate-500">Agreed price: </span><b>{formatINR(price)}</b></div>
            <div><span className="text-slate-500">Received: </span><b>{formatINR(received)}</b></div>
            <div><span className="text-slate-500">Already invoiced: </span><b>{formatINR(invoiced)}</b></div>
            <div><span className="text-slate-500">Not yet invoiced: </span><b>{formatINR(Math.max(notYetInvoiced, 0))}</b></div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="label">Invoice number</label>
              <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Invoice date</label>
              <input className="input" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
            </div>
            <div>
              <label className="label">Due date (optional)</label>
              <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div>
              <label className="label">Invoice amount (₹)</label>
              <NumberInput className="input" min={0} value={amount} onChange={(_, raw) => setAmount(raw)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="label">What is this invoice for?</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Advance for design phase" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Invoice file (PDF or image, optional)</label>
              <input key={fileKey} className="block w-full text-sm" type="file" accept={ACCEPTED_FILES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Note (optional)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          {invoiced + rupeesToPaise(Number(amount) || 0) > price && (
            <p className="mt-2 text-xs text-amber-700">This takes the total invoiced above the agreed price.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn" disabled={busy} onClick={onSave}>
              {busy ? "Saving..." : "Save invoice"}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <Message m={msg} />
          </div>
        </div>
      )}
      {!open && <Message m={msg} />}

      {invQ.isError ? (
        <p className="text-sm text-red-600">Could not load invoices. Have you run migration 0003 in Supabase?</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-slate-500">No invoices yet. Use "Add invoice".</p>
      ) : (
        <>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Invoice</th>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Due</th>
                <th className="pb-2 font-medium">For</th>
                <th className="pb-2 text-right font-medium">Amount</th>
                <th className="pb-2 pl-4 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">File</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className={`border-t border-slate-100 ${i.status === "cancelled" ? "text-slate-400 line-through" : ""}`}>
                  <td className="py-2 font-medium">{i.invoice_number}</td>
                  <td>{i.issued_on}</td>
                  <td>{i.due_on ?? "-"}</td>
                  <td className="max-w-[16rem] truncate text-slate-600" title={[i.description, i.note].filter(Boolean).join(" · ")}>{i.description ?? ""}</td>
                  <td className="text-right">{formatINR(Number(i.amount_paise))}</td>
                  <td className="pl-4">
                    <select
                      className="rounded border border-slate-300 bg-surface px-2 py-1 text-xs"
                      value={i.status}
                      aria-label={`Status of ${i.invoice_number}`}
                      onChange={(e) => setInvoiceStatus(i, e.target.value as InvoiceRow["status"])}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right">
                    {i.document_id ? <ViewDocButton documentId={i.document_id} label="View" /> : <AttachInvoiceFile invoice={i} projectId={project.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Invoiced {formatINR(invoiced)} of {formatINR(price)} · marked paid {formatINR(paidInvoices)} · cancelled invoices are not counted.
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Settlement statement (internal PDF) and other project documents    */
/* ------------------------------------------------------------------ */
function StatementSection({
  project,
  rules,
  fromSnapshot,
  received,
}: {
  project: ProjectDetailRow;
  rules: Rules | null;
  fromSnapshot: boolean;
  received: number;
}) {
  const qc = useQueryClient();
  const email = useUserEmail();
  const docsQ = useProjectInvoices(project.id);
  const invQ = useInvoiceRecords(project.id);
  const extrasQ = useExtraPayouts();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"gen" | "dl" | null>(null);

  const canGenerate = Boolean(rules) && project.project_employees.length > 0 && received > 0;

  async function makeStatement() {
    if (!rules) throw new Error("Rules are not ready. Check Settings.");
    const data = buildStatementData({
      kind: "settlement",
      project,
      basisLabel: "Total received so far",
      basisPaise: received,
      rules,
      fromSnapshot,
      team: project.project_employees.map((e) => ({
        employeeId: e.employee_id,
        name: e.employees?.name ?? "Employee",
        role: e.role ?? "",
        score: Number(e.score),
      })),
      extras: (extrasQ.data ?? []).filter((x) => x.project_id === project.id),
      preparedBy: email,
      attachments: [
        ...project.payments.filter((x) => x.document_id).map((x) => `Payment proof, ${x.received_on}`),
        ...(invQ.data ?? [])
          .filter((i) => i.status !== "cancelled")
          .map((i) => `Client invoice ${i.invoice_number}: ${formatINR(Number(i.amount_paise))} (${STATUS_LABEL[i.status].toLowerCase()})`),
        ...(docsQ.data ?? []).map((d) => d.file_name),
      ],
    });
    const blob = await buildStatementPdf(data);
    return { blob, name: pdfFileName(data) };
  }

  async function onGenerate() {
    setMsg(null);
    setBusy("gen");
    try {
      const { blob, name } = await makeStatement();
      const f = new File([blob], name, { type: "application/pdf" });
      await uploadDocument({ bucket: BUCKETS.projectInvoices, file: f, folder: project.id, linkedTable: "projects", linkedId: project.id });
      await qc.invalidateQueries({ queryKey: ["project-invoices", project.id] });
      downloadBlob(blob, name);
      setMsg({ ok: true, text: "Settlement statement added to this project and downloaded." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onDownloadOnly() {
    setMsg(null);
    setBusy("dl");
    try {
      const { blob, name } = await makeStatement();
      downloadBlob(blob, name);
      setMsg({ ok: true, text: "PDF downloaded (not saved to the project)." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card mb-6">
      <h2 className="font-semibold">Settlement statement</h2>
      <p className="mb-3 text-xs text-slate-500">
        An internal PDF with the project details, team and roles, salary distribution, founder payouts, extra payouts, payments
        and invoices. Each new version gets a revision number. Not for sharing with clients.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={!canGenerate || busy !== null} onClick={onGenerate}>
          {busy === "gen" ? "Generating..." : "Generate and add to project"}
        </button>
        <button className="btn-ghost" disabled={!canGenerate || busy !== null} onClick={onDownloadOnly}>
          {busy === "dl" ? "Building..." : "Download only"}
        </button>
        <Message m={msg} />
      </div>
      {!canGenerate && <p className="mt-2 text-xs text-amber-700">Save a team and record a payment first.</p>}

      {docsQ.data && docsQ.data.length > 0 && (
        <>
          <div className="mb-1 mt-4 text-sm font-medium">Saved statements and other documents</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {docsQ.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <span>
                  {d.file_name} <span className="text-xs text-slate-400">{d.uploaded_at.slice(0, 10)}</span>
                </span>
                <ViewDocButton documentId={d.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
