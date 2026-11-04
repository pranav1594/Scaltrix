import { methodExplanation, methodLabel, normalizeMix } from "../lib/scoring";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BUCKETS } from "../lib/supabase";
import { uploadDocument } from "../lib/files";
import { buildStatementPdf, downloadBlob, pdfFileName } from "../lib/pdf";
import { buildStatementData, type TeamInput } from "../lib/statement";
import { useExtraPayouts, useProject, useProjects } from "../lib/data";
import { useRules, type Rules } from "../lib/rules";
import { totalsFor } from "../lib/extras";
import { useUserEmail } from "../lib/useUser";
import { formatINR, bpToPct, rupeesToPaise } from "../engine";
import NumberInput from "../components/NumberInput";

type Basis = "received" | "price" | "custom";

interface Row extends TeamInput {
  key: string;
}

const SAMPLE_FOUNDERS: Rules["founders"] = [
  { id: "f1", name: "Founder 1 (sample)", weightBp: 5000 },
  { id: "f2", name: "Founder 2 (sample)", weightBp: 3000 },
  { id: "f3", name: "Founder 3 (sample)", weightBp: 2000 },
];

let keyCounter = 0;
const newKey = () => `r${++keyCounter}`;

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}

export default function Calculator() {
  const qc = useQueryClient();
  const email = useUserEmail();
  const projectsQ = useProjects();
  const [projectId, setProjectId] = useState("");
  const projectQ = useProject(projectId || undefined);
  const project = projectId ? projectQ.data ?? null : null;
  const extrasQ = useExtraPayouts();
  const { rules: realRules, error: rulesError, fromSnapshot } = useRules(project);

  const [basis, setBasis] = useState<Basis>("received");
  const [custom, setCustom] = useState(100000);
  const [rows, setRows] = useState<Row[]>([
    { key: newKey(), name: "Employee A", role: "", score: 40 },
    { key: newKey(), name: "Employee B", role: "", score: 35 },
    { key: newKey(), name: "Employee C", role: "", score: 25 },
  ]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"download" | "save" | null>(null);

  // Saved team of the chosen project, used to detect what-if edits.
  const savedTeam = useMemo<TeamInput[]>(
    () =>
      project
        ? project.project_employees.map((e) => ({
            employeeId: e.employee_id,
            name: e.employees?.name ?? "Employee",
            role: e.role ?? "",
            score: Number(e.score),
          }))
        : [],
    [project],
  );

  // When a project is chosen, load its team and pick a sensible basis.
  useEffect(() => {
    if (!project) return;
    setRows(savedTeam.map((t) => ({ ...t, key: newKey() })));
    const received = project.payments.reduce((a, x) => a + Number(x.amount_paise), 0);
    setBasis(received > 0 ? "received" : "price");
    setMsg(null);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const receivedPaise = project ? project.payments.reduce((a, x) => a + Number(x.amount_paise), 0) : 0;
  const basisPaise =
    project && basis === "received"
      ? receivedPaise
      : project && basis === "price"
        ? Number(project.price_paise)
        : rupeesToPaise(custom || 0);
  const basisLabel = !project
    ? "Amount entered"
    : basis === "received"
      ? "Total received so far"
      : basis === "price"
        ? "Agreed project price"
        : "Custom amount";

  // Rules: the project's own, or current Settings (sample founders if none are set up yet).
  const rules: Rules | null = realRules ?? (!project ? { companyBp: 5000, reserveBp: 8000, gst: { enabled: false, rateBp: 1800 }, tds: { enabled: false, rateBp: 1000 }, founders: SAMPLE_FOUNDERS } : null);
  const usingSample = !project && !realRules;

  const projectExtras = useMemo(
    () => (project ? (extrasQ.data ?? []).filter((x) => x.project_id === project.id) : []),
    [project, extrasQ.data],
  );

  const edited = project
    ? JSON.stringify(rows.map((r) => [r.employeeId ?? null, r.score, r.role])) !==
      JSON.stringify(savedTeam.map((r) => [r.employeeId ?? null, r.score, r.role]))
    : false;
  const whatIf = !project || edited || basis !== "received";

  const calc = useMemo(() => {
    if (!rules) return null;
    try {
      const team: TeamInput[] = rows.map(({ key: _k, ...t }) => t);
      const data = buildStatementData({
        kind: "calculation",
        project,
        basisLabel,
        basisPaise,
        rules,
        fromSnapshot,
        team,
        scoringNote: !edited ? methodExplanation(project?.scoring_method, normalizeMix(project?.scoring_weights)) || undefined : undefined,
        extras: projectExtras,
        preparedBy: email,
        whatIf,
        attachments: [],
      });
      return { ok: true as const, data };
    } catch (e) {
      return { ok: false as const, error: errText(e) };
    }
  }, [rules, rows, project, basisLabel, basisPaise, fromSnapshot, projectExtras, email, whatIf]);

  async function makePdf() {
    if (!calc || !calc.ok) throw new Error(calc && !calc.ok ? calc.error : "Nothing to export yet");
    const data = { ...calc.data, generatedAt: new Date().toISOString() };
    const blob = await buildStatementPdf(data);
    return { blob, name: pdfFileName(data) };
  }

  async function onDownload() {
    setMsg(null);
    setBusy("download");
    try {
      const { blob, name } = await makePdf();
      downloadBlob(blob, name);
      setMsg({ ok: true, text: "PDF downloaded." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onSaveToProject() {
    if (!project) return;
    setMsg(null);
    setBusy("save");
    try {
      const { blob, name } = await makePdf();
      const file = new File([blob], name, { type: "application/pdf" });
      await uploadDocument({ bucket: BUCKETS.exports, file, folder: project.id, linkedTable: "projects", linkedId: project.id });
      await qc.invalidateQueries({ queryKey: ["project-invoices", project.id] });
      setMsg({ ok: true, text: "Saved to the project's documents." });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const r = calc && calc.ok ? calc.data.result : null;
  const extraTotals = totalsFor(projectExtras);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Split Calculator</h1>
      <p className="mb-6 text-sm text-slate-500">
        Pick a project to calculate on its real team and rules, or leave it on "No project" to try any amount. Nothing is
        saved from the numbers on this screen. You can export what you see as a PDF.
      </p>

      <div className="card mb-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Project</label>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project (free calculation)</option>
              {(projectsQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.clients?.name ? ` (${p.clients.name})` : ""}
                </option>
              ))}
            </select>
            {project && (
              <p className="mt-1 text-xs text-slate-500">
                Rules: {fromSnapshot ? "saved on this project" : "current Settings (no payment recorded yet)"}.
              </p>
            )}
          </div>

          <div>
            <label className="label">Calculate on</label>
            {project ? (
              <div className="space-y-1 text-sm">
                {(
                  [
                    ["received", `Total received so far (${formatINR(receivedPaise)})`],
                    ["price", `Agreed price (${formatINR(Number(project.price_paise))})`],
                    ["custom", "A custom amount"],
                  ] as [Basis, string][]
                ).map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="radio" name="basis" checked={basis === v} onChange={() => setBasis(v)} />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}
            {(!project || basis === "custom") && (
              <div className={project ? "mt-2" : ""}>
                <NumberInput className="input w-56" min={0} value={custom} onChange={(n) => setCustom(n)} />
                <span className="ml-2 text-sm text-slate-500">₹</span>
              </div>
            )}
          </div>
        </div>

        {(rulesError || (project && projectQ.isLoading)) && (
          <p className="mt-3 text-sm text-red-600">{rulesError ?? "Loading project..."}</p>
        )}
        {usingSample && <p className="mt-3 text-xs text-amber-700">Using sample founders until you add yours in Settings.</p>}

        <div className="mt-5 label">Team and contribution scores{project ? " (edit to try what-ifs; the project is not changed)" : ""}</div>
        {project && (
          <p className="mb-1 text-xs text-slate-500">
            This project scores contribution by <b>{methodLabel(project.scoring_method)}</b>. The scores below are its saved result; change inputs on the project page.
          </p>
        )}
        {project && rows.length === 0 && (
          <p className="text-sm text-amber-700">This project has no team yet. Add people on the project page, or add some here to try a split.</p>
        )}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={row.key} className="flex flex-wrap items-center gap-2">
              <input
                className="input w-48"
                value={row.name}
                disabled={Boolean(row.employeeId)}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className="input w-40"
                placeholder="Role"
                value={row.role}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
              />
              <NumberInput
                className="input w-24"
                min={0}
                value={row.score}
                onChange={(n) => setRows(rows.map((x, j) => (j === i ? { ...x, score: Math.max(0, n) } : x)))}
              />
              <button className="text-sm text-red-600 hover:underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={() => setRows([...rows, { key: newKey(), name: "", role: "", score: 0 }])}>
            + Add person
          </button>
          {project && edited && (
            <button className="text-sm text-brand-600 hover:underline" onClick={() => setRows(savedTeam.map((t) => ({ ...t, key: newKey() })))}>
              Reset to saved team
            </button>
          )}
        </div>
      </div>

      {!calc ? null : !calc.ok ? (
        <div className="card text-sm text-red-600">{calc.error}</div>
      ) : (
        r && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button className="btn" disabled={busy !== null} onClick={onDownload}>
                {busy === "download" ? "Building PDF..." : "Generate PDF"}
              </button>
              {project && (
                <button className="btn-ghost" disabled={busy !== null} onClick={onSaveToProject}>
                  {busy === "save" ? "Saving..." : "Save PDF to project"}
                </button>
              )}
              {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
              {whatIf && project && <span className="text-xs text-amber-700">What-if numbers: differ from what is saved.</span>}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="card">
                <h2 className="mb-3 font-semibold">Pools</h2>
                <dl className="space-y-1 text-sm">
                  <Line k={basisLabel} v={formatINR(r.grossPaise)} />
                  {r.gstPaise + r.tdsPaise > 0 && (
                    <>
                      <Line k="GST" v={formatINR(r.gstPaise)} />
                      <Line k="TDS" v={formatINR(r.tdsPaise)} />
                    </>
                  )}
                  <Line k="Net distributable" v={formatINR(r.netPaise)} bold />
                  <Line k="Company share" v={formatINR(r.companySharePaise)} />
                  <Line k="Employee pool" v={formatINR(r.employeePoolPaise)} />
                  <Line k="Reserve" v={formatINR(r.reservePaise)} />
                  <Line k="Founders pool" v={formatINR(r.foundersPoolPaise)} />
                </dl>
              </div>
              <div className="card">
                <h2 className="mb-3 font-semibold">Founder payouts</h2>
                <dl className="space-y-1 text-sm">
                  {r.founderPayouts.map((f) => (
                    <Line key={f.id} k={`${f.name} (${bpToPct(f.weightBp)}%)`} v={formatINR(f.paise)} />
                  ))}
                </dl>
              </div>
              <div className="card md:col-span-2">
                <h2 className="mb-3 font-semibold">Employee payouts</h2>
                {calc.data.employees.length === 0 ? (
                  <p className="text-sm text-slate-500">No employees to split between.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="pb-2 font-medium">Employee</th>
                        <th className="pb-2 font-medium">Role</th>
                        <th className="pb-2 font-medium">Score</th>
                        <th className="pb-2 font-medium">Share</th>
                        <th className="pb-2 text-right font-medium">Amount</th>
                        {project && <th className="pb-2 text-right font-medium">Extra given</th>}
                        {project && <th className="pb-2 text-right font-medium">Recovered</th>}
                        {project && <th className="pb-2 text-right font-medium">Outstanding</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {calc.data.employees.map((e, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="py-2">{e.name}</td>
                          <td>{e.role || "-"}</td>
                          <td>{e.score}</td>
                          <td>{bpToPct(e.shareBp).toFixed(2)}%</td>
                          <td className="text-right">{formatINR(e.paise)}</td>
                          {project && <td className="text-right">{formatINR(e.extraPaise)}</td>}
                          {project && <td className="text-right">{formatINR(e.recoveredPaise)}</td>}
                          {project && <td className="text-right">{formatINR(e.outstandingPaise)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {project && projectExtras.length > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    Extra payouts on this project: {formatINR(extraTotals.given)} given, {formatINR(extraTotals.recovered)} recovered,{" "}
                    {formatINR(extraTotals.outstanding)} still to recover.
                  </p>
                )}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

function Line({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <dt className="text-slate-600">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

