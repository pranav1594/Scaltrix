import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useProjects } from "../lib/data";
import { formatINR, rupeesToPaise } from "../engine";
import NumberInput from "../components/NumberInput";

export default function Projects() {
  const q = useProjects();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const knownClients = Array.from(new Set((q.data ?? []).map((p) => p.clients?.name).filter(Boolean))) as string[];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!name.trim()) throw new Error("Project name is required");
      const pricePaise = rupeesToPaise(Number(price));
      if (!Number.isFinite(pricePaise) || pricePaise < 0) throw new Error("Enter a valid price");

      let clientId: string | null = null;
      const cname = client.trim();
      if (cname) {
        const existing = await supabase.from("clients").select("id").ilike("name", cname).limit(1);
        if (existing.error) throw existing.error;
        if (existing.data && existing.data.length > 0) {
          clientId = existing.data[0].id;
        } else {
          const ins = await supabase.from("clients").insert({ name: cname }).select("id").single();
          if (ins.error) throw ins.error;
          clientId = ins.data.id;
        }
      }
      const { data, error } = await supabase
        .from("projects")
        .insert({ name: name.trim(), client_id: clientId, price_paise: pricePaise })
        .select("id")
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav(`/projects/${data.id}`);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mb-6 text-sm text-slate-500">Create a project, assign the team, then record client payments.</p>

      <form onSubmit={onSubmit} className="card mb-6 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Project name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Client</label>
          <input className="input" list="clients" value={client} onChange={(e) => setClient(e.target.value)} />
          <datalist id="clients">
            {knownClients.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">Agreed price (₹)</label>
          <NumberInput className="input" min={0} value={price} onChange={(_, raw) => setPrice(raw)} />
        </div>
        <div className="sm:col-span-3 flex items-center gap-3">
          <button className="btn" disabled={busy}>
            Create project
          </button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </form>

      <div className="card">
        {q.isLoading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : q.isError ? (
          <p className="text-sm text-red-600">Could not load projects. Did you run migration 0002?</p>
        ) : q.data && q.data.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Project</th>
                <th className="pb-2 font-medium">Client</th>
                <th className="pb-2 text-right font-medium">Price</th>
                <th className="pb-2 text-right font-medium">Received</th>
                <th className="pb-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => {
                const received = p.payments.reduce((a, x) => a + Number(x.amount_paise), 0);
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <Link className="font-medium text-brand-600 hover:underline" to={`/projects/${p.id}`}>
                        {p.name}
                      </Link>
                    </td>
                    <td>{p.clients?.name ?? "-"}</td>
                    <td className="text-right">{formatINR(Number(p.price_paise))}</td>
                    <td className="text-right">{formatINR(received)}</td>
                    <td className="text-right">{formatINR(Number(p.price_paise) - received)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">No projects yet.</p>
        )}
      </div>
    </div>
  );
}
