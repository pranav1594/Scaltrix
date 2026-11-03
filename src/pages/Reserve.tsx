import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUCKETS, supabase } from "../lib/supabase";
import { ACCEPTED_FILES, uploadDocument } from "../lib/files";
import { useReserveLedger, type LedgerRow } from "../lib/data";
import ViewDocButton from "../components/ViewDocButton";
import { formatINR, rupeesToPaise } from "../engine";
import NumberInput from "../components/NumberInput";

const CATEGORIES = ["Software and subscriptions", "Hosting and domains", "Equipment", "Office and rent", "Travel", "Marketing", "Legal and professional", "Taxes and fees", "Other"];

const KIND_LABEL: Record<LedgerRow["kind"], string> = {
  project_inflow: "From project",
  expense: "Expense",
  founder_advance: "Founder advance",
  adjustment: "Adjustment",
};

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}

/** Upload one or more bill files and link them to a ledger entry. Returns how many failed. */
async function attachBills(ledgerId: string, files: File[]): Promise<number> {
  let failed = 0;
  for (const file of files) {
    try {
      await uploadDocument({ bucket: BUCKETS.reserve, file, folder: ledgerId, linkedTable: "reserve_ledger", linkedId: ledgerId });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

/** "Add bill" link for an existing expense. Bills are optional and can be added any time. */
function AddBill({ ledgerId }: { ledgerId: string }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  return (
    <>
      <input
        ref={ref}
        className="hidden"
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length === 0) return;
          setBusy(true);
          setErr(false);
          const failed = await attachBills(ledgerId, files);
          setErr(failed > 0);
          await qc.invalidateQueries({ queryKey: ["reserve-ledger"] });
          setBusy(false);
        }}
      />
      <button className={`text-sm hover:underline ${err ? "text-red-600" : "text-brand-600"}`} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Uploading..." : err ? "Upload failed, retry" : "Add bill"}
      </button>
    </>
  );
}

export default function Reserve() {
  const qc = useQueryClient();
  const ledgerQ = useReserveLedger();
  const balanceQ = useQuery({
    queryKey: ["reserve-balance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reserve_balance").select("balance_paise").single();
      if (error) throw error;
      return Number(data.balance_paise);
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "spending" | "in">("all");

  const rows = ledgerQ.data ?? [];
  const spent = rows.filter((r) => r.direction === "out").reduce((a, r) => a + Number(r.amount_paise), 0);
  const received = rows.filter((r) => r.direction === "in").reduce((a, r) => a + Number(r.amount_paise), 0);
  const withoutBill = rows.filter((r) => r.kind === "expense" && r.bills.length === 0).length;
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "spending" ? r.direction === "out" : r.direction === "in"));

  async function onAdd() {
    setMsg(null);
    setBusy(true);
    try {
      const paise = rupeesToPaise(Number(amount) || 0);
      if (paise <= 0) throw new Error("Enter the amount spent");
      if (!description.trim()) throw new Error("Say what the money was spent on");

      const { data, error } = await supabase
        .from("reserve_ledger")
        .insert({
          kind: "expense",
          direction: "out",
          amount_paise: paise,
          occurred_on: date,
          description: description.trim(),
          category: category.trim() || null,
          paid_to: paidTo.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error; // includes "Reserve balance too low" from the database

      let note = "Expense recorded.";
      if (files.length > 0) {
        const failed = await attachBills(data.id, files);
        note = failed > 0 ? `Expense recorded, but ${failed} file(s) failed to upload. Use "Add bill" on the row to retry.` : "Expense recorded with its bill.";
      }
      setAmount("");
      setDescription("");
      setCategory("");
      setPaidTo("");
      setFiles([]);
      setFileKey((k) => k + 1);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["reserve-ledger"] }),
        qc.invalidateQueries({ queryKey: ["reserve-balance"] }),
      ]);
      setMsg({ ok: true, text: note });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Reserve and Bills</h1>
      <p className="mb-6 text-sm text-slate-500">
        Everything spent from the company reserve. A bill, screenshot or PDF is optional: add it now or any time later.
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="text-sm text-slate-500">Reserve balance</div>
          <div className="mt-1 text-2xl font-semibold">
            {balanceQ.isLoading ? "..." : balanceQ.isError ? "Not set up" : formatINR(balanceQ.data ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Total added to reserve</div>
          <div className="mt-1 text-2xl font-semibold">{formatINR(received)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Total spent</div>
          <div className="mt-1 text-2xl font-semibold">{formatINR(spent)}</div>
          {withoutBill > 0 && <div className="mt-1 text-xs text-amber-700">{withoutBill} expense{withoutBill === 1 ? "" : "s"} without a bill</div>}
        </div>
      </div>

      <section className="card mb-6">
        <h2 className="mb-3 font-semibold">Add an expense</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Amount (₹)</label>
            <NumberInput className="input" min={0} value={amount} onChange={(_, raw) => setAmount(raw)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">What was it for?</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label">Category (optional)</label>
            <input className="input" list="categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="categories">
              {CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label">Paid to (optional)</label>
            <input className="input" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Bill, screenshot or PDF (optional)</label>
            <input
              key={fileKey}
              className="block w-full text-sm"
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn" disabled={busy} onClick={onAdd}>
            {busy ? "Saving..." : "Add expense"}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500">The reserve cannot go below zero. Entries cannot be edited or deleted once saved, which keeps the record trustworthy.</p>
      </section>

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Reserve ledger</h2>
          <select className="input w-44" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All entries</option>
            <option value="spending">Spending only</option>
            <option value="in">Money in only</option>
          </select>
        </div>
        {ledgerQ.isLoading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : ledgerQ.isError ? (
          <p className="text-sm text-red-600">Could not load the ledger. Have you run migration 0003 in Supabase?</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing here yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Details</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Amount</th>
                <th className="pb-2 pl-4 font-medium">Bills</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap py-2">{r.occurred_on}</td>
                  <td className="py-2">
                    <div>{r.description}</div>
                    <div className="text-xs text-slate-500">
                      {[r.category, r.paid_to ? `paid to ${r.paid_to}` : null, r.projects?.name].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="py-2 text-slate-600">{KIND_LABEL[r.kind]}</td>
                  <td className={`whitespace-nowrap py-2 text-right font-medium ${r.direction === "in" ? "text-green-700" : ""}`}>
                    {r.direction === "in" ? "+" : "-"} {formatINR(Number(r.amount_paise))}
                  </td>
                  <td className="py-2 pl-4">
                    {r.kind === "expense" ? (
                      <div className="flex flex-col items-start gap-0.5">
                        {r.bills.length === 0 && <span className="text-xs text-slate-400">No bill</span>}
                        {r.bills.map((b, i) => (
                          <ViewDocButton key={b.id} documentId={b.id} label={r.bills.length > 1 ? `View bill ${i + 1}` : "View bill"} />
                        ))}
                        <AddBill ledgerId={r.id} />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
