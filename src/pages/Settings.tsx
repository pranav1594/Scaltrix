import { useEffect, useState } from "react";
import { DEFAULT_APP_SETTINGS, useSaveSettings, useSettings, type AppSettings } from "../lib/settings";
import { useFounders, useSaveFounders } from "../lib/useFounders";
import { bpToPct, pctToBp } from "../engine";
import { MethodCards, MixEditor } from "../components/ScoringPicker";
import { normalizeMix } from "../lib/scoring";
import NumberInput from "../components/NumberInput";
import FounderBond from "../components/FounderBond";

interface FounderDraft {
  id?: string;
  name: string;
  email: string;
  weightPct: number;
}

function Pct({ value, onChange }: { value: number; onChange: (bp: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <NumberInput
        className="input w-28"
        min={0}
        max={100}
        step={0.01}
        value={bpToPct(value)}
        onChange={(n) => onChange(pctToBp(n))}
      />
      <span className="text-sm text-slate-500">%</span>
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select className="input w-72" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-slate-100 py-4 last:border-0 sm:grid-cols-[18rem_1fr]">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function Settings() {
  const settingsQ = useSettings();
  const foundersQ = useFounders();
  const saveSettings = useSaveSettings();
  const saveFounders = useSaveFounders();

  const [s, setS] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [founders, setFounders] = useState<FounderDraft[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (settingsQ.data) setS(settingsQ.data);
  }, [settingsQ.data]);
  useEffect(() => {
    if (foundersQ.data)
      setFounders(
        foundersQ.data.map((f) => ({ id: f.id, name: f.name, email: f.email ?? "", weightPct: bpToPct(f.weight_bp) })),
      );
  }, [foundersQ.data]);

  const totalPct = Math.round(founders.reduce((a, f) => a + pctToBp(f.weightPct), 0)) / 100;
  const founderTotalOk = founders.length === 0 || totalPct === 100;

  async function onSave() {
    setMsg(null);
    try {
      if (!founderTotalOk) throw new Error(`Founder weights must total 100% (currently ${totalPct}%)`);
      const mx = normalizeMix(s.contribution.mix);
      if (mx.ratingBp + mx.hoursBp + mx.tasksBp !== 10000) throw new Error("Weighted mix percentages must total 100%");
      await saveSettings.mutateAsync(s);
      if (founders.length > 0) {
        await saveFounders.mutateAsync(
          founders
            .filter((f) => f.name.trim())
            .map((f) => ({
              ...(f.id ? { id: f.id } : {}),
              name: f.name.trim(),
              email: f.email.trim() || null,
              weight_bp: pctToBp(f.weightPct),
            })),
        );
      }
      setMsg({ ok: true, text: "Settings saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-slate-500">
        Every rule is editable. Existing projects keep the rules they were calculated under.
      </p>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Money split</h2>
        <Row title="Company share of each payment" hint="The rest goes to the employee pool.">
          <Pct value={s.split.companyBp} onChange={(bp) => setS({ ...s, split: { ...s.split, companyBp: bp } })} />
        </Row>
        <Row title="Reserve share of company share" hint="The rest goes to the founders pool.">
          <Pct value={s.split.reserveBp} onChange={(bp) => setS({ ...s, split: { ...s.split, reserveBp: bp } })} />
        </Row>
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Founders and rank weights</h2>
        <p className="mb-3 text-xs text-slate-500">
          Weights decide the founders pool split and the founder advance. They must total 100%. Use the bond button to
          view or upload the bond each founder signed for the company.
        </p>
        <div className="space-y-2">
          {founders.map((f, i) => (
            <div key={f.id ?? i} className="flex flex-wrap items-center gap-2">
              <input
                className="input w-48"
                placeholder="Name"
                value={f.name}
                onChange={(e) => setFounders(founders.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className="input w-56"
                placeholder="Email (optional)"
                value={f.email}
                onChange={(e) => setFounders(founders.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
              />
              <NumberInput
                className="input w-24"
                min={0}
                max={100}
                step={0.01}
                value={f.weightPct}
                onChange={(n) => setFounders(founders.map((x, j) => (j === i ? { ...x, weightPct: n } : x)))}
              />
              <span className="text-sm text-slate-500">%</span>
              <div className="ml-2 min-w-[11rem]">
                {f.id ? (
                  <FounderBond founderId={f.id} founderName={f.name} />
                ) : (
                  <span className="text-xs text-slate-400">Save settings to add a bond</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <button
            className="btn-ghost"
            onClick={() => setFounders([...founders, { name: "", email: "", weightPct: 0 }])}
          >
            + Add founder
          </button>
          <span className={`text-sm ${founderTotalOk ? "text-green-700" : "text-red-600"}`}>
            Total: {totalPct}% {founderTotalOk ? "" : "(must be 100%)"}
          </span>
        </div>
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Policies</h2>
        <Row title="Founder advance handling">
          <Select
            value={s.founder_advance.mode}
            onChange={(mode) => setS({ ...s, founder_advance: { mode } })}
            options={[
              { value: "equalizing", label: "Equalizing (others get matching amounts)" },
              { value: "loan", label: "Loan (deduct from future founder payouts)" },
            ]}
          />
        </Row>
        <Row
          title="Employee contribution score"
          hint="The default for NEW projects. Each project can use a different method (pick it on the project page)."
        >
          <MethodCards value={s.contribution.method} onChange={(method) => setS({ ...s, contribution: { ...s.contribution, method } })} />
          <div className="mt-3 text-xs text-slate-500">Default blend used by "Weighted mix":</div>
          <MixEditor
            value={normalizeMix(s.contribution.mix)}
            onChange={(mix) => setS({ ...s, contribution: { ...s.contribution, mix } })}
          />
        </Row>
        <Row title="Extra payout recovery">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={s.extra_recovery.mode}
              onChange={(mode) => setS({ ...s, extra_recovery: { ...s.extra_recovery, mode } })}
              options={[
                { value: "one_time", label: "One-time deduction" },
                { value: "installments", label: "Monthly installments" },
                { value: "per_project", label: "% of each future project share" },
              ]}
            />
            {s.extra_recovery.mode === "installments" && (
              <NumberInput
                className="input w-24"
                min={1}
                value={s.extra_recovery.count ?? 3}
                onChange={(n) => setS({ ...s, extra_recovery: { ...s.extra_recovery, count: Math.max(1, n) } })}
              />
            )}
            {s.extra_recovery.mode === "per_project" && (
              <Pct
                value={s.extra_recovery.bp ?? 1000}
                onChange={(bp) => setS({ ...s, extra_recovery: { ...s.extra_recovery, bp } })}
              />
            )}
          </div>
        </Row>
        <Row title="Bond compensation">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={s.bond_compensation.kind}
              onChange={(kind) => setS({ ...s, bond_compensation: { ...s.bond_compensation, kind } })}
              options={[
                { value: "percent", label: "Percentage of amount still due" },
                { value: "fixed", label: "Fixed amount" },
                { value: "per_missed", label: "Amount per missed referral" },
              ]}
            />
            {s.bond_compensation.kind === "percent" ? (
              <Pct
                value={s.bond_compensation.bp ?? 1000}
                onChange={(bp) => setS({ ...s, bond_compensation: { ...s.bond_compensation, bp } })}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">₹</span>
                <NumberInput
                  className="input w-32"
                  min={0}
                  value={(s.bond_compensation.paise ?? 0) / 100}
                  onChange={(n) =>
                    setS({ ...s, bond_compensation: { ...s.bond_compensation, paise: Math.round(n * 100) } })
                  }
                />
              </div>
            )}
          </div>
        </Row>
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Taxes (off for now)</h2>
        <p className="mb-2 text-xs text-slate-500">
          Switch these on only after confirming the treatment with a CA. When on, GST is treated as included in the
          payment and TDS is taken on the amount before GST.
        </p>
        {(["gst", "tds"] as const).map((k) => (
          <Row key={k} title={k.toUpperCase()}>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.tax[k].enabled}
                  onChange={(e) => setS({ ...s, tax: { ...s.tax, [k]: { ...s.tax[k], enabled: e.target.checked } } })}
                />
                Enabled
              </label>
              <Pct
                value={s.tax[k].rateBp}
                onChange={(bp) => setS({ ...s, tax: { ...s.tax, [k]: { ...s.tax[k], rateBp: bp } } })}
              />
            </div>
          </Row>
        ))}
      </section>

      <div className="flex items-center gap-4">
        <button className="btn" onClick={onSave} disabled={saveSettings.isPending || saveFounders.isPending}>
          Save settings
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
